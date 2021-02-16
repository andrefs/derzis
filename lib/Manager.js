const redis = require('redis');

const config = {
  pubsub: {
    manager: {
      channel: 'derzis:manager'
    },
    workers: {
      channel: 'derzis:workers:'
    }
  }
};

class Manager {
  constructor(){
    this.log('Started');
    this._workers = {};
    this._jobs = {};
    this.connect();
  }

  connect(){
    this.log('Connecting to Redis');
    this._pub = redis.createClient();
    this._sub = redis.createClient();
    this.log(`Subscribing to ${config.pubsub.workers.channel}*`);
    this._sub.psubscribe(config.pubsub.workers.channel+'*');
    this._subEvents();
    this._pubChannel = config.pubsub.manager.channel;
    this.log(`Publishing to ${this._pubChannel}`);
  }

  log(...messages){
    console.info(`[${this._id}]`, messages);
  }

  pub(payload){
    this._pub.publish(this._pubChannel, JSON.stringify(payload));
  }

  _subEvents(){
    const dispatch = {
      'status_info': this._updateWorkerStatus
    };
    this._sub.on('pmessage', (pattern, channel, message) => {
      this.log('Got', channel, message);
      const workerId = channel.match(/:(W#\d+)/)[1];
      const payload = JSON.parse(message);
      if(payload.type === 'status_info'){
        return this._updateWorkerStatus(workerId, payload.data);
      }
    });
  }

  _askStatusInfo(){
    this.pub({type:'get_status', data:{cenas:1}});
  }

  _updateWorkerStatus(workerId, data){
    this._workers[workerId] = data;
  }
};

module.exports = Manager;
