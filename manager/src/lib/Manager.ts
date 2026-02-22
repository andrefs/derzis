import robotsParser from 'robots-parser';
import config from '@derzis/config';
import {
  Domain,
  NamedNodeTriple,
  LiteralTriple,
  TraversalPath,
  Resource,
  Process,
  ResourceClass,
  EndpointPath,
  Triple,
  HEAD_TYPE
} from '@derzis/models';
import { type JobResult, type RobotsCheckResult, type CrawlResourceResult } from '@derzis/common';
import { createLogger } from '@derzis/common/server';
const log = createLogger('Manager');
import RunningJobs from './RunningJobs';
import type {
  JobCapacity,
  JobRequest,
  PathType,
  ResourceCrawlJobRequest,
  ResourceLabelFetchJobRequest,
  SimpleTriple
} from '@derzis/common';

export default class Manager {
  jobs: RunningJobs;
  finished: number;

  constructor() {
    this.jobs = new RunningJobs();
    this.finished = 0;
  }

  async updateJobResults(jobResult: JobResult) {
    log.debug('updateJobResults', {
      finished: this.finished,
      jobs: this.jobs.toString(),
      beingSaved: this.jobs.beingSaved
    });
    this.finished = 0;
    if (!this.jobs.isJobRegistered(jobResult.origin)) {
      //log.error(`Something went wrong: cannot update job results for ${data.domain} (no such job registered)`);
      return;
    }
    if (jobResult.jobType === 'robotsCheck') {
      log.info(`Saving robots data (job #${jobResult.jobId}) for ${jobResult.origin}`);
      this.jobs.addToBeingSaved(jobResult.origin, jobResult.jobType);
      try {
        await this.saveRobots(jobResult);
      } catch (e) {
        // TODO handle errors
        log.error(`Error saving robots (job #${jobResult.jobId}) for ${jobResult.origin}`);
        log.info(JSON.stringify(jobResult, null, 2));
      } finally {
        this.jobs.removeFromBeingSaved(jobResult.origin, jobResult.jobType);
        this.jobs.deregisterJob(jobResult.origin);
        log.debug(`Done saving robots data (job #${jobResult.jobId}) for ${jobResult.origin}`);
      }
    }
    if (jobResult.jobType === 'resourceCrawl') {
      log.info(
        `Saving resource crawl (job #${jobResult.jobId}) for domain ${jobResult.origin}: ${jobResult.url}`
      );
      if (this.jobs.postponeTimeout(jobResult.origin)) {
        this.jobs.addToBeingSaved(jobResult.origin, jobResult.jobType);
        try {
          await this.saveCrawl2(jobResult);
        } catch (e) {
          // TODO handle errors
          log.error(
            `Error saving resource crawl (job #${jobResult.jobId}) for ${jobResult.url}`,
            e
          );
          log.info(JSON.stringify(jobResult, null, 2));
          // Reset statuses to prevent stuck state
          await Resource.markAsCrawled(jobResult.url, jobResult.details, {
            errorType: 'database_error',
            name: 'Save Error',
            message: (e as Error).message
          });
        } finally {
          this.jobs.removeFromBeingSaved(jobResult.origin, jobResult.jobType);
          log.debug(
            `Done saving resource crawl (job #${jobResult.jobId}) for domain ${jobResult.origin}: ${jobResult.url}`
          );
          const res = await Domain.updateOne(
            {
              origin: jobResult.origin,
              jobId: jobResult.jobId,
              'crawl.ongoing': 0
            },
            {
              $set: { status: 'ready' },
              $unset: {
                workerId: '',
                jobId: ''
              }
            }
          );
          await TraversalPath.updateMany(
            { 'head.domain.origin': jobResult.origin, status: 'active', 'head.type': HEAD_TYPE.URL },
            {
              $set: { 'head.domain.status': 'ready' }
            }
          );

          if (res.acknowledged && res.modifiedCount) {
            this.jobs.deregisterJob(jobResult.origin);
            log.debug(`Done saving domain crawl (job #${jobResult.jobId}) for ${jobResult.origin}`);
          }
        }
      }
    }
    if (jobResult.jobType === 'domainCrawl') {
      log.warn(
        `Received completion of domain crawl (job #${jobResult.jobId}) for ${jobResult.origin}:`,
        jobResult.details
      );
    }
  }

  async saveCrawl2(jobResult: CrawlResourceResult) {
    if (jobResult.status === 'not_ok') {
      return await Resource.markAsCrawled(jobResult.url, jobResult.details, jobResult.err);
    }
    // mark head as crawled
    await Resource.markAsCrawled(jobResult.url, jobResult.details);

    log.silly('jobResult.url', jobResult.url);
    log.silly('jobResult.details.triples', JSON.stringify(jobResult.details.triples, null, 2));

    // filter out triples which dont refer to head resource
    //const triples = jobResult.details.triples.filter(
    //	(t) => t.object === jobResult.url || t.subject === jobResult.url
    //);

    await this.processNewTriples(jobResult.url, jobResult.details.triples);
  }

  /**
   * Process new triples found when crawling a resource
   * Adds new resources and triples to the database, and updates process paths accordingly
   * @param sourceUrl URL of the resource from which the triples were obtained
   * @param triples Array of triples to process
   */
  async processNewTriples(sourceUrl: string, triples: SimpleTriple[]) {
    log.info('processNewTriples called for:', sourceUrl, 'with', triples.length, 'triples');

    if (!triples.length) {
      log.warn('No triples found when dereferencing', sourceUrl);
      return;
    }

    // TODO: eventually this whitelist will come from Process/Step configuration
    const LITERAL_PREDICATE_WHITELIST = [
      'http://www.w3.org/2000/01/rdf-schema#label',
      'http://www.w3.org/2000/01/rdf-schema#comment'
    ];

    // Filter triples: keep all NamedNode triples, and only keep literal triples with whitelisted predicates
    const filteredTriples = triples.filter((t) => {
      if (typeof t.object === 'string') {
        return true;
      }
      // t.object is LiteralObject
      if (LITERAL_PREDICATE_WHITELIST.includes(t.predicate)) {
        return true;
      }
      return false;
    });

    const source = (await Resource.findOne({
      url: sourceUrl
    })) as ResourceClass;

    // add new resources
    await Resource.addFromTriples(filteredTriples);

    // Store all triples using unified upsertMany
    log.info('Calling Triple.upsertMany with', filteredTriples.length, 'triples');
    const tripleResult = await Triple.upsertMany(source, filteredTriples);
    log.info('Triple.upsertMany result:', tripleResult);

    // extend paths with source url as head
    log.info('Calling updateAllPathsWithHead for:', source.url);
    await this.updateAllPathsWithHead(source.url);
    log.info('updateAllPathsWithHead complete');
  }

  /**
   * Update all paths that have the given source URL as head
   * @param headUrl URL of the resource that is the head of the paths to update
   */
  async updateAllPathsWithHead(headUrl: string) {
    const query = {
      'head.url': headUrl,
      status: 'active'
    };

    const pids =
      config.manager.pathType === 'traversal'
        ? await TraversalPath.distinct('processId', query)
        : await EndpointPath.distinct('processId', query);

    log.info('updateAllPathsWithHead - found pids:', pids, 'for headUrl:', headUrl);

    for (const pid of pids) {
      const proc = await Process.findOne({ pid });
      log.info('Calling extendProcessPaths for pid:', pid, 'headUrl:', headUrl);
      await proc?.extendProcessPaths(headUrl, config.manager.pathType as PathType);
      log.info('extendProcessPaths complete for pid:', pid);
    }
  }

  /**
   * Save results of a robots check job to the database, including crawl delay and any errors
   * @param jobResult Result of the robots check job to save
   */
  async saveRobots(jobResult: RobotsCheckResult) {
    let crawlDelay = config.http.crawlDelay || 1;

    if (jobResult.status === 'ok') {
      const robots = robotsParser(jobResult.origin + '/robots.txt', jobResult.details.robotsText);
      crawlDelay = robots.getCrawlDelay(config.http.userAgent) || crawlDelay;
      await Domain.saveRobotsOk(jobResult, crawlDelay);
    } else {
      await Domain.saveRobotsError(jobResult, crawlDelay);
    }
    return;
  }

  async *assignJobs(
    workerId: string,
    workerAvail: JobCapacity
  ): AsyncIterable<Exclude<JobRequest, ResourceCrawlJobRequest | ResourceLabelFetchJobRequest>> {
    if (this.jobs.beingSaved.count() > 0) {
      log.warn(
        `Too many jobs (${this.jobs.beingSaved.count()}) being saved, waiting for them to reduce before assigning new jobs`
      );
      return; // TODO check if this is correct
    }
    else {
      log.debug(
        `Only ${this.jobs.beingSaved.count()} jobs being saved, proceeding to assign new jobs for worker ${workerId}`
      );
    }
    let assignedCheck = 0;
    let assignedCrawl = 0;
    let assignedLabelFetch = 0;


    // labelFetch jobs
    if (workerAvail.labelFetch) {
      if (!workerAvail.labelFetch.capacity) {
        log.warn(`Worker ${workerId} has no capacity for labelFetch jobs`);
      } else {
        log.debug(`Getting ${workerAvail.labelFetch.capacity} labelFetch jobs for ${workerId}`);
        let gotRes = false;

        for await (const labelJob of Domain.labelsToFetch(
          workerId,
          workerAvail.labelFetch.capacity,
          workerAvail.labelFetch.resourcesPerDomain
        )) {
          gotRes = true;
          if (labelJob?.resources?.length &&
            (await this.jobs.registerJob(labelJob.domain.jobId, labelJob.domain.origin, 'domainLabelFetch'))) {
            assignedLabelFetch++;
            yield {
              type: 'domainLabelFetch',
              jobId: labelJob.domain.jobId,
              ...labelJob
            }
          } else {
            log.info(`No resources with labels to fetch for worker ${workerId}`);
          }
        }
        if (!gotRes) {
          log.info(`No domains with labels to fetch for worker ${workerId}`);
        }
      }
    }

    // domainCrawl jobs
    if (workerAvail.domainCrawl) {
      if (!workerAvail.domainCrawl.capacity) {
        log.warn(`Worker ${workerId} has no capacity for domainCrawl jobs`);
      } else {
        log.debug(`Getting ${workerAvail.domainCrawl.capacity} domainCrawl jobs for ${workerId}`);
        let gotRes = false;
        for await (const crawl of Domain.domainsToCrawl2(
          workerId,
          workerAvail.domainCrawl.capacity,
          workerAvail.domainCrawl.resourcesPerDomain
        )) {
          gotRes = true;
          if (
            crawl?.resources?.length &&
            (await this.jobs.registerJob(crawl.domain.jobId, crawl.domain.origin, 'domainCrawl'))
          ) {
            assignedCrawl++;
            yield {
              type: 'domainCrawl',
              jobId: crawl.domain.jobId,
              ...crawl
            };
          } else {
            log.info(`No resources to crawl from domain ${crawl.domain.origin}`);
          }
        }
        if (!gotRes) {
          log.info(`No domains to crawl for worker ${workerId}`);
        }
      }
    }
    // robotsCheck jobs
    if (!assignedCrawl && workerAvail.robotsCheck) {
      if (!workerAvail.robotsCheck.capacity) {
        log.warn(`Worker ${workerId} has no capacity for robotsCheck jobs`);
      } else {
        log.debug(`Getting ${workerAvail.robotsCheck.capacity} robotsCheck jobs for ${workerId}`);
        let gotRes = false;
        for await (const check of Domain.domainsToCheck(
          workerId,
          workerAvail.robotsCheck.capacity
        )) {
          gotRes = true;
          if (await this.jobs.registerJob(check.jobId, check.origin, 'robotsCheck')) {
            log.silly('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX assigning robotsCheck', {
              workerId,
              workerAvail,
              check
            });
            assignedCheck++;
            yield {
              type: 'robotsCheck',
              jobId: check.jobId,
              origin: check.origin
            };
          }
        }
        if (!gotRes) {
          log.info(`No domains to check for worker ${workerId}`);
        }
      }
    }

    if (!assignedCheck && !assignedCrawl && !this.jobs.count() && !this.jobs.beingSaved.count()) {
      log.info(
        'Could not find any domains to check or crawl *right now* and there are no outstanding jobs',
        this.jobs.toObject()
      );

      this.finished++;
    }
    //FIXME
    if (this.finished > 5) {
      log.info('No current processes running, starting new process');
      const res = await Process.startNext();
      if (res) {
        this.finished = 0;
        return;
      }
      console.log(
        'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX this should be the end!',
        this.finished,
        workerAvail,
        assignedCheck,
        assignedCrawl,
        this.jobs.toString()
      );
    }
  }
}
