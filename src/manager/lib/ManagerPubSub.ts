import redis from 'redis';
import config from '@derzis/config';
import {createLogger} from '@derzis/common'
const log = createLogger('Manager');
import Manager from './Manager'
import process from 'process';
import { JobCapacity, Message } from '@derzis/worker';
const redisOpts = {url : `redis://${config.pubsub.host}:${config.pubsub.port}`};

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
    this._redisClient = redis.createClient(redisOpts);
    this.listenManager();
  }

  listenManager(){
    this._m.jobs.on('jobTimeout', ({origin}) => {
      return this.broad({type: 'jobTimeout', payload: {origin}});
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


    const handleMessage = (msg: string, channel: string) => {
      const workerId = channel.match(/:([-\w]+)$/)[1];
      const message: Message = JSON.parse(msg);
      log.pubsub('Got message from '+channel.replace(/-.*$/,''), message.type)
      if(Object.keys(message.payload).length){ log.debug('', message.payload); }
      if(message.type === 'repCurCap'){
        return this.assignJobs(workerId, message.payload);
      }
      if(message.type === 'jobDone'){
        return this._m.updateJobResults(message.payload);
      }
      if(message.type === 'shutdown'){
        this._m.jobs.cancelJobs(message.payload.ongoingJobs, workerId);
      }
      if(message.type === 'noCapacity'){
        // return this._cancelJob(payload.data);
      }
    };

    this._sub.pSubscribe(config.pubsub.workers.from+'*', handleMessage);

    this._broadChannel = config.pubsub.manager.from;
    log.pubsub(`Broadcasting to ${this._broadChannel}`);
    this._pubChannel = config.pubsub.workers.to;
    log.pubsub(`Publishing to ${this._pubChannel}{workerId}`);
  }

  pub(workerId: string, {type, payload}: Message){
    const channel = this._pubChannel+workerId;
    log.pubsub('Publishing message to '+channel.replace(/-.*$/,''), type);
    if(Object.keys(payload).length){ log.debug('', payload); }
    this._pub.publish(channel, JSON.stringify({type, payload}));
  }

  broad({type, payload}: Message){
    log.pubsub('Broadcasting message to '+this._broadChannel, type);
    if(Object.keys(payload).length){ log.debug('', payload); }
    this._broad.publish(this._broadChannel, JSON.stringify({type, payload}));
  }

  askCurrentCapacity(workerId?: string){
    const message = {type: 'askCurCap' as const, payload:{}};
    if(workerId){ return this.pub(workerId, message); }
    return this.broad(message);
  }

  //askStatus(workerId){
  //  if(workerId){ return this.pub(workerId, 'askStatus'); }
  //  return this.broad('askStatus');
  //}

  async assignJobs(workerId: string, workerAvail: JobCapacity){
    for await(const job of this._m.assignJobs(workerId, workerAvail)){
      this.pub(workerId, {type: 'doJob', payload: job});
    }
  }
};
export default ManagerPubSub;

