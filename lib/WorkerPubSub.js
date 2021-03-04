const redis = require('redis');
const pid = require('process').pid;
const Worker = require('./Worker');
const config = require('../config');
const logger = require('./logger');
let log;
const util = require('util');

class WorkerPubSub {
  constructor(opts = {}){
    // FIXME Workers on different machines may have same PID
    this.w = new Worker('W#'+pid);

    log = logger(this.w.wId);
    log.info('Started');
    this.connect();
    this.reportCurrentCapacity();
  }

  connect(){
    log.info('Connecting to Redis');
    this._pub = redis.createClient();
    this._sub = redis.createClient();

    this.exitHandler = (opts = {}) => {
      return (...args) => {
        this.pub('shutdown', args, opts, {ongoingJobs: this._currentJobs});
        process.exit(args[0] || 0);
      };
    };

    process.on('SIGINT'            , this.exitHandler({signal: 'SIGINT'}));
    //process.on('exit'              , this.exitHandler({signal: 'exit'}));
    process.on('uncaughtException' , this.exitHandler({signal: 'uncaughtException'}));
    process.on('SIGUSR1'           , this.exitHandler({signal: 'SIGUSR1'}));
    process.on('SIGUSR2'           , this.exitHandler({signal: 'SIGUSR2'}));

    log.pubsub('Subscribing to', [config.pubsub.manager.from, config.pubsub.workers.to+this.w.wId]);
    this._sub.subscribe(config.pubsub.manager.from, config.pubsub.workers.to+this.w.wId);

    this._pubChannel = config.pubsub.workers.from+this.w.wId;
    log.pubsub(`Publishing to ${this._pubChannel}`);

    this._subEvents();
  }

  pub(type, data = {}){
    const payload = {type, data};
    log.pubsub('Publishing message to '+this._pubChannel, type);
    if(Object.keys(data).length){ log.debug('', data); }
    this._pub.publish(this._pubChannel, JSON.stringify(payload));
  }

  _subEvents(){
    const dispatch = {
      get_status: this._sendStatus
    };
    this._sub.on('message', (channel, message) => {
      const payload = JSON.parse(message);
      log.pubsub('message from '+channel, payload.type);
      if(Object.keys(payload.data).length){ log.debug('', payload.data); }


      if(payload.type === 'askCurCap'){
        return this.reportCurrentCapacity(payload.data);
      }
      if(payload.type === 'doJob'){
        return this.doJob(payload.data);
      }
    });
  }

  // TODO check capacity
  async doJob(job){
    const {jobType} = job;
    if(!this.w.hasCapacity(jobType)){ } // TODO

    if(job.jobType === 'domainCheck'){
      const res = await this.w.checkDomain(job.host);
      this.pub('jobDone', {
        jobType: job.jobType,
        host: job.host,
        ...res
      });
      return;
    }
    if(job.jobType === 'domainCrawl'){
      for await(const res of this.w.crawlDomain(job)){
        this.pub('jobDone', {
          jobType: 'resourceCrawl',
          host: job.domain.host,
          url: res.url,
          results: res
        });
      }
      this.pub('jobDone', {
        jobType: 'domainCrawl',
        host: job.domain.host
      });
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
