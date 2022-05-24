import redis  from 'redis';
import config from '@derzis/config';
const redisOpts = {url : `redis://{config.pubsub.host}:{config.pubsub.port}`};
import {JobCapacity, JobResult, JobType, Worker} from './Worker';
import {createLogger} from '@derzis/common';
let log: winston.Logger ;
import winston from 'winston';
import { IDomain } from '@derzis/models';
import { OngoingJobs } from '@derzis/manager';


export interface BaseJobRequest { type: JobType };
export interface RobotsCheckJobRequest extends BaseJobRequest { type: 'robotsCheck', origin: string };
export interface ResourceCrawlJobRequest extends BaseJobRequest { type: 'resourceCrawl', origin: string, url: string };
export interface DomainCrawlJobRequest extends BaseJobRequest { type: 'domainCrawl', domain: IDomain, resources: {url: string}[] };
export type JobRequest = RobotsCheckJobRequest | ResourceCrawlJobRequest | DomainCrawlJobRequest;

export type MessageType = 'askCurCap' | 'jobTimeout' | 'doJob' | 'jobDone' | 'shutdown' | 'repCurCap' | 'askJobs' | 'noCapacity';
export interface BaseMessage { type: MessageType, payload: object };
export interface ShutdownMessage extends BaseMessage {
  type: 'shutdown'
  payload: {
    signal: string,
    ongoingJobs: OngoingJobs
  }
};
export interface JobTimeoutMessage extends BaseMessage {
  type: 'jobTimeout',
  payload: {
    domain: string
  }
}
export interface AskCurCapMessage extends BaseMessage { type: 'askCurCap' };
export interface RepCurCapMessage extends BaseMessage { type: 'repCurCap', payload: JobCapacity };
export interface AskJobsMessage extends BaseMessage { type: 'askJobs', payload: JobCapacity };
export interface DoJobMessage extends BaseMessage { type: 'doJob', payload:  JobRequest };
export interface JobDoneMessage extends BaseMessage { type: 'jobDone', payload: JobResult };
export interface NoCapacityMessage extends BaseMessage { type: 'noCapacity' };
export type Message = ShutdownMessage | JobTimeoutMessage | AskCurCapMessage | RepCurCapMessage | AskJobsMessage | DoJobMessage | JobDoneMessage | NoCapacityMessage;


export class WorkerPubSub {
  w: Worker;
  _redisClient: ReturnType<typeof redis.createClient>;
  _http: ReturnType<typeof redis.createClient>;
  _pub: ReturnType<typeof redis.createClient>;
  _sub: ReturnType<typeof redis.createClient>;
  _pubChannel: string;

  constructor(){
    // FIXME Workers on different machines may have same PID
    this.w = new Worker();
    this._redisClient = redis.createClient(redisOpts);


    log = createLogger(this.w.wShortId);
    log.info('Started');
    this.connect();
    this.reportCurrentCapacity();
    if(config.periodicallyRepCurCap){
      const interval = config.periodicallyRepCurCap;
      const initDelay = 1000*(Math.floor(Math.random()*20)+1);
      setTimeout(() => {
        setInterval(() => this.reportCurrentCapacity(), interval);
      }, initDelay);
    }
  }

  exitHandler = (opts = {}) => {
    return ({signal}: {signal: string}) => {
      this.pub({type: 'shutdown', payload: {...opts, signal, ongoingJobs: this.w.currentJobs}});
      process.exit(signal ? 1 : 0);
    };
  };

  signalHandler = () => {
    return () => this.reportCurrentCapacity();
  }

  async connect(){
    log.info('Connecting to Redis');
    await this._redisClient.connect();
    this._pub = this._redisClient.duplicate();
    this._sub = this._redisClient.duplicate();
    await this._pub.connect();
    await this._sub.connect();

    if(config.http.debug){
      this._http = this._redisClient.duplicate();
      await this._http.connect();
      this.w.on('httpDebug', ev => this._http.publish(config.http.debug.pubsubChannel, JSON.stringify(ev, null, 2)));
    }

    process.on('SIGINT'            , this.exitHandler({signal: 'SIGINT'}));
    process.on('SIGUSR1'           , this.signalHandler());
    process.on('SIGUSR2'           , this.signalHandler());
    process.on('uncaughtException' , (...args) => log.error('Uncaught exception', args));


    const handleMessage = (channel: string) =>  (msg: string) => {
      const {type, payload}: Message = JSON.parse(msg);
      log.pubsub('message from '+channel, type);
      if(Object.keys(payload).length){ log.debug('', payload); }


      if(type === 'askCurCap'){
        return this.reportCurrentCapacity();
      }
      if(type === 'jobTimeout'){
        if(this.w.currentJobs.domainCrawl[payload.domain]){
          this.w.jobsTimedout[payload.domain] = true;
        }
        return;
      }
      if(type === 'doJob'){
        return this.doJob(payload);
      }
    };

    this._pubChannel = config.pubsub.workers.from+this.w.wId;
    log.pubsub(`Publishing to ${this._pubChannel}`);
    log.pubsub('Subscribing to', [config.pubsub.manager.from, config.pubsub.workers.to+this.w.wId]);
    this._sub.subscribe(config.pubsub.manager.from, handleMessage(config.pubsub.manager.from));
    this._sub.subscribe(config.pubsub.workers.to+this.w.wId, handleMessage(config.pubsub.workers.to+this.w.wId));
  }

  pub({type, payload}: Message){
    log.pubsub('Publishing message to '+this._pubChannel.replace(/-.*$/,''), type);
    if(Object.keys(payload).length){ log.debug('', payload); }
    this._pub.publish(this._pubChannel, JSON.stringify({type, payload}));
  }

  // TODO check capacity
  async doJob(job: JobRequest){
    if(!this.w.hasCapacity(job.type)){ } // TODO

    if(job.type === 'robotsCheck'){
      const res = await this.w.checkRobots(job.origin);
      this.pub({
        type: 'jobDone',
        payload: res
      });
      //this.reportCurrentCapacity();
      return;
    }
    if(job.type === 'domainCrawl'){
      let total = job.resources.length;
      let i = 0;
      for await(const x of this.w.crawlDomain(job)){
        log.info(`Finished resourceCrawl ${++i}/${total} of ${job.domain.origin}`);
        this.pub({ type: 'jobDone', payload: x });
      }
      this.pub({
        type:'jobDone',
        payload: {
          status: 'ok' as const,
          jobType: 'domainCrawl',
          origin: job.domain.origin,
          details: {}
        }
      });
      //this.reportCurrentCapacity();
      return;
    }
  }

  reportCurrentCapacity(){
    const jc = this.w.jobCapacity;
    this.pub({type: 'repCurCap', payload: jc});
  }

  askJobs(){
    const jc = this.w.jobCapacity;
    this.pub({type: 'askJobs', payload: jc});
  }

};

