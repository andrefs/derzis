const redis = require('redis');
const config = require('../config');
const redisOpts = {
  host: config.pubsub.host,
  port: config.pubsub.port
};
const pid = require('process').pid;
const Worker = require('./Worker');
const logger = require('../../common/lib/logger');
let log;
const util = require('util');

class WorkerPubSub {
  constructor(opts = {}){
    // FIXME Workers on different machines may have same PID
    this.w = new Worker('W#'+pid);

    if(config.http.debug){
      this._http = redis.createClient(redisOpts);
      this.w.on('httpDebug', ev => this._http.publish(config.http.debug.pubsubChannel, JSON.stringify(ev, null, 2)));
    }

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
    return (...args) => {
      this.pub('shutdown', {args, opts, ongoingJobs: this.w.currentJobs});
      process.exit(args[0] || 0);
    };
  };

  signalHandler = () => {
    return () => this.reportCurrentCapacity();
  }

  connect(){
    log.info('Connecting to Redis');
    this._pub = redis.createClient(redisOpts);
    this._sub = redis.createClient(redisOpts);

    process.on('SIGINT'            , this.exitHandler({signal: 'SIGINT'}));
    process.on('SIGUSR1'           , this.signalHandler());
    process.on('SIGUSR2'           , this.signalHandler());
    process.on('uncaughtException' , (...args) => log.error('Uncaught exception', args));

    log.pubsub('Subscribing to', [config.pubsub.manager.from, config.pubsub.workers.to+this.w.wId]);
    this._sub.subscribe(config.pubsub.manager.from, config.pubsub.workers.to+this.w.wId);

    this._pubChannel = config.pubsub.workers.from+this.w.wId;
    log.pubsub(`Publishing to ${this._pubChannel}`);

    this._subEvents();
  }

  pub(type, data = {}){
    const payload = {type, data};
    log.pubsub('Publishing message to '+this._pubChannel.replace(/-.*$/,''), type);
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
      if(payload.type === 'jobTimeout'){
        if(this.w.currentJobs.domainCrawl[payload.data.domain]){
          this.w.jobsTimedout[payload.data.domain] = true;
        }
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