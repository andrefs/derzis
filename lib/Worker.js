const redis = require('redis');
const axios = require('axios');
const pid = require('process').pid;
const config = require('../config');

class Worker {
  constructor(){
    this._id = 'W#'+pid;
    this.log('Started');
    this.connect();
    this._sendStatus();
  }

  connect(){
    this.log('Connecting to Redis');
    this._pub = redis.createClient();
    this._sub = redis.createClient();

    process.on('SIGINT', () => {
      this.pub('shutdown');
      process.exit();
    });

    this.log(`Subscribing to\n\t${config.pubsub.manager.from}\n\t${config.pubsub.workers.to+this._id}`);
    this._sub.subscribe(config.pubsub.manager.from, config.pubsub.workers.to+this._id);

    this._pubChannel = config.pubsub.workers.from+this._id;
    this.log(`Publishing to ${this._pubChannel}`);

    this._subEvents();
  }

  log(...messages){
    console.info(`[${this._id}]`, messages);
  }

  pub(type, data = {}){
    const payload = {type, data};
    this.log('Publishing', this._pubChannel, payload);
    this._pub.publish(this._pubChannel, JSON.stringify(payload));
  }

  _subEvents(){
    const dispatch = {
      get_status: this._sendStatus
    };
    this._sub.on('end', (...args) => console.log('XXXXXXXXXXXXXXXx ending', args));
    this._sub.on('message', (channel, message) => {
      this.log('Got', channel, message);
      const payload = JSON.parse(message);
      if(payload.type === 'get_status'){
        return this._sendStatus(payload.data);
      }
      if(payload.type === 'domain_check'){
        return this._domainCheck(payload.data);
      }
    });
  }

  _domainCheck(info){
    const url = info.host+'/robots.txt';
    let res = {
      host: info.host
    };
    axios.get(url, {headers: {'User-Agent': config.userAgent}})
      .then(resp => {
        res.actualHost = resp.request.host;
        res.protocol = resp.request.protocol;
        res.robots = resp.data;
        res.status = resp.status;
        res.ok = true;
      })
      .catch(err => {
        res.status = err.response.status;
        res.error = true;
      })
      .finally(() => {
        this.pub('domain_check', res);
      });
  };


  _sendStatus(){
    const data = {ok:1};
    this.pub('status_info', data);
  }

};

module.exports = Worker;
