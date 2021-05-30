const EventEmitter = require('events');
const Domain = require('../models/Domain');
const config = require('../config');
const log = require('../../common/lib/logger')('Manager');



class CurrentJobs extends EventEmitter {
  constructor(){
    super();
    this._jobs = {};
  }

  deregisterJob(domain){
    if(!this._jobs[domain]){
      log.error(`No job for ${domain} found in current jobs list`);
      return false;
    }
    this.removeJob(domain, 'deregister');
    return true;
  }

  postponeTimeout(domain){
    if(!this._jobs[domain]){
      log.error(`No job for ${domain} found in current jobs list`);
      return false;
    }
    clearTimeout(this._jobs[domain]);
    const timeout = 2*config.http.domainCrawl.timeouts;
    const ts = new Date();
    this._jobs[domain] = setTimeout(() => this.cancelJob(domain, 'domainCrawl', timeout, ts), timeout);
    return true;
  }

  async cleanJobs(jobs){
    log.info(`Cleaning outstanding jobs`);
    if(Object.keys(this._jobs).length){
      for(const j in this._jobs){
        clearTimeout(j);
        delete this._jobs[j]
      }
    }
    await Domain.updateMany({'robots.status': 'checking'}, {'$set': {
      status: 'unvisited',
      'robots.status': 'unvisited',
      workerId: undefined
    }});
    await Domain.updateMany({status: 'crawling'}, {'$set': {
      status: 'ready',
      workerId: undefined
    }});
    return;
  }

  async removeJob(domain, type){
    if(this._jobs[domain]){
      clearTimeout(this._jobs[domain]);
      delete this._jobs[domain];
    }
    if(type === 'cancel'){
      const update = {
        status: 'unvisited',
        'robots.status': 'unvisited',
        workerId: undefined
      };
      return await Domain.updateMany({origin: domain}, {'$set': update});
    }
    if(type === 'deregister'){
      const update = {
        status: 'ready',
        workerId: undefined
      };
      return await Domain.updateMany({origin: domain}, {'$set': update});
    }
  }

  async cancelJob(domain, jobType, timeout, ts){
    if(this._jobs[domain]){
      log.warn(`Job ${jobType} for domain ${domain} timed out (${timeout/1000}s started at ${ts.toISOString()})`);
    }
    this.removeJob(domain, 'cancel');
    this.emit('jobTimeout', domain, jobType);
  }

  registerJob(domain, jobType){
    if(this._jobs[domain]){
      log.error(`Job for domain ${domain} already being performed`);
      return false;
    } else {
      const timeout = 2*config.http[jobType].timeouts;
      const ts = new Date();
      this._jobs[domain] = setTimeout(() => this.cancelJob(domain, jobType, timeout, ts), timeout);
      return true;
    }
  }

  async cancelJobs(jobs, workerId){
    let domains;
    domains = Object.keys(jobs.robotsCheck);
    if(domains.length){
      for(const d in domains){ delete this._jobs[d]; }
      const update = {
        status: 'unvisited',
        'robots.status': 'unvisited',
        workerId: undefined
      };
      let filter = {origin: {'$in': domains}};
      if(workerId){ filter.workerId = workerId; }
      await Domain.updateMany({origin: {'$in': domains}}, {'$set': update});
    }

    domains = Object.keys(jobs.domainCrawl);
    if(domains.length){
      for(const d in domains){ delete this._jobs[d]; }
      const update = {
        status: 'ready',
        workerId: undefined
      };
      let filter = {origin: {'$in': domains}};
      if(workerId){ filter.workerId = workerId; }
      await Domain.updateMany({origin: {'$in': domains}}, {'$set': update});
    }
  }

  count(){
    return Object.keys(this._jobs).length;
  }

};

module.exports = CurrentJobs;
