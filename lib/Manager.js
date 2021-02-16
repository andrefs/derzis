const redis = require('redis');
const robotsParser = require('robots-parser');
const config = require('../config');

class Manager {
  constructor(){
    this._id = 'Manager';
    this.log('Started');
    this._workers = {};
    this._jobs = {};
    this.connect();
    this.askStatusInfo();
  }

  connect(){
    this.log('Connecting to Redis');
    this._pub = redis.createClient();
    this._broad = redis.createClient();
    this._sub = redis.createClient();

    this.log(`Subscribing to ${config.pubsub.workers.from}*`);
    this._sub.psubscribe(config.pubsub.workers.from+'*');

    this._broadChannel = config.pubsub.manager.from;
    this.log(`Broadcasting to ${this._broadChannel}`);
    this._pubChannel = config.pubsub.workers.to;
    this.log(`Publishing to ${this._pubChannel}{workerId}`);

    this._subEvents();
  }

  log(...messages){
    console.info(`[${this._id}]`, messages);
  }

  pub(workerId, type, data){
    const payload = {type, data};
    this.log('Publishing', this._pubChannel, payload);
    this._pub.publish(this._pubChannel+workerId, JSON.stringify(payload));
  }

  broad(type, data){
    const payload = {type, data};
    this.log('Broadcasting', this._broadChannel, payload);
    this._broad.publish(this._broadChannel, JSON.stringify(payload));
  }

  _subEvents(){
    this._sub.on('pmessage', (pattern, channel, message) => {
      const workerId = channel.match(/:(W#\d+)/)[1];
      const payload = JSON.parse(message);
      this.log('Got', channel, payload);
      if(payload.type === 'status_info'){
        return this._updateWorkerStatus(workerId, payload.data);
      }
      if(payload.type === 'domain_check'){
        return this._updateDomainInfo(payload.data);
      }
      if(payload.type === 'shutdown'){
        return this._removeWorker(workerId);
      }
    });
  }

  askStatusInfo(workerId){
    const data = {cenas:1};
    if(workerId){
      return this.pub(workerId, 'get_status', data);
    }
    return this.broad('get_status', data);
  }

  _updateDomainInfo(data){
    if(data.ok){
      const host = data.protocol+'//'+data.actualHost;
      const robots = robotsParser(host+'/robots.txt', data.robots);
      console.log(data);
      console.log(robots);
      console.log(robots.isAllowed('http://www.w3.org/People/domain/', 'Applebot'));
      console.log(robots.isAllowed('http://www.w3.org/People/domain/', config.userAgent));
    }
  }

  _selectWorker(jobType){
    return Object.keys(this._workers)[0];
  }

  askDomainCheck(data){
    const workerId = this._selectWorker('domain_check');
    this.pub(workerId, 'domain_check', data);
  }


  _removeWorker(workerId){
    delete this._workers[workerId];
  }

  _updateWorkerStatus(workerId, data){
    this._workers[workerId] = data;
  }
};

module.exports = Manager;
