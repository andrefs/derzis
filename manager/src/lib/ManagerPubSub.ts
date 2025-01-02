import { createClient } from 'redis';
import config from '@derzis/config';
import { createLogger } from '@derzis/common';
const log = createLogger('Manager');
import Manager from './Manager';
import process from 'process';
import type { JobCapacity, Message } from '@derzis/worker';
const redisOpts = {
	url: `redis://${config.pubsub.host}:${config.pubsub.port}`
};

class ManagerPubSub {
	_m: Manager;
	_redisClient: ReturnType<typeof createClient>;
	_broad!: ReturnType<typeof createClient>;
	_pub!: ReturnType<typeof createClient>;
	_sub!: ReturnType<typeof createClient>;
	_pubChannel!: string;
	_broadChannel!: string;

	constructor() {
		this._m = new Manager();
		this._redisClient = createClient(redisOpts);
		this.listenManager();
	}

	listenManager() {
		this._m.jobs.on('jobTimeout', (payload) => {
			return this.broad({ type: 'jobTimeout', payload });
		});
	}

	async start() {
		log.info('Started');
		await this._m.jobs.cancelAllJobs();
		await this.connect();
		//await this._m.startNewProcess();
		this.askCurrentCapacity();
	}

	async connect() {
		log.info('Connecting to Redis');
		await this._redisClient.connect();
		this._pub = this._redisClient.duplicate();
		this._sub = this._redisClient.duplicate();
		this._broad = this._redisClient.duplicate();
		await this._pub.connect();
		await this._sub.connect();
		await this._broad.connect();

		process.on('uncaughtException', (...args) => {
			log.error('Uncaught exception', args);
			process.exit(1);
		});

		log.pubsub(`Subscribing to ${config.pubsub.workers.from.replace(/-.*$/, '')}*`);

		const handleMessage = async (msg: string, channel: string) => {
			const workerId = channel.match(/:([-\w]+)$/)?.[1];
			const message: Message = JSON.parse(msg);
			log.pubsub('Got message from ' + channel.replace(/-.*$/, ''), message.type);
			if (Object.keys(message.payload).length) {
				log.debug('', message.payload);
			}
			if (message.type === 'repCurCap') {
				return await this.assignJobs(workerId!, message.payload);
			}
			if (message.type === 'jobDone') {
				return await this._m.updateJobResults(message.payload);
			}
			if (message.type === 'shutdown') {
				await this._m.jobs.cancelWorkerJobs(message.payload.ongoingJobs, workerId!);
			}
			if (message.type === 'noCapacity' || message.type === 'alreadyBeingDone') {
				const reason =
					message.type === 'noCapacity'
						? `worker ${workerId} has no capacity`
						: `it is already being done by worker ${workerId}`;
				log.info(
					`Job #${message.payload.jobId} ${message.payload.jobType}` +
					` on ${message.payload.origin} was refused because ${reason}`
				);
				await this._m.jobs.cancelJob(message.payload.origin, message.payload.jobType);
			}
		};

		this._sub.pSubscribe(config.pubsub.workers.from + '*', handleMessage);

		this._broadChannel = config.pubsub.manager.from;
		log.pubsub(`Broadcasting to ${this._broadChannel}`);
		this._pubChannel = config.pubsub.workers.to;
		log.pubsub(`Publishing to ${this._pubChannel}{workerId}`);
	}

	pub(workerId: string, { type, payload }: Message) {
		const channel = this._pubChannel + workerId;
		log.pubsub('Publishing message to ' + channel.replace(/-.*$/, ''), type);
		if (Object.keys(payload).length) {
			log.debug('', payload);
		}
		this._pub.publish(channel, JSON.stringify({ type, payload }));
	}

	broad({ type, payload }: Message) {
		log.pubsub('Broadcasting message to ' + this._broadChannel, type);
		if (Object.keys(payload).length) {
			log.debug('', payload);
		}
		this._broad.publish(this._broadChannel, JSON.stringify({ type, payload }));
	}

	askCurrentCapacity(workerId?: string) {
		const message = { type: 'askCurCap' as const, payload: {} };
		if (workerId) {
			return this.pub(workerId, message);
		}
		return this.broad(message);
	}

	//askStatus(workerId){
	//  if(workerId){ return this.pub(workerId, 'askStatus'); }
	//  return this.broad('askStatus');
	//}

	async assignJobs(workerId: string, workerAvail: JobCapacity) {
		for await (const job of this._m.assignJobs(workerId, workerAvail)) {
			this.pub(workerId, { type: 'doJob', payload: job });
		}
	}
}
export default ManagerPubSub;
