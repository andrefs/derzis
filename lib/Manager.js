const redis = require('redis');
const robotsParser = require('robots-parser');
const config = require('../config');
const db = require('./db');
const Domain = require('../models/Domain');
const Resource = require('../models/Resource');


class Manager {
  constructor(){
    this._id = 'Manager';
    this.log('Started');
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
    console.info(`[${this._id}]`, ...messages);
  }

  pub(workerId, type, data = {}){
    const payload = {type, data};
    const channel = this._pubChannel+workerId
    this.log('Publishing', channel, payload);
    this._pub.publish(channel, JSON.stringify(payload));
  }

  broad(type, data = {}){
    const payload = {type, data};
    this.log('Broadcasting', this._broadChannel, payload);
    this._broad.publish(this._broadChannel, JSON.stringify(payload));
  }

  _subEvents(){
    this._sub.on('pmessage', (pattern, channel, message) => {
      const workerId = channel.match(/:(W#\d+)/)[1];
      const payload = JSON.parse(message);
      this.log('Got', channel, payload);
      if(payload.type === 'askJobs'){
        return this._assignJobs(workerId, payload.data);
      }
      if(payload.type === 'domainCheck'){
        return this._updateDomainInfo(payload.data);
      }
      if(payload.type === 'shutdown'){
        // UNNECESSARY
        //return this._removeWorker(workerId);
      }
      if(payload.type === 'noCapacity'){
        return this._cancelJob(payload.data);
      }
    });
  }

  /**********
   * Worker *
   **********/

  askStatusInfo(workerId){
    if(workerId){
      return this.pub(workerId, 'getStatus');
    }
    return this.broad('getStatus');
  }

  _selectWorker(jobType){
    return Object.keys(this._workers)[0];
  }

  _removeWorker(workerId){
    delete this._workers[workerId];
  }

  _updateWorkerStatus(workerId, data){
    this._workers[workerId] = data;
  }

  /**********
   * Domain *
   **********/

  askDomainCheck(workerId, data){
    this.pub(workerId, 'domainCheck', data);
  }

  async askDomainCrawl(){
    const workerId = this._selectWorker('domainCheck');
    const filter = {
      status: 'ready',
      crawl: {
        queued: {'$gt': 0},
        nextAllowed: {'$gt': Date.now}
      }
    };
    const domain = await Domain.find(filter).limit(1);
    const resources = await Resource.find({domain: domain, status: 'unvisited'}, {limit:100});

    this.pub(workerId, 'domainCrawl', {domain, resources});
  }

  _updateDomainInfo(data){
    const host = data.protocol+'//'+data.actualHost;
    if(data.ok){
      const robots = robotsParser(host+'/robots.txt', data.robots);
      const crawlDelay = robots.getCrawlDelay(config.userAgent) || 1;
      return Domain.findOneAndUpdate({host},
        {
          robots: data.robots,
          status: 'ready',
          crawlDelay: crawlDelay,
          lastAccessed: data.endTime,
          nextCrawlAllowed: new Date(data.endTime+(crawlDelay*1000))
        }, {new: true, upsert: true})
        .then(doc => console.log(doc))
        .catch(err => console.log(err));
    } else {
      return Domain.findOneAndUpdate({host},
        {
          robots: data.robots,
          status: 'error',
        }, {new: true, upsert: true})
        .then(doc => console.log(doc))
        .catch(err => console.log(err));
    }
  }

  _updateResourceInfo(data){
  }

  _cancelJob({domain}){
    // ... update db
    delete this._jobs[domain];
  }

  async _assignJobs(workerId, workerAvail){
    const jobs = {};
    if(workerAvail.domainCheck){
      for await(const check of Domain.domainsToCheck(workerAvail.domainCheck, workerId)){
        this.pub(workerId, 'doJob', {jobType: 'domainCheck', ...check});
      }
    }
    //if(workerAvail.domainCrawl){
    //  const crawls = await Domain.domainsToCrawl(workerAvail.domainCrawl); // FIX ME method should not be in Domain
    //  for(const c of crawls){
    //    jobs[c.host] = {jobType: 'domainCrawl', ...c};
    //  }
    //}

    //if(Object.keys(jobs).length){
    //  this.pub(workerId, 'doJobs', jobs);
    //}
  }

};

module.exports = Manager;
