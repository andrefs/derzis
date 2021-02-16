const redis = require('redis');
const pid = require('process').pid;

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

class Worker {
  constructor(){
    this._id = 'W#'+pid;
    this.log('Started');
    this.connect();
  }

  connect(){
    this.log('Connecting to Redis');
    this._pub = redis.createClient();
    this._sub = redis.createClient();
    this.log(`Subscribing to ${config.pubsub.manager.channel}`);
    this._sub.subscribe(config.pubsub.manager.channel);
    this._subEvents();
    this._pubChannel = config.pubsub.workers.channel + this._id;
    this.log(`Publishing to ${this._pubChannel}`);
  }

  log(...messages){
    console.info(`[${this._id}]`, messages);
  }

  pub(payload){
    this.log('Sending', this._pubChannel, payload);
    this._pub.publish(this._pubChannel, JSON.stringify(payload));
  }

  _subEvents(){
    const dispatch = {
      get_status: this._sendStatus
    };
    this._sub.on('message', (channel, message) => {
      this.log('Got', channel, message);
      const payload = JSON.parse(message);
      if(payload.type === 'get_status'){
        return this._sendStatus(payload.data);
      }
    });
  }

  _sendStatus(){
    const payload = {type: 'status_info', data: {ok:1}};
    this.pub(payload);
  }

};

module.exports = Worker;
