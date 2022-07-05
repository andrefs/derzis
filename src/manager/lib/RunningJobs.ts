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
  _running: {
    [domain: string]: {
      timeout: ReturnType<typeof setTimeout>,
      jobId: number
    }
  };
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
      const jobId = this._running[domain].jobId;
      clearTimeout(this._running[domain].timeout);
      delete this._running[domain];
      log.info(`Deregistered job #${jobId} from domain ${domain}`)
    }
  }

  postponeTimeout(domain: string){
    if(!this.isJobRegistered(domain)){ return false; }
    clearTimeout(this._running[domain].timeout);
    const timeout = 3*config.http.domainCrawl.timeouts;
    const ts = new Date();
    this._running[domain].timeout = setTimeout(async () => await this.timeoutJob(domain, 'domainCrawl', timeout, ts), timeout);
    return true;
  }

  async cleanJob(origin: string, jobType: JobType){
    log.info(`Cleaning job ${jobType} from domain ${origin}`)
    if(jobType === 'robotsCheck'){
      const update = {
        '$set': {
          status: 'unvisited',
          'robots.status': 'error',
        },
        '$unset': {
          workerId: '',
          jobId: ''
        },
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
        '$unset': {
          workerId: '',
          jobId: ''
        },
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

  async cancelAllJobs(){
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
      '$unset': {
        workerId: '',
        jobId: ''
      }
    });
    await Domain.updateMany({status: 'crawling'}, {
      '$set': {status: 'ready'},
      '$unset': {
        workerId: '',
        jobId: ''
      }
    });
    return;
  }

  async timeoutJob(origin: string, jobType: JobType, timeout: number, ts: Date){
    if(this._running[origin]){
      const jobId = this._running[origin].jobId;
      log.warn(`Job #${jobId} ${jobType} for domain ${origin} timed out (${timeout/1000}s started at ${ts.toISOString()})`);
    }
    this.cancelJob(origin, jobType);
    this.emit('jobTimeout', {origin, jobType});
  }

  async cancelJob(origin: string, jobType: JobType){
    const jobId = this._running[origin].jobId;
    log.info(`Canceling job ${jobId} ${jobType} on ${origin}`);
    this.deregisterJob(origin);
    await this.cleanJob(origin, jobType);
  }

  async registerJob(newJobId: number, domain: string, jobType: JobType){
    if(this._running[domain]){
      const oldJobId = this._running[domain].jobId;
      log.error(`Job ${jobType} for domain ${domain} already being performed (#${oldJobId}), so job #${newJobId} was refused`);
      await this.cleanJob(domain, jobType);
      return false;
    } else {
      const timeout = 3*config.http[jobType].timeouts;
      const ts = new Date();
      this._running[domain] = {
        timeout: setTimeout(async () => {
          if(this.beingSavedByDomain[domain]){
            const jobId = this._running[domain].jobId;
            throw `Job #${jobId} ${jobType} for domain ${domain} timedout while being saved`; // TODO proper handling
          }
          await this.timeoutJob(domain, jobType, timeout, ts);
        }, timeout),
        jobId: newJobId
      };
      return true;
    }
  }

  async cancelWorkerJobs(ongoingJobs: OngoingJobs, workerId: string){
    let domains: string[];
    domains = Object.keys(ongoingJobs.robotsCheck);
    log.info(`Canceling worker ${workerId} robotsCheck jobs on ${domains.join(', ')}`);
    if(domains.length){
      for(const d in domains){ this.deregisterJob(d); }
      const update = {
        '$set': {
          status: 'unvisited',
          'robots.status': 'unvisited',
        },
        '$unset': {
          workerId: '',
          jobId: ''
        }
      };
      let filter = {origin: {'$in': domains}, workerId: ''};
      if(workerId){ filter.workerId = workerId; }
      await Domain.updateMany({origin: {'$in': domains}}, update);
    }

    log.info(`Canceling worker ${workerId} robotsCheck jobs on ${domains.join(', ')}`);
    domains = Object.keys(ongoingJobs.domainCrawl);
    if(domains.length){
      for(const d in domains){ delete this._running[d]; }
      const update = {
        '$set': {status: 'ready'},
        '$unset': {
          workerId: '',
          jobId: ''
        }
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

