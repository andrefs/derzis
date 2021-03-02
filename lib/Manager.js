const redis = require('redis');
const robotsParser = require('robots-parser');
const config = require('../config');
const db = require('./db');
const Domain = require('../models/Domain');
const Resource = require('../models/Resource');
const log = require('./logger')('Manager');


class Manager {
  constructor(){
    this._id = 'Manager';
    log.info('Started');
    this._jobs = {};
    this.connect();
    this.askStatusInfo();
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
      if(payload.type === 'askJobs'){
        return this.assignJobs(workerId, payload.data);
      }
      if(payload.type === 'jobDone'){
        return this.updateJobResults(payload.data);
      }
      if(payload.type === 'shutdown'){
        this.cancelJobs(payload.data.ongoingJobs);
      }
      if(payload.type === 'noCapacity'){
        // return this._cancelJob(payload.data);
      }
    });
  }

  async cancelJobs(jobs){
    let hosts;
    hosts = Object.keys(jobs.domainCheck);
    if(hosts.length){
      const update = {
        status: 'unvisited',
        'robots.status': 'unvisited',
        workerId: undefined
      };
      await Domain.updateMany({host: {'$in': hosts}}, {'$set': update});
    }

    hosts = Object.keys(jobs.domainCrawl);
    if(hosts.length){
      const update = {
        status: 'ready',
        workerId: undefined
      };
      await Domain.updateMany({host: {'$in': hosts}}, {'$set': update});
    }
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

  //_selectWorker(jobType){
  //  return Object.keys(this._workers)[0];
  //}

  //_removeWorker(workerId){
  //  delete this._workers[workerId];
  //}

  //_updateWorkerStatus(workerId, data){
  //  this._workers[workerId] = data;
  //}

  /**********
   * Domain *
   **********/

  async updateJobResults(data){
    if(data.jobType === 'domainCheck'){
      this.updateRobotsInfo(data.results)
    }
    if(data.jobType === 'domainCrawl'){
      await Domain.updateOne({host: data.host},{
        '$set': {status: 'ready'},
        '$unset': {workerId: ''}
      });
    }
    if(data.jobType === 'resourceCrawl'){
      const source = {
        url: data.results.url,
        domain: data.host
      }
      await this.saveCrawlInfo(source, data.results.resources, data.results.triples);
    }
  }


  async saveCrawlInfo(source, urls, triples){
    await Resource.upsertMany(urls.map(u => ({
      url: u,
      // source
      domain: new URL(u).origin,
      crawled: false
    })));
    await Resource.updateOne({url: source.url}, {
      status: 'done',
      totalTriples: triples.length
    });
    await Domain.updateOne({host: source.domain}, {
      '$inc': {
        'crawl.queued': -1,
        'crawl.success': 1
      }
    });
  }

  async updateRobotsInfo(results){
    let crawlDelay = 1;
    let doc = {workerId: undefined};

    if(results.ok){
      const robots = robotsParser(results.host+'/robots.txt', results.robots);
      crawlDelay = robots.getCrawlDelay(config.userAgent) || crawlDelay;

      doc = {
        '$set': {
          'robots.text': results.robots,
          'robots.checked': results.endTime,
          'robots.elapsedTime': results.elapsedTime,
          'robots.status': 'done',
          status: 'ready',
          'crawl.delay': crawlDelay,
          'crawl.nextAllowed': new Date(results.endTime+(crawlDelay*1000)),
          lastAccessed: results.endTime
        }, '$unset': {workerId: ''}
      };
    }
    else if(results.status === 404){
      doc = {
        '$set': {
          'robots.status': 'not_found',
          status: 'ready',
          'crawl.delay': crawlDelay,
          'crawl.nextAllowed': new Date(results.endTime+(crawlDelay*1000))
        }, '$unset': {workerId: ''}
      };
    } else {
      // TODO store error
      // TODO what should status be?
      doc = {
        '$set': {
          'robots.status': 'error'
        }, '$unset': {workerId: ''}
      };
    }

    return await Domain.findOneAndUpdate({host: results.host}, doc, {new: true})
      .catch(err => console.log(err));
  }

  async *domainsToCrawl(workerId, limit){
    for await(const domain of Domain.domainsToCrawl(workerId, limit)){
      const resources = await Resource.resourcesToCrawl(domain.host, workerId, limit);
      yield {domain, resources};
    }
  };

  async assignJobs(workerId, workerAvail){
    const jobs = {};
    if(workerAvail.domainCheck){
      for await(const check of Domain.domainsToCheck(workerId, workerAvail.domainCheck)){
        this.pub(workerId, 'doJob', {jobType: 'domainCheck', ...check});
      }
    }
    if(workerAvail.domainCrawl){
      for await(const crawl of this.domainsToCrawl(workerId, workerAvail.domainCrawl)){
        this.pub(workerId, 'doJob', {jobType: 'domainCrawl', ...crawl});
      }
    }
  }

};

module.exports = Manager;
