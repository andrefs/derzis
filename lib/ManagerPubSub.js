const redis = require('redis');
const config = require('../config');
const log = require('./logger')('Manager');
const Manager = require('./Manager');


class ManagerPubSub {
  constructor(){
    log.info('Started');
    this.connect();
    this.askCurrentCapacity();
  }

  connect(){
    log.info('Connecting to Redis');
    this._pub = redis.createClient();
    this._broad = redis.createClient();
    this._sub = redis.createClient();

    log.pubsub(`Subscribing to ${config.pubsub.workers.from}*`);
    this._sub.psubscribe(config.pubsub.workers.from+'*');

    this._broadChannel = config.pubsub.manager.from;
    log.pubsub(`Broadcasting to ${this._broadChannel}`);
    this._pubChannel = config.pubsub.workers.to;
    log.pubsub(`Publishing to ${this._pubChannel}{workerId}`);

    this._subEvents();
  }

  pub(workerId, type, data = {}){
    const payload = {type, data};
    const channel = this._pubChannel+workerId;
    log.pubsub('Publishing message to '+channel, type);
    if(Object.keys(data).length){ log.debug('', data); }
    this._pub.publish(channel, JSON.stringify(payload));
  }

  broad(type, data = {}){
    const payload = {type, data};
    log.pubsub('Broadcasting message to '+this._broadChannel, type);
    if(Object.keys(data).length){ log.debug('', data); }
    this._broad.publish(this._broadChannel, JSON.stringify(payload));
  }

  _subEvents(){
    this._sub.on('pmessage', (pattern, channel, message) => {
      const workerId = channel.match(/:(W#\d+)/)[1];
      const payload = JSON.parse(message);
      log.pubsub('Got message from '+channel,payload.type)
      if(Object.keys(payload.data).length){ log.debug('', payload.data); }
      if(payload.type === 'repCurCap'){
        return this.assignJobs(workerId, payload.data);
      }
      if(payload.type === 'jobDone'){
        return Manager.updateJobResults(payload.data);
      }
      if(payload.type === 'shutdown'){
        Manager.cancelJobs(payload.data.ongoingJobs);
      }
      if(payload.type === 'noCapacity'){
        // return this._cancelJob(payload.data);
      }
    });
  }

  askCurrentCapacity(workerId){
    if(workerId){
      return this.pub(workerId, 'askCurCap');
    }
    return this.broad('askCurCap');
  }

  askStatus(workerId){
    if(workerId){
      return this.pub(workerId, 'askStatus');
    }
    return this.broad('askStatus');
  }

  async assignJobs(workerId, workerAvail){
    for await(const job of Manager.assignJobs(workerId, workerAvail)){
      this.pub(workerId, 'doJob', job);
    }
  }
};

module.exports = ManagerPubSub;