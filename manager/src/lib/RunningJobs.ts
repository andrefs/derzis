import EventEmitter from 'events';
import { Domain, DomainClass, HEAD_TYPE, Resource, TraversalPath } from '@derzis/models';
import config from '@derzis/config';
import { type JobType, type OngoingJobs } from '@derzis/common';
import { createLogger } from '@derzis/common/server';
import type { UpdateQuery } from 'mongoose';
const log = createLogger('Manager');

interface JobsBeingSaved {
  domainCrawl: number;
  resourceCrawl: number;
  robotsCheck: number;
  resourceLabelFetch: number;
  domainLabelFetch: number;
  count: () => number;
}

export default class RunningJobs extends EventEmitter {
  _running: {
    [domain: string]: {
      timeout: ReturnType<typeof setTimeout>;
      jobId: number;
    };
  };
  beingSaved: JobsBeingSaved;
  beingSavedByDomain: { [domain: string]: number };

  constructor() {
    super();

    this.beingSaved = {
      domainCrawl: 0,
      resourceCrawl: 0,
      robotsCheck: 0,
      resourceLabelFetch: 0,
      domainLabelFetch: 0,
      count: () => {
        const bs = this.beingSaved;
        return bs.domainCrawl + bs.resourceCrawl + bs.robotsCheck + bs.resourceLabelFetch + bs.domainLabelFetch;
      }
    };
    this.beingSavedByDomain = {};
    this._running = {};
  }

  addToBeingSaved(origin: string, type: JobType) {
    this.beingSaved[type]++;
    this.beingSavedByDomain[origin] = this.beingSavedByDomain[origin] || 0;
    this.beingSavedByDomain[origin]++;
  }

  removeFromBeingSaved(origin: string, type: JobType) {
    this.beingSaved[type]--;
    this.beingSavedByDomain[origin]--;
    if (this.beingSavedByDomain[origin] === 0) {
      delete this.beingSavedByDomain[origin];
    }
  }

  toObject() {
    return {
      running: Object.keys(this._running),
      beingSaved: this.beingSaved,
      beingSavedByDomain: this.beingSavedByDomain
    };
  }

  toString() {
    return (
      `running: ${Object.keys(this._running).join(', ')}, ` +
      `beingSaved: ${JSON.stringify(this.beingSaved)}, ` +
      `beingSavedByDomain: ${JSON.stringify(this.beingSavedByDomain)}`
    );
  }

  isJobRegistered(domain: string) {
    if (!this._running[domain]) {
      log.error(`No job for domain ${domain} found in current jobs list`);
      return false;
    }
    return true;
  }

  deregisterJob(domain: string) {
    if (this._running[domain]) {
      const jobId = this._running[domain].jobId;
      clearTimeout(this._running[domain].timeout);
      delete this._running[domain];
      log.info(`Deregistered job #${jobId} from domain ${domain}`);
    }
  }

  postponeTimeout(domain: string) {
    if (!this.isJobRegistered(domain)) {
      return false;
    }
    clearTimeout(this._running[domain].timeout);
    const timeout = 3 * config.http.domainCrawl.timeouts;
    const ts = new Date();
    this._running[domain].timeout = setTimeout(
      async () => await this.timeoutJob(domain, 'domainCrawl', timeout, ts),
      timeout
    );
    return true;
  }

  async cleanTimedOutJob(origin: string, jobType: JobType) {
    const customUpdate: UpdateQuery<DomainClass> =
      jobType === 'robotsCheck'
        ? {
          $set: {
            'robots.status': 'error'
          },
          $push: {
            lastWarnings: {
              $each: [{ errType: 'E_ROBOTS_TIMEOUT' }],
              $slice: -10
            }
          },
          $inc: {
            'warnings.E_ROBOTS_TIMEOUT': 1
          }
        }
        : {
          $push: {
            lastWarnings: {
              $each: [{ errType: 'E_RESOURCE_TIMEOUT' }],
              $slice: -10
            }
          },
          $inc: { 'warnings.E_RESOURCE_TIMEOUT': 1 }
        };
    return this.cleanJob(origin, jobType, customUpdate);
  }

  async cleanJob(origin: string, jobType: JobType, customUpdate?: UpdateQuery<DomainClass>) {
    log.info(`Cleaning job ${jobType} from domain ${origin}`);
    if (jobType === 'robotsCheck') {
      // update domain
      const update = customUpdate || {};
      update['$set'] = update['$set'] || {};
      update['$set']['status'] = 'unvisited';
      update['$unset'] = update['$unset'] || {};
      update['$unset']['workerId'] = '';
      update['$unset']['jobId'] = '';
      await Domain.updateMany({ origin }, update);

      // update paths with head belonging to this domain
      await TraversalPath.updateMany(
        { 'head.domain.origin': origin, status: 'active', 'head.type': HEAD_TYPE.URL },
        {
          $set: {
            'head.status': 'unvisited',
            'head.domain.status': 'unvisited'
          }
        }
      );
    }
    if (jobType === 'domainCrawl') {
      // update resources being crawled for this domain
      await Resource.updateMany({ domain: origin, status: 'crawling' }, { status: 'unvisited' });

      // update domain
      const update = customUpdate || {};
      update['$set'] = update['$set'] || {};
      update['status'] = 'ready';
      update['$unset'] = update['$unset'] || {};
      update['$unset']['workerId'] = '';
      update['$unset']['jobId'] = '';
      const res = await Domain.updateMany({ origin }, update);

      // update paths with head belonging to this domain
      await TraversalPath.updateMany(
        {
          'head.domain.origin': origin,
          status: 'active',
          'head.status': 'crawling',
          'head.type': HEAD_TYPE.URL
        },
        {
          $set: {
            'head.status': 'unvisited',
            'head.domain.status': 'ready'
          }
        }
      );
    }
    if (jobType === 'domainLabelFetch') {
      // update resources being labeled for this domain
      await Resource.updateMany({ domain: origin, status: 'labeling' }, { status: 'unvisited' });

      // update domain
      const update = customUpdate || {};
      update['$set'] = update['$set'] || {};
      update['$set']['status'] = 'ready';
      update['$unset'] = update['$unset'] || {};
      update['$unset']['workerId'] = '';
      update['$unset']['jobId'] = '';
      await Domain.updateMany({ origin }, update);
    }
  }

  /**
   * Cleanup all running jobs, setting their status back to unvisited/ready
   */
  async cancelAllJobs() {
    log.info(`Cleaning outstanding jobs`);
    log.debug('Deregistering running jobs');
    if (Object.keys(this._running).length) {
      for (const j in this._running) {
        this.deregisterJob(j);
      }
    }

    // Reset robot checks
    log.debug('Resetting outstanding robot checks');
    await Domain.updateMany(
      { 'robots.status': 'checking' },
      {
        $set: {
          status: 'unvisited',
          'robots.status': 'unvisited'
        },
        $unset: {
          workerId: '',
          jobId: ''
        }
      }
    );
    await Domain.updateMany(
      { status: 'checking' },
      {
        $set: { status: 'unvisited' },
        $unset: {
          workerId: '',
          jobId: ''
        }
      }
    );

    // Reset path head domains being checked
    log.debug('Resetting outstanding path head domains being checked');
    await TraversalPath.updateMany(
      { 'head.domain.status': 'checking', status: 'active', 'head.type': HEAD_TYPE.URL },
      { $set: { 'head.domain.status': 'unvisited' } }
    );

    // Reset domain crawls
    log.debug('Resetting outstanding domain crawls');
    await Domain.updateMany(
      { status: 'crawling' },
      {
        $set: { status: 'ready' },
        $unset: {
          workerId: '',
          jobId: ''
        }
      }
    );

    log.debug('Resetting outstanding domain label fetches');
    await Domain.updateMany(
      { status: 'labelFetching' },
      {
        $set: { status: 'ready' },
        $unset: {
          workerId: '',
          jobId: ''
        }
      }
    );

    // Reset path head domains being crawled
    log.debug('Resetting outstanding path head domains being crawled');
    await TraversalPath.updateMany(
      {
        'head.domain.status': 'crawling',
        status: 'active',
        'head.type': HEAD_TYPE.URL
      },
      {
        $set: {
          status: 'unvisited',
          'head.domain.status': 'ready'
        }
      }
    );

    // Reset resources being crawled
    log.debug('Resetting outstanding resources being crawled');
    await Resource.updateMany({ status: 'crawling' }, { status: 'unvisited' });
    // Reset path head resources being crawled
    log.debug('Resetting outstanding path head resources being crawled');
    await TraversalPath.updateMany(
      { 'head.status': 'crawling', status: 'active', 'head.type': HEAD_TYPE.URL },
      { $set: { 'head.status': 'unvisited' } }
    );

    log.info(`Outstanding jobs cleaned`);
    return;
  }

  async timeoutJob(origin: string, jobType: JobType, timeout: number, ts: Date) {
    if (this._running[origin]) {
      const jobId = this._running[origin].jobId;
      log.warn(
        `Job #${jobId} ${jobType} for domain ${origin} timed out (${timeout / 1000
        }s started at ${ts.toISOString()})`
      );
    }
    this.cancelTimedOutJob(origin, jobType);
    this.emit('jobTimeout', { origin, jobType });
  }

  async cancelTimedOutJob(origin: string, jobType: JobType) {
    const jobId = this._running[origin].jobId;
    log.info(`Canceling job ${jobId} ${jobType} on ${origin}`);
    this.deregisterJob(origin);
    await this.cleanTimedOutJob(origin, jobType);
  }

  async cancelJob(origin: string, jobType: JobType) {
    if (!this._running[origin]) {
      log.warn(`Attempted to cancel job ${jobType} on ${origin} but no running job found`);
      return;
    }
    const jobId = this._running[origin].jobId;
    log.info(`Canceling job ${jobId} ${jobType} on ${origin}`);
    this.deregisterJob(origin);
    await this.cleanJob(origin, jobType);
  }

  async registerJob(newJobId: number, domain: string, jobType: JobType) {
    if (this._running[domain]) {
      const oldJobId = this._running[domain].jobId;
      log.error(
        `Job ${jobType} for domain ${domain} already being performed (#${oldJobId}), so job #${newJobId} was refused`
      );
      await this.cleanJob(domain, jobType);
      return false;
    } else {
      const timeout = 3 * config.http[jobType].timeouts;
      const ts = new Date();
      this._running[domain] = {
        timeout: setTimeout(async () => {
          if (this.beingSavedByDomain[domain]) {
            const jobId = this._running[domain].jobId;
            log.warn(
              `Job #${jobId} ${jobType} for domain ${domain} timed out while being saved - proceeding with cleanup`
            );
          }
          await this.timeoutJob(domain, jobType, timeout, ts);
        }, timeout),
        jobId: newJobId
      };
      return true;
    }
  }

  async cancelWorkerJobs(ongoingJobs: OngoingJobs, workerId: string) {
    let domains: string[];
    domains = Object.keys(ongoingJobs.robotsCheck);
    log.info(`Canceling worker ${workerId} robotsCheck jobs on ${domains.join(', ')}`);
    if (domains.length) {
      for (const d in domains) {
        this.deregisterJob(d);
      }
      const update = {
        $set: {
          status: 'unvisited',
          'robots.status': 'unvisited'
        },
        $unset: {
          workerId: '',
          jobId: ''
        }
      };
      let filter = { origin: { $in: domains }, workerId: '' };
      if (workerId) {
        filter.workerId = workerId;
      }
      await Domain.updateMany({ origin: { $in: domains } }, update);
      await TraversalPath.updateMany(
        { 'head.domain.origin': { $in: domains }, status: 'active', 'head.type': HEAD_TYPE.URL },
        { $set: { status: 'unvisited' } }
      );
    }

    log.info(`Canceling worker ${workerId} domainCrawl jobs on ${domains.join(', ')}`);
    domains = Object.keys(ongoingJobs.domainCrawl);
    if (domains.length) {
      for (const d in domains) {
        delete this._running[d];
      }
      const update = {
        $set: { status: 'ready' },
        $unset: {
          workerId: '',
          jobId: ''
        }
      };
      let filter = { origin: { $in: domains }, workerId: '' };
      if (workerId) {
        filter.workerId = workerId;
      }
      await Domain.updateMany({ origin: { $in: domains } }, update);
      await TraversalPath.updateMany(
        { 'head.domain.origin': { $in: domains }, status: 'active', 'head.type': HEAD_TYPE.URL },
        {
          $set: {
            'head.domain.status': 'ready',
            'head.status': 'unvisited'
          }
        }
      );
    }

    log.info(`Canceling worker ${workerId} domainLabelFetch jobs on ${domains.join(', ')}`);
    domains = Object.keys(ongoingJobs.domainLabelFetch);
    if (domains.length) {
      for (const d in domains) {
        delete this._running[d];
      }
      const update = {
        $set: { status: 'ready' },
        $unset: {
          workerId: '',
          jobId: ''
        }
      };
      let filter = { origin: { $in: domains }, workerId: '' };
      if (workerId) {
        filter.workerId = workerId;
      }
      await Domain.updateMany({ origin: { $in: domains } }, update);
    }
  }

  count() {
    return Object.keys(this._running).length;
  }
}
