import config from '@derzis/config';
import { createClient } from 'redis';

const redisOpts = {
	url: `redis://${config.pubsub.host}:${config.pubsub.port}`
};
import { Worker } from './Worker';
import { createLogger } from '@derzis/common/server';
import type {
	Message,
	JobRequest,
	ResourceCrawlJobRequest,
	CrawlDomainResult
} from '@derzis/common';
import type { MonkeyPatchedLogger } from '@derzis/common/server';
let log: MonkeyPatchedLogger;

export class WorkerPubSub {
	w: Worker;
	_redisClient: ReturnType<typeof createClient>;
	_http!: ReturnType<typeof createClient>;
	_pub!: ReturnType<typeof createClient>;
	_sub!: ReturnType<typeof createClient>;
	_pubChannel!: string;

	constructor() {
		// FIXME Workers on different machines may have same PID
		this.w = new Worker();
		log = createLogger(this.w.wShortId);
		this._redisClient = createClient(redisOpts);
	}

	exitHandler = (opts = {}) => {
		return ({ signal }: { signal: string }) => {
			this.pub({
				type: 'shutdown',
				payload: { ...opts, signal, ongoingJobs: this.w.currentJobs }
			});
			process.exit(signal ? 1 : 0);
		};
	};

	signalHandler = () => {
		return () => this.reportCurrentCapacity();
	};

	async start() {
		log.info('Started');

		// connect to db
		await this.w.connect();
		// connect to redis
		await this.connect();

		this.reportCurrentCapacity();
		if (config.periodicallyRepCurCap) {
			const interval = config.periodicallyRepCurCap;
			const initDelay = 1000 * (Math.floor(Math.random() * 20) + 1);
			setTimeout(() => {
				setInterval(() => this.reportCurrentCapacity(), interval);
			}, initDelay);
		}
	}

	async connect() {
		log.info('Connecting to Redis');
		await this._redisClient.connect();
		this._pub = this._redisClient.duplicate();
		this._sub = this._redisClient.duplicate();
		await this._pub.connect();
		await this._sub.connect();

		if (config.http.debug) {
			this._http = this._redisClient.duplicate();
			await this._http.connect();
			this.w.on('httpDebug', (ev) =>
				this._http.publish(config.http.debug.pubsubChannel, JSON.stringify(ev, null, 2))
			);
		}

		process.on('SIGINT', this.exitHandler({ signal: 'SIGINT' }));
		process.on('SIGUSR1', this.signalHandler());
		process.on('SIGUSR2', this.signalHandler());
		process.on('uncaughtException', (...args) => {
			log.error('Uncaught exception', args);
			process.exit(1);
		});

		const handleMessage = (channel: string) => (msg: string) => {
			const message: Message = JSON.parse(msg);
			log.pubsub?.('message from ' + channel, message.type);
			if (Object.keys(message.payload).length) {
				log.debug('', message.payload);
			}

			if (message.type === 'askCurCap') {
				return this.reportCurrentCapacity();
			}
			if (message.type === 'jobTimeout') {
				if (this.w.currentJobs.domainCrawl[message.payload.origin]) {
					this.w.jobsTimedout[message.payload.origin] = true;
				}
				return;
			}
			if (message.type === 'doJob') {
				return this.doJob(message.payload);
			}
		};

		this._pubChannel = config.pubsub.workers.from + this.w.wId;
		log.pubsub?.(`Publishing to ${this._pubChannel}`);
		log.pubsub?.('Subscribing to', [
			config.pubsub.manager.from,
			config.pubsub.workers.to + this.w.wId
		]);
		this._sub.subscribe(config.pubsub.manager.from, handleMessage(config.pubsub.manager.from));
		this._sub.subscribe(
			config.pubsub.workers.to + this.w.wId,
			handleMessage(config.pubsub.workers.to + this.w.wId)
		);
	}

	pub({ type, payload }: Message) {
		log.pubsub?.('Publishing message to ' + this._pubChannel.replace(/-.*$/, ''), type);
		if (Object.keys(payload).length) {
			log.debug('', payload);
		}
		this._pub.publish(this._pubChannel, JSON.stringify({ type, payload }));
	}

	async doJob(job: Exclude<JobRequest, ResourceCrawlJobRequest>) {
		const origin = job.type === 'domainCrawl' ? job.domain.origin : job.origin;
		// Check if job can be done
		if (this.w.alreadyBeingDone(origin, job.type)) {
			log.error(
				`Job ${job.type} on ${origin} already being done, so job #${job.jobId} was refused.`
			);
			this.pub({
				type: 'alreadyBeingDone',
				payload: { jobType: job.type, origin, jobId: job.jobId }
			});
			return;
		}

		// Check capacity
		if (!this.w.hasCapacity(job.type)) {
			log.error(`No capacity for job ${job.type} on ${origin}, so job #${job.jobId} was refused.`);
			this.pub({
				type: 'noCapacity',
				payload: { jobType: job.type, origin, jobId: job.jobId }
			});
			return;
		}

		// Do the job
		log.info(`Starting job ${job.type} on ${origin} (job #${job.jobId})`);
		if (job.type === 'robotsCheck') {
			const res = await this.w.checkRobots(job.jobId, job.origin);
			this.pub({ type: 'jobDone', payload: res });
			// this.reportCurrentCapacity();
			return;
		}
		if (job.type === 'domainCrawl') {
			const total = job.resources.length;
			const resourcesToDo = new Set<string>(job.resources.map((r) => r.url));
			const resourcesDone = new Set<string>();
			let i = 0;
			for await (const x of this.w.crawlDomain(job)) {
				log.info(
					`Finished resourceCrawl ${++i}/${total} of ${job.domain.origin} (job #${job.jobId})`
				);
				if (x.status === 'ok') {
					resourcesToDo.delete(x.url);
					resourcesDone.add(x.url);
				}
				this.pub({ type: 'jobDone', payload: x });
			}
			const jobResult: CrawlDomainResult = {
				jobId: job.jobId,
				status: 'ok' as const,
				jobType: 'domainCrawl' as const,
				origin: job.domain.origin,
				details: {
					crawledResources: Array.from(resourcesDone),
					nonCrawledResources: Array.from(resourcesToDo)
				}
			};
			this.pub({
				type: 'jobDone',
				payload: jobResult
			});
			// this.reportCurrentCapacity();
			return;
		}
	}

	reportCurrentCapacity() {
		const jc = this.w.jobCapacity;
		this.pub({ type: 'repCurCap', payload: jc });
	}

	askJobs() {
		const jc = this.w.jobCapacity;
		this.pub({ type: 'askJobs', payload: jc });
	}
}
