import redis from 'redis';
import config from '@derzis/config';
import {createLogger} from '@derzis/common'
const log = createLogger('Manager');
import Manager from './Manager'
import process from 'process';

type PayloadType = 'askCurCap' | 'jobTimeout' | 'doJob' | 'jobDone' | 'shutdown' | 'repCurCap' | 'askJobs';

class ManagerPubSub {
  _m: Manager;
  _redisClient: ReturnType<typeof redis.createClient>;
  _broad: ReturnType<typeof redis.createClient>;
  _pub: ReturnType<typeof redis.createClient>;
  _sub: ReturnType<typeof redis.createClient>;
  _pubChannel: string;
  _broadChannel: string;

  constructor(){
    this._m = new Manager();
    this.listenManager();
  }

  listenManager(){
    this._m.jobs.on('jobTimeout', (domain, jobType) => {
      return this.broad('jobTimeout', {domain});
    });
  }

  async start(){
    log.info('Started');
    log.info('Connecting to MongoDB');
    await this._m.connect();
    await this._m.jobs.cleanJobs();
    await this.connect();
    //await this._m.startNewProcess();
    this.askCurrentCapacity();
  }

  async connect(){
    log.info('Connecting to Redis');
    const options = {
      host: config.pubsub.host,
      port: config.pubsub.port
    };
await this._redisClient.connect();
    this._pub = this._redisClient.duplicate();
    this._sub = this._redisClient.duplicate();
    this._broad = this._redisClient.duplicate();
    await this._pub.connect();
    await this._sub.connect();
    await this._broad.connect();

    process.on('uncaughtException' , (...args) => {
      log.error('Uncaught exception', args);
      process.exit(1);
    });

    log.pubsub(`Subscribing to ${config.pubsub.workers.from.replace(/-.*$/,'')}*`);


    const handleMessage = (message: string, channel: string) => {
      const workerId = channel.match(/:([-\w]+)$/)[1];
      const payload = JSON.parse(message);
      log.pubsub('Got message from '+channel.replace(/-.*$/,''), payload.type)
      if(Object.keys(payload.data).length){ log.debug('', payload.data); }
      if(payload.type === 'repCurCap'){
        return this.assignJobs(workerId, payload.data);
      }
      if(payload.type === 'jobDone'){
        return this._m.updateJobResults(payload.data);
      }
      if(payload.type === 'shutdown'){
        this._m.jobs.cancelJobs(payload.data.ongoingJobs, workerId);
      }
      if(payload.type === 'noCapacity'){
        // return this._cancelJob(payload.data);
      }
    };

    this._sub.pSubscribe(config.pubsub.workers.from+'*', handleMessage);

    this._broadChannel = config.pubsub.manager.from;
    log.pubsub(`Broadcasting to ${this._broadChannel}`);
    this._pubChannel = config.pubsub.workers.to;
    log.pubsub(`Publishing to ${this._pubChannel}{workerId}`);
  }

  pub(workerId: string, type: PayloadType, data: {jobType: JobType, data: Job){
    const payload = {type, data};
    const channel = this._pubChannel+workerId;
    log.pubsub('Publishing message to '+channel.replace(/-.*$/,''), type);
    if(Object.keys(data).length){ log.debug('', data); }
    this._pub.publish(channel, JSON.stringify(payload));
  }

  broad(type, data = {}){
    const payload = {type, data};
    log.pubsub('Broadcasting message to '+this._broadChannel, type);
    if(Object.keys(data).length){ log.debug('', data); }
    this._broad.publish(this._broadChannel, JSON.stringify(payload));
  }

  askCurrentCapacity(workerId?){
    if(workerId){ return this.pub(workerId, 'askCurCap'); }
    return this.broad('askCurCap');
  }

  //askStatus(workerId){
  //  if(workerId){ return this.pub(workerId, 'askStatus'); }
  //  return this.broad('askStatus');
  //}

  async assignJobs(workerId, workerAvail){
    for await(const job of this._m.assignJobs(workerId, workerAvail)){
      this.pub(workerId, 'doJob', job);
    }
  }
};
export default ManagerPubSub;

