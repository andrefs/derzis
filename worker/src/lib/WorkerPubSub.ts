import config from '@derzis/config';
import { createClient } from 'redis';
import { Worker } from './Worker';
import { createLogger } from '@derzis/common';
import type {
  Message,
  JobRequest,
  ResourceCrawlJobRequest,
  CrawlDomainResult,
  ResourceLabelFetchJobRequest,
  FetchLabelsDomainResult
} from '@derzis/common';
import { RedisReconnector } from '@derzis/common';
import process from 'process';

const redisOpts = {
  url: `redis://${config.pubsub.host}:${config.pubsub.port}`
};

let log: ReturnType<typeof createLogger>;

export class WorkerPubSub {
  w: Worker;
  _redisReconnector: RedisReconnector;
  _pubReconnector: RedisReconnector;
  _subReconnector: RedisReconnector;
  _httpReconnector: RedisReconnector | null = null;
  _pub!: any;
  _sub!: any;
  _http?: any;
  _pubChannel!: string;
  _messageHandler!: (msg: string, channel: string) => void;

  constructor() {
    this.w = new Worker();
    log = createLogger(this.w.wShortId);
    this._redisReconnector = new RedisReconnector(redisOpts);
    this._pubReconnector = new RedisReconnector(redisOpts);
    this._subReconnector = new RedisReconnector(redisOpts);
    if (config.http.debug) {
      this._httpReconnector = new RedisReconnector(redisOpts);
    }
    this.setupReconnectionHandlers();
  }

  private setupReconnectionHandlers(): void {
    this._redisReconnector.on('reconnected', async () => {
      log.info('Main Redis reconnected, reconnecting pub/sub clients');
      try {
        await this.reconnectClients();
        this.resubscribe();
      } catch (err) {
        log.error('Error resubscribing after reconnection:', err);
      }
    });

    this._redisReconnector.on('gaveUp', (error) => {
      log.error('Redis reconnection failed, giving up:', error.message);
      process.exit(1);
    });

    const monitorReconnector = (
      reconnector: RedisReconnector,
      name: string,
      isSubscriber: boolean
    ) => {
      reconnector.on('reconnected', () => {
        log.info(`${name} Redis reconnected`);
      });
      reconnector.on('error', (error) => {
        log.error(`${name} Redis error:`, error.message);
      });
      reconnector.on('disconnected', () => {
        log.warn(`${name} Redis disconnected`);
      });
      reconnector.on('gaveUp', (error) => {
        log.error(`${name} Redis reconnection failed:`, error.message);
      });
    };

    monitorReconnector(this._pubReconnector, 'Pub', false);
    monitorReconnector(this._subReconnector, 'Sub', true);
  }

  private async reconnectClients(): Promise<void> {
    if (this._pub && this._pub.isOpen) {
      await this._pub.quit();
    }
    if (this._sub && this._sub.isOpen) {
      await this._sub.quit();
    }

    this._pub = this._pubReconnector.clientInstance;
    this._sub = this._subReconnector.clientInstance;

    if (!this._pub.isOpen) {
      await this._pubReconnector.connect();
    }
    if (!this._sub.isOpen) {
      await this._subReconnector.connect();
    }
  }

  private async resubscribe(): Promise<void> {
    if (!this._messageHandler) {
      log.warn('No message handler to resubscribe');
      return;
    }
    
    const managerChannel = config.pubsub.manager.from;
    const selfChannel = config.pubsub.workers.to + this.w.wId;
    log.info(`Resubscribing to ${managerChannel} and ${selfChannel}`);

    // Unsubscribe from both channels first to prevent duplicate handlers
    try {
      await this._sub.pUnsubscribe(managerChannel);
    } catch (err) {
      log.warn('Error unsubscribing from manager channel:', err);
    }
    try {
      await this._sub.pUnsubscribe(selfChannel);
    } catch (err) {
      log.warn('Error unsubscribing from self channel:', err);
    }

    const maxRetries = 5;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this._sub.pSubscribe(managerChannel, this._messageHandler);
        await this._sub.pSubscribe(selfChannel, this._messageHandler);
        log.info(`Resubscribe successful on attempt ${attempt}`);
        return;
      } catch (err) {
        log.warn(`Resubscribe attempt ${attempt} failed:`, err as Error);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        } else {
          log.error('Resubscribe failed after all retries');
          throw err;
        }
      }
    }
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
    await this._redisReconnector.connect();
    this._pub = this._pubReconnector.clientInstance;
    this._sub = this._subReconnector.clientInstance;

    if (config.http.debug && this._httpReconnector) {
      await this._httpReconnector.connect();
      this._http = this._httpReconnector.clientInstance;
      this.w.on('httpDebug', (ev) =>
        this._http!.publish(config.http.debug.pubsubChannel, JSON.stringify(ev, null, 2))
      );
    }

    // Set up stable message handler
    this._messageHandler = (msg: string, channel: string) => {
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
        (async () => {
          try {
            await this.doJob(message.payload);
          } catch (err) {
            log.error('Error in doJob:', err, { job: message.payload });
          }
        })();
        return;
      }
    };

    const managerChannel = config.pubsub.manager.from;
    const selfChannel = config.pubsub.workers.to + this.w.wId;

    this._sub.pSubscribe(managerChannel, this._messageHandler);
    this._sub.pSubscribe(selfChannel, this._messageHandler);

    this._pubChannel = config.pubsub.workers.from + this.w.wId;
    log.pubsub?.(`Publishing to ${this._pubChannel}`);
    log.pubsub?.('Subscribed to', [managerChannel, selfChannel]);
  }

  pub({ type, payload }: Message) {
    log.pubsub?.('Publishing message to ' + this._pubChannel.replace(/-.*$/, ''), type);
    if (Object.keys(payload).length) {
      log.debug('', payload);
    }
    this._pub.publish(this._pubChannel, JSON.stringify({ type, payload }));
  }

  async doJob(job: Exclude<JobRequest, ResourceCrawlJobRequest | ResourceLabelFetchJobRequest>) {
    const origin =
      job.type === 'domainCrawl'
        ? job.domain.origin
        : job.type === 'robotsCheck'
          ? job.origin
          : job.domain;
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
      log.warn(`No capacity for job ${job.type} on ${origin}, so job #${job.jobId} was refused.`);
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
        try {
          this.pub({ type: 'jobDone', payload: x });
        } catch (pubErr) {
          log.error('Failed to publish jobDone for resource:', pubErr, {
            url: x.url,
            jobId: job.jobId
          });
          // Continue processing; generator will still complete
        }
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
      try {
        this.pub({
          type: 'jobDone',
          payload: jobResult
        });
      } catch (pubErr) {
        log.error('Failed to publish final jobDone:', pubErr, {
          jobId: job.jobId,
          origin: job.domain.origin
        });
      }
      // this.reportCurrentCapacity();
      return;
    }
    if (job.type === 'domainLabelFetch') {
      const total = job.resources.length;
      const resourcesToDo = new Set<string>(job.resources.map((r) => r.url));
      const resourcesDone = new Set<string>();
      let i = 0;
      for await (const x of this.w.fetchDomainLabels(job)) {
        log.info(
          `Finished resourceLabelFetch ${++i}/${total} of ${job.domain.origin} (job #${job.jobId})`
        );
        if (x.status === 'ok') {
          resourcesToDo.delete(x.url);
          resourcesDone.add(x.url);
        }
        try {
          this.pub({ type: 'jobDone', payload: x });
        } catch (pubErr) {
          log.error('Failed to publish jobDone for resource label:', pubErr, {
            url: x.url,
            jobId: job.jobId
          });
        }
      }
      const jobResult: FetchLabelsDomainResult = {
        jobId: job.jobId,
        status: 'ok' as const,
        jobType: 'domainLabelFetch' as const,
        origin: job.domain.origin,
        details: {
          labeledResources: Array.from(resourcesDone),
          nonLabeledResources: Array.from(resourcesToDo)
        }
      };
      try {
        this.pub({
          type: 'jobDone',
          payload: jobResult
        });
      } catch (pubErr) {
        log.error('Failed to publish final labelFetch jobDone:', pubErr, {
          jobId: job.jobId,
          origin: job.domain.origin
        });
      }
    }
  }

  /**
   * Report current capacity to Manager
   */
  reportCurrentCapacity() {
    const jc = this.w.currentCapacity();
    const cj = this.w.currentJobs;
    log.silly('Reporting current capacity', { jobCapacity: jc, currentJobs: cj });
    this.pub({ type: 'repCurCap', payload: jc });
  }

  askJobs() {
    const jc = this.w.currentCapacity();
    this.pub({ type: 'askJobs', payload: jc });
  }
}