const EventEmitter = require('events');
const Domain = require('../models/Domain');
const config = require('../config');
const log = require('../../common/lib/logger')('Manager');



class CurrentJobs extends EventEmitter {
  constructor(){
    super();
    this._jobs = {};
  }

  toString(){
    return Object.keys(this._jobs).join(', ');
  }

  isJobRegistered(domain){
    if(!this._jobs[domain]){
      log.error(`No job for ${domain} found in current jobs list`);
      return false;
    }
    return true;
  }

  deregisterJob(domain){
    if(this._jobs[domain]){
      clearTimeout(this._jobs[domain]);
      delete this._jobs[domain];
    }
  }

  getTimeLeft(domain){
    return Math.ceil((this._jobs[domain]._idleStart + this._jobs[domain]._idleTimeout - Date.now()) / 1000);
  }

  postponeTimeout(domain){
    if(!this._jobs[domain]){
      log.error(`No job for ${domain} found in current jobs list`);
      return false;
    }
    clearTimeout(this._jobs[domain]);
    const timeout = 3*config.http.domainCrawl.timeouts;
    const ts = new Date();
    this._jobs[domain] = setTimeout(() => this.cancelJob(domain, 'domainCrawl', timeout, ts), timeout);
    return true;
  }

  async cleanJobs(jobs){
    log.info(`Cleaning outstanding jobs`);
    if(Object.keys(this._jobs).length){
      for(const j in this._jobs){
        this.deregisterJob(j);
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

  async cancelJob(domain, jobType, timeout, ts){
    if(this._jobs[domain]){
      log.warn(`Job ${jobType} for domain ${domain} timed out (${timeout/1000}s started at ${ts.toISOString()})`);
      this.deregisterJob(domain);
    }
    if(jobType === 'robotsCheck'){
      const update = {
        status: 'unvisited',
        'robots.status': 'unvisited',
        workerId: undefined
      };
      await Domain.updateMany({origin: domain}, {'$set': update});
    }
    if(jobType === 'domainCrawl'){
      const update = {
        status: 'ready',
        workerId: undefined
      };
      await Domain.updateMany({origin: domain}, {'$set': update});
    }
    this.emit('jobTimeout', domain, jobType);
  }

  registerJob(domain, jobType){
    if(this._jobs[domain]){
      log.error(`Job for domain ${domain} already being performed`);
      return false;
    } else {
      const timeout = 3*config.http[jobType].timeouts;
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
