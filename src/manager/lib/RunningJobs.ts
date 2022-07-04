import EventEmitter from 'events';
import {Domain, Resource} from '@derzis/models'
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
};

interface JobsBeingSaved {
  domainCrawl: number;
  resourceCrawl: number;
  robotsCheck: number;
  count: () => number;
};



export default class RunningJobs extends EventEmitter {
  _running: { [domain: string]: ReturnType<typeof setTimeout> };
  beingSaved: JobsBeingSaved;
  beingSavedByDomain: {[domain: string]: number }

  constructor(){
    super();

    this.beingSaved = {
      domainCrawl: 0,
      resourceCrawl: 0,
      robotsCheck: 0,
      count: () => {
        const bs = this.beingSaved;
        return bs.domainCrawl + bs.resourceCrawl + bs.robotsCheck
      }
    };
    this.beingSavedByDomain = {};
    this._running = {};
  }

  addToBeingSaved(origin: string, type: JobType){
    this.beingSaved[type]++;
    this.beingSavedByDomain[origin]++;
  };

  removeFromBeingSaved(origin: string, type: JobType){
    this.beingSaved[type]--;
    this.beingSavedByDomain[origin]--;
  };

  toString(){
    return `Running: ${Object.keys(this._running).join(', ')}, ` + 
      `beingSaved: ${this.beingSaved.toString()}, ` + 
      `beingSavedByDomain: ${this.beingSavedByDomain.toString()}`;
  }

  isJobRegistered(domain: string){
    if(!this._running[domain]){
      log.error(`No job for domain ${domain} found in current jobs list`);
      return false;
    }
    return true;
  }

  deregisterJob(domain: string){
    if(this._running[domain]){
      clearTimeout(this._running[domain]);
      delete this._running[domain];
    }
  }

  postponeTimeout(domain: string){
    if(!this.isJobRegistered(domain)){ return false; }
    clearTimeout(this._running[domain]);
    const timeout = 3*config.http.domainCrawl.timeouts;
    const ts = new Date();
    this._running[domain] = setTimeout(async () => await this.cancelJob(domain, 'domainCrawl', timeout, ts), timeout);
    return true;
  }

  async cleanJob(origin: string, jobType: JobType){
    if(jobType === 'robotsCheck'){
      const update = {
        '$set': {
          status: 'unvisited',
          'robots.status': 'error',
        },
        '$unset': {workerId: '' },
        '$push': {
          'lastWarnings': {
            '$each': [{errType: 'E_ROBOTS_TIMEOUT'}],
            '$slice': -10
          }
        },
        '$inc': {
          'warnings.E_ROBOTS_TIMEOUT': 1
        },
      };
      await Domain.updateMany({origin}, update);
    }
    if(jobType === 'domainCrawl'){
      await Resource.updateMany({origin, status: 'crawling'}, {status: 'unvisited'});
      const update = {
        '$set': {status: 'ready'},
        '$unset': {workerId: '' },
        '$push': {
          'lastWarnings': {
            '$each': [{errType: 'E_RESOURCE_TIMEOUT'}],
            '$slice': -10
          }
        },
        '$inc': {'warnings.E_RESOURCE_TIMEOUT': 1},
      };
      const res = await Domain.updateMany({origin}, update);
    }
  }

  async cleanJobs(){
    log.info(`Cleaning outstanding jobs`);
    if(Object.keys(this._running).length){
      for(const j in this._running){
        this.deregisterJob(j);
      }
    }
    await Domain.updateMany({'robots.status': 'checking'}, {
      '$set': {
        status: 'unvisited',
        'robots.status': 'unvisited',
      },
      '$unset': {workerId: ''}
    });
    await Domain.updateMany({status: 'crawling'}, {
      '$set': {status: 'ready'},
      '$unset': {workerId: ''}
    });
    return;
  }

  async cancelJob(origin: string, jobType: JobType, timeout: number, ts: Date){
    if(this._running[origin]){
      log.warn(`Job ${jobType} for domain ${origin} timed out (${timeout/1000}s started at ${ts.toISOString()})`);
      this.deregisterJob(origin);
    }
    await this.cleanJob(origin, jobType);
    this.emit('jobTimeout', origin, jobType);
  }

  async registerJob(domain: string, jobType: JobType){
    if(this._running[domain]){
      log.error(`Job ${jobType} for domain ${domain} already being performed`);
      await this.cleanJob(domain, jobType);
      return false;
    } else {
      const timeout = 3*config.http[jobType].timeouts;
      const ts = new Date();
      this._running[domain] = setTimeout(async () => {
        if(this.beingSavedByDomain[domain]){
          throw `Job ${jobType} for domain ${domain} timedout while being saved`; // TODO proper handling
        }
        await this.cancelJob(domain, jobType, timeout, ts);
      }, timeout);
      return true;
    }
  }

  async cancelJobs(ongoingJobs: OngoingJobs, workerId: string){
    let domains: string[];
    domains = Object.keys(ongoingJobs.robotsCheck);
    if(domains.length){
      for(const d in domains){ delete this._running[d]; }
      const update = {
        '$set': {
          status: 'unvisited',
          'robots.status': 'unvisited',
        },
        '$unset': {workerId: ''}
      };
      let filter = {origin: {'$in': domains}, workerId: ''};
      if(workerId){ filter.workerId = workerId; }
      await Domain.updateMany({origin: {'$in': domains}}, update);
    }

    domains = Object.keys(ongoingJobs.domainCrawl);
    if(domains.length){
      for(const d in domains){ delete this._running[d]; }
      const update = {
        '$set': {status: 'ready'},
        '$unset': {workerId: ''}
      };
      let filter = {origin: {'$in': domains}, workerId: ''};
      if(workerId){ filter.workerId = workerId; }
      await Domain.updateMany({origin: {'$in': domains}}, update);
    }
  }

  count(){
    return Object.keys(this._running).length;
  }

};

