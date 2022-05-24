import EventEmitter from 'events';
import {Domain} from '@derzis/models'
import config from '@derzis/config';
import {createLogger} from '@derzis/common';
import { JobType } from '@derzis/worker';
const log = createLogger('Manager');

export interface OngoingJobs {
  domainCrawl: {
    [domain: string]: boolean
  },
  robotsCheck: {
    [domain: string]: boolean
  }
}


export default class CurrentJobs extends EventEmitter {
  _jobs: { [domain: string]: ReturnType<typeof setTimeout> };

  constructor(){
    super();
    this._jobs = {};
  }

  toString(){
    return Object.keys(this._jobs).join(', ');
  }

  isJobRegistered(domain: string){
    if(!this._jobs[domain]){
      log.error(`No job for ${domain} found in current jobs list`);
      return false;
    }
    return true;
  }

  deregisterJob(domain: string){
    if(this._jobs[domain]){
      clearTimeout(this._jobs[domain]);
      delete this._jobs[domain];
    }
  }

  postponeTimeout(domain: string){
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

  async cleanJobs(){
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

  async cancelJob(origin: string, jobType: JobType, timeout: number, ts: Date){
    if(this._jobs[origin]){
      log.warn(`Job ${jobType} for domain ${origin} timed out (${timeout/1000}s started at ${ts.toISOString()})`);
      this.deregisterJob(origin);
    }
    if(jobType === 'robotsCheck'){
      const update = {
        '$set': {
          status: 'unvisited',
          'robots.status': 'error',
          workerId: undefined,
        },
        '$push': {
          'err.last': {
            '$each': [{errType: 'E_ROBOTS_TIMEOUT'}],
            '$slice': -10
          }
        },
        '$inc': {
          'err.count.E_ROBOTS_TIMEOUT': 1
        },
      };
      await Domain.updateMany({origin}, update);
    }
    if(jobType === 'domainCrawl'){
      const update = {
        '$set': {
          status: 'ready',
          workerId: undefined
        },
        '$push': {
          'err.last': {
            '$each': [{errType: 'E_RESOURCE_TIMEOUT'}],
            '$slice': -10
          }
        },
        '$inc': {
          'err.count.E_RESOURCE_TIMEOUT': 1
        },
      };
      await Domain.updateMany({origin}, {'$set': update});
    }
    this.emit('jobTimeout', origin, jobType);
  }

  registerJob(domain: string, jobType: JobType){
    if(this._jobs[domain]){
      log.error(`Job for domain ${domain} already being performed`);
      return false;
    } else {
      const timeout = 20*config.http[jobType].timeouts;
      const ts = new Date();
      this._jobs[domain] = setTimeout(() => this.cancelJob(domain, jobType, timeout, ts), timeout);
      return true;
    }
  }

  async cancelJobs(ongoingJobs: OngoingJobs, workerId: string){
    let domains: string[];
    domains = Object.keys(ongoingJobs.robotsCheck);
    if(domains.length){
      for(const d in domains){ delete this._jobs[d]; }
      const update = {
        status: 'unvisited',
        'robots.status': 'unvisited',
        workerId: undefined
      };
      let filter = {origin: {'$in': domains}, workerId: ''};
      if(workerId){ filter.workerId = workerId; }
      await Domain.updateMany({origin: {'$in': domains}}, {'$set': update});
    }

    domains = Object.keys(ongoingJobs.domainCrawl);
    if(domains.length){
      for(const d in domains){ delete this._jobs[d]; }
      const update = {
        status: 'ready',
        workerId: undefined
      };
      let filter = {origin: {'$in': domains}, workerId: ''};
      if(workerId){ filter.workerId = workerId; }
      await Domain.updateMany({origin: {'$in': domains}}, {'$set': update});
    }
  }

  count(){
    return Object.keys(this._jobs).length;
  }

};

