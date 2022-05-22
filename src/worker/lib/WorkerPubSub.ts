import redis  from 'redis';
import config from '../../config';
const redisOpts = {url : `redis://{config.pubsub.host}:{config.pubsub.port}`};
import {pid} from 'process';
import {Job, Worker} from './Worker';
import logger from '../../common/lib/logger';
let log: winston.Logger;
import util from 'util';
import winston from 'winston';
import { RedisClientType } from '@redis/client';

type PayloadType = 'askCurCap' | 'jobTimeout' | 'doJob' | 'jobDone';


interface Payload {
  type: PayloadType;
  data: Job
};


class WorkerPubSub {
  w: Worker;
  _redisClient: ReturnType<typeof redis.createClient>;
  _http: ReturnType<typeof redis.createClient>;
  _pub: ReturnType<typeof redis.createClient>;
  _sub: ReturnType<typeof redis.createClient>;
  _pubChannel: string;

  constructor(opts = {}){
    // FIXME Workers on different machines may have same PID
    this.w = new Worker('W#'+pid);
    this._redisClient = redis.createClient(redisOpts);


    log = logger(this.w.wShortId);
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
      this.pub('shutdown', {signal, opts, ongoingJobs: this.w.currentJobs});
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
    await this._pub.connect();
    this._sub = this._redisClient.duplicate();
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


    const handleMessage = (channel: string) =>  (message: string) => {
      const payload: Payload = JSON.parse(message);
      log.pubsub('message from '+channel, payload.type);
      if(Object.keys(payload.data).length){ log.debug('', payload.data); }


      if(payload.type === 'askCurCap'){
        return this.reportCurrentCapacity();
      }
      if(payload.type === 'jobTimeout'){
        if(this.w.currentJobs.domainCrawl[payload.data.domain]){
          this.w.jobsTimedout[payload.data.domain] = true;
        }
      }
      if(payload.type === 'doJob'){
        return this.doJob(payload.data);
      }
    };

    this._pubChannel = config.pubsub.workers.from+this.w.wId;
    log.pubsub(`Publishing to ${this._pubChannel}`);
    log.pubsub('Subscribing to', [config.pubsub.manager.from, config.pubsub.workers.to+this.w.wId]);
    this._sub.subscribe(config.pubsub.manager.from, handleMessage(config.pubsub.manager.from));
    this._sub.subscribe(config.pubsub.workers.to+this.w.wId, handleMessage(config.pubsub.workers.to+this.w.wId));
  }

  pub(type: PayloadType, data: PayloadData = {}){
    const payload = {type, data};
    log.pubsub('Publishing message to '+this._pubChannel.replace(/-.*$/,''), type);
    if(Object.keys(data).length){ log.debug('', data); }
    this._pub.publish(this._pubChannel, JSON.stringify(payload));
  }

  // TODO check capacity
  async doJob(job: Job){
    const {jobType} = job;
    if(!this.w.hasCapacity(jobType)){ } // TODO

    if(job.jobType === 'robotsCheck'){
      const res = await this.w.checkRobots(job.domain);
      this.pub('jobDone', {
        jobType: job.jobType,
        domain: job.domain,
        results: res
      });
      //this.reportCurrentCapacity();
      return;
    }
    if(job.jobType === 'domainCrawl'){
      let total = job.resources.length;
      let i = 0;
      for await(const x of this.w.crawlDomain(job)){
        log.info(`Finished resourceCrawl ${++i}/${total} of ${job.domain.origin}`);
        this.pub('jobDone', {
          jobType: 'resourceCrawl',
          domain: job.domain.origin,
          url: x.url,
          results: x.results
        });
      }
      this.pub('jobDone', {
        jobType: 'domainCrawl',
        domain: job.domain.origin,
        results: {ok: true}
      });
      //this.reportCurrentCapacity();
      return;
    }
  }

  reportCurrentCapacity(){
    const av = this.w.availability();
    this.pub('repCurCap', av);
  }

  askJobs(){
    const av = this.w.availability();
    this.pub('askJobs', av);
  }

};

module.exports = WorkerPubSub;
