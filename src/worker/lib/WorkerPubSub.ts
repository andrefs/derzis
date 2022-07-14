import config from '@derzis/config';
import {createClient} from 'redis';

const redisOpts = {
  url : `redis://${config.pubsub.host}:${config.pubsub.port}`
};
import {JobCapacity, JobResult, JobType, Worker} from './Worker';
import {createLogger} from '@derzis/common';
import {MonkeyPatchedLogger} from '@derzis/common';
let log: MonkeyPatchedLogger;
import {IDomain} from '@derzis/models';
import {OngoingJobs} from '@derzis/manager';

export interface BaseJobRequest {
  type: JobType,
  jobId: number,
}
;
export interface RobotsCheckJobRequest extends BaseJobRequest {
  type: 'robotsCheck', origin: string
}
;
export interface ResourceCrawlJobRequest extends BaseJobRequest {
  type: 'resourceCrawl', origin: string, url: string
}
;
export interface DomainCrawlJobRequest extends BaseJobRequest {
  type: 'domainCrawl', domain: IDomain, resources: {url: string}[]
}
;
export type JobRequest =
    RobotsCheckJobRequest|ResourceCrawlJobRequest|DomainCrawlJobRequest;

export type MessageType = 'askCurCap'|'jobTimeout'|'doJob'|'jobDone'|'shutdown'|
    'repCurCap'|'askJobs'|'noCapacity'|'alreadyBeingDone';
export interface BaseMessage {
  type: MessageType, payload: object
}
;
export interface ShutdownMessage extends BaseMessage {
  type: 'shutdown'
  payload: {signal: string, ongoingJobs: OngoingJobs}
}
;
export interface JobTimeoutMessage extends BaseMessage {
  type: 'jobTimeout', payload: {origin: string}
}
export interface AskCurCapMessage extends BaseMessage {
  type: 'askCurCap'
}
;
export interface RepCurCapMessage extends BaseMessage {
  type: 'repCurCap', payload: JobCapacity
}
;
export interface AskJobsMessage extends BaseMessage {
  type: 'askJobs', payload: JobCapacity
}
;
export interface DoJobMessage extends BaseMessage {
  type: 'doJob', payload: Exclude<JobRequest, ResourceCrawlJobRequest>
}
;
export interface JobDoneMessage extends BaseMessage {
  type: 'jobDone', payload: JobResult
}
;
export interface NoCapacityMessage extends BaseMessage {
  type: 'noCapacity',
  payload: {
    origin: string,
    jobType: Exclude<JobType, 'resourceCrawl'>,
    jobId: number
  }
}
;
export interface AlreadyBeingDoneMessage extends BaseMessage {
  type: 'alreadyBeingDone',
  payload: {
    origin: string,
    jobType: Exclude<JobType, 'resourceCrawl'>,
    jobId: number
  }
}
;
export type Message = ShutdownMessage|JobTimeoutMessage|AskCurCapMessage|
    RepCurCapMessage|AskJobsMessage|DoJobMessage|JobDoneMessage|
    NoCapacityMessage|AlreadyBeingDoneMessage;

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
    return ({signal}: {signal: string}) => {
      this.pub({
        type : 'shutdown',
        payload : {...opts, signal, ongoingJobs : this.w.currentJobs}
      });
      process.exit(signal ? 1 : 0);
    };
  };

  signalHandler = () => {
    return () => this.reportCurrentCapacity();
  }

  async start(){
    log.info('Started');
    await this.connect();
    this.reportCurrentCapacity();
    if (config.periodicallyRepCurCap) {
      const interval = config.periodicallyRepCurCap;
      const initDelay = 1000 * (Math.floor(Math.random() * 20) + 1);
      setTimeout(
          () => { setInterval(() => this.reportCurrentCapacity(), interval); },
          initDelay);
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
      this.w.on('httpDebug',
                ev => this._http.publish(config.http.debug.pubsubChannel,
                                         JSON.stringify(ev, null, 2)));
    }

    process.on('SIGINT', this.exitHandler({signal : 'SIGINT'}));
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
    log.pubsub?.(
        'Subscribing to',
        [ config.pubsub.manager.from, config.pubsub.workers.to + this.w.wId ]);
    this._sub.subscribe(config.pubsub.manager.from,
                        handleMessage(config.pubsub.manager.from));
    this._sub.subscribe(config.pubsub.workers.to + this.w.wId,
                        handleMessage(config.pubsub.workers.to + this.w.wId));
  }

  pub({type, payload}: Message) {
    log.pubsub?.(
        'Publishing message to ' + this._pubChannel.replace(/-.*$/, ''), type);
    if (Object.keys(payload).length) {
      log.debug('', payload);
    }
    this._pub.publish(this._pubChannel, JSON.stringify({type, payload}));
  }

  async doJob(job: Exclude<JobRequest, ResourceCrawlJobRequest>) {
    const origin = job.type === 'domainCrawl' ? job.domain.origin : job.origin;
    if (this.w.alreadyBeingDone(origin, job.type)) {
      log.error(`Job ${job.type} on ${origin} already being done, so job #${job.jobId} was refused.`);
      this.pub({type : 'alreadyBeingDone', payload: {jobType: job.type, origin, jobId: job.jobId}});
      return;
    }
    if (!this.w.hasCapacity(job.type)) {
      log.error(`No capacity for job ${job.type} on ${origin}, so job #${job.jobId} was refused.`);
      this.pub({type : 'noCapacity', payload: {jobType: job.type, origin, jobId: job.jobId}});
      return;
    }

    if (job.type === 'robotsCheck') {
      const res = await this.w.checkRobots(job.jobId, job.origin);
      this.pub({type : 'jobDone', payload : res});
      // this.reportCurrentCapacity();
      return;
    }
    if (job.type === 'domainCrawl') {
      let total = job.resources.length;
      let i = 0;
      for await (const x of this.w.crawlDomain(job)) {
        log.info(
            `Finished resourceCrawl ${++i}/${total} of ${job.domain.origin} (job #${job.jobId})`);
        this.pub({type : 'jobDone', payload : x});
      }
      this.pub({
        type : 'jobDone',
        payload : {
          jobId: job.jobId,
          status : 'ok' as const,
          jobType : 'domainCrawl',
          origin : job.domain.origin,
          details : {}
        }
      });
      // this.reportCurrentCapacity();
      return;
    }
  }

  reportCurrentCapacity() {
    const jc = this.w.jobCapacity;
    this.pub({type : 'repCurCap', payload : jc});
  }

  askJobs() {
    const jc = this.w.jobCapacity;
    this.pub({type : 'askJobs', payload : jc});
  }
};
