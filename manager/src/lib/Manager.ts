import robotsParser from 'robots-parser';
import config from '@derzis/config';
import {
  Domain,
  TraversalPath,
  Resource,
  Process,
  ResourceClass,
  EndpointPath,
  Triple,
  ResourceLabel,
  ProcessTriple,
  extendPaths,
  LiteralTripleClass,
  type TripleDocument,
  type LiteralTripleDocument,
  HEAD_TYPE
} from '@derzis/models';
import { notifyLabelsFetched } from '@derzis/models/Process/process-notifications';
import {
  type JobResult,
  type RobotsCheckResult,
  type CrawlResourceResult,
  TripleType,
  type SimpleLiteralTriple
} from '@derzis/common';
import { createLogger } from '@derzis/common/server';
const log = createLogger('Manager');
import RunningJobs from './RunningJobs';
import type { Types } from 'mongoose';
import {
  PathType,
  type DomainCrawlJobRequest,
  type DomainLabelFetchJobRequest,
  type FetchLabelsResourceResult,
  type JobCapacity,
  type JobRequest,
  type ResourceCrawlJobRequest,
  type ResourceLabelFetchJobRequest,
  type RobotsCheckJobRequest,
  type SimpleTriple
} from '@derzis/common';

interface AssignedJobs {
  check: number;
  crawl: number;
  labelFetch: number;
}

export default class Manager {
  jobs: RunningJobs;
  finished: number;

  constructor() {
    this.jobs = new RunningJobs();
    this.finished = 0;
  }

  /**
   * Update the database with the results of a completed job, and deregister the job
   * @param jobResult Result of the completed job to process
   */
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
        this.jobs.deregisterJob(jobResult.origin, jobResult.jobId);
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
          const pathType = await this.getPathTypeForUrl(jobResult.url);
          await Resource.markAsCrawled(jobResult.url, pathType, jobResult, {
            errorType: 'database_error',
            name: 'Save Error',
            message: (e as Error).message
          });
        } finally {
          this.jobs.removeFromBeingSaved(jobResult.origin, jobResult.jobType);
          log.debug(
            `Done saving resource crawl (job #${jobResult.jobId}) for domain ${jobResult.origin}: ${jobResult.url}`
          );
          try {
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
            if (res.acknowledged && res.modifiedCount) {
              log.debug(`Domain status updated for ${jobResult.origin}`);
            } else {
              log.debug(
                `Domain update skipped for ${jobResult.origin}: crawl.ongoing > 0 or jobId mismatch`
              );
            }
          } catch (err) {
            log.error(`Failed to update domain status for ${jobResult.origin}`, err);
          }
        }
      }
    }

    if (jobResult.jobType === 'resourceLabelFetch') {
      log.info(
        `Saving resource label fetch (job #${jobResult.jobId}) for domain ${jobResult.origin}: ${jobResult.url}`
      );
      if (this.jobs.postponeTimeout(jobResult.origin)) {
        this.jobs.addToBeingSaved(jobResult.origin, jobResult.jobType);
        try {
          await this.saveLabelFetch(jobResult);
        } catch (e) {
          log.error(
            `Error saving resource label fetch (job #${jobResult.jobId}) for ${jobResult.url}`,
            e
          );
          log.info(JSON.stringify(jobResult, null, 2));
          // Reset statuses to prevent stuck state
        } finally {
          this.jobs.removeFromBeingSaved(jobResult.origin, jobResult.jobType);
          log.debug(
            `Done saving resource label fetch (job #${jobResult.jobId}) for domain ${jobResult.origin}: ${jobResult.url}`
          );
          try {
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
            if (res.acknowledged && res.modifiedCount) {
              log.debug(`Domain status updated for ${jobResult.origin} after label fetch`);
            } else {
              log.debug(
                `Domain update skipped for ${jobResult.origin}: crawl.ongoing > 0 or jobId mismatch`
              );
            }
          } catch (err) {
            log.error(
              `Failed to update domain status after label fetch for ${jobResult.origin}`,
              err
            );
          }
        }
      }
    }
    if (jobResult.jobType === 'domainCrawl') {
      log.warn(
        `Received completion of domain crawl (job #${jobResult.jobId}) for ${jobResult.origin}:`,
        jobResult.details
      );
      const deregistered = this.jobs.deregisterJob(jobResult.origin, jobResult.jobId);
      if (deregistered) {
        try {
          const res = await Domain.updateOne(
            {
              origin: jobResult.origin,
              jobId: jobResult.jobId
            },
            {
              $set: { status: 'ready' },
              $unset: {
                workerId: '',
                jobId: ''
              }
            }
          );
          if (res.acknowledged && res.modifiedCount) {
            log.debug(`Domain status updated for ${jobResult.origin} after domain crawl`);
          } else {
            log.warn(
              `Domain update returned no modifications for ${jobResult.origin} after domain crawl`
            );
          }
        } catch (err) {
          log.error(
            `Failed to update domain status after domain crawl for ${jobResult.origin}`,
            err
          );
        }
      } else {
        log.warn(
          `Skipping domain update for ${jobResult.origin}: deregister failed (jobId mismatch or not found)`
        );
      }
    }
    if (jobResult.jobType === 'domainLabelFetch') {
      log.warn(
        `Received completion of domain label fetch (job #${jobResult.jobId}) for ${jobResult.origin}:`,
        jobResult.details
      );
      const deregistered = this.jobs.deregisterJob(jobResult.origin, jobResult.jobId);
      if (deregistered) {
        try {
          const res = await Domain.updateOne(
            {
              origin: jobResult.origin,
              jobId: jobResult.jobId
            },
            {
              $set: { status: 'ready' },
              $unset: {
                workerId: '',
                jobId: ''
              }
            }
          );
          if (res.acknowledged && res.modifiedCount) {
            log.debug(`Domain status updated for ${jobResult.origin} after domain label fetch`);
          } else {
            log.warn(
              `Domain update returned no modifications for ${jobResult.origin} after domain label fetch`
            );
          }
        } catch (err) {
          log.error(
            `Failed to update domain status after domain label fetch for ${jobResult.origin}`,
            err
          );
        }
      } else {
        log.warn(
          `Skipping domain update for ${jobResult.origin}: deregister failed (jobId mismatch or not found)`
        );
      }
    }
  }

  /**
   * Save results of a resource label fetch job to the database, including new labels and any errors
   * @param jobResult Result of the resource label fetch job to save
   */
  async saveLabelFetch(jobResult: FetchLabelsResourceResult) {
    if (jobResult.status === 'not_ok') {
      // Update ResourceLabel status to error
      await ResourceLabel.findOneAndUpdate({ url: jobResult.url }, { status: 'error' });
      return;
    }

    await this.saveCrawl2(jobResult);

    // Update ResourceLabel status to done
    const rl = await ResourceLabel.findOneAndUpdate(
      { url: jobResult.url },
      { status: 'done' },
      { new: true }
    );

    if (!rl) {
      log.error(`ResourceLabel not found for url ${jobResult.url} when saving label fetch results`);
      return;
    }

    const { triples } = jobResult.details;
    if (!triples.length) {
      return;
    }

    // Check if all cardea labels with extend=false are done for this process
    if (rl.source === 'cardea' && rl.extend === false) {
      const remaining = await ResourceLabel.countDocuments({
        pid: rl.pid,
        status: 'new',
        source: 'cardea',
        extend: false
      });
      if (remaining === 0) {
        await notifyLabelsFetched(rl.pid);
      }
    }
  }

  /**
   * Save results of a resource crawl job to the database, including new triples and any errors
   * @param jobResult Result of the resource crawl job to save
   */
  async saveCrawl2(jobResult: CrawlResourceResult | FetchLabelsResourceResult) {
    const pathType = await this.getPathTypeForUrl(jobResult.url);
    if (jobResult.status === 'not_ok') {
      return await Resource.markAsCrawled(jobResult.url, pathType, jobResult, jobResult.err);
    }
    // mark head as crawled
    await Resource.markAsCrawled(jobResult.url, pathType, jobResult);

    log.silly('jobResult.url', jobResult.url);
    log.silly('jobResult.details.triples', JSON.stringify(jobResult.details.triples, null, 2));

    // filter out triples which dont refer to head resource
    //const triples = jobResult.details.triples.filter(
    //	(t) => t.object === jobResult.url || t.subject === jobResult.url
    //);

    await this.processNewTriples(
      jobResult.url,
      jobResult.details.triples,
      // if this crawl was for fetching labels,
      // we only want to extend paths for the label triples
      jobResult.jobType === 'resourceLabelFetch'
    );
  }

  /**
   * Process new triples found when crawling a resource
   * Adds new resources and triples to the database, and updates process paths accordingly
   * @param sourceUrl URL of the resource from which the triples were obtained
   * @param triples Array of triples to process
   * @param extendLabelsOnly If true, only extend paths for label triples and skip extending paths for other triples. This is used when processing triples from a resource label fetch, since we only want to extend paths for the label triples in that case.
   */
  async processNewTriples(sourceUrl: string, triples: SimpleTriple[], extendLabelsOnly = false) {
    log.info('processNewTriples called for:', sourceUrl, 'with', triples.length, 'triples');

    if (!triples.length) {
      log.warn('No triples found when dereferencing', sourceUrl);
      return;
    }

    // Filter triples: keep all NamedNode triples,
    // and only keep literal triples with whitelisted predicates
    const nnTriples = triples.filter((t) => typeof t.object === 'string');
    const labelTriples = this.getLabelTriples(triples);

    const source = (await Resource.findOne({
      url: sourceUrl
    })) as ResourceClass;

    // add new resources
    await Resource.addFromTriples([...nnTriples, ...labelTriples]);

    // Store all triples using unified upsertMany
    log.info('Calling Triple.upsertMany with', nnTriples.length, 'triples');
    const nnTripleResult = await Triple.upsertMany(source.url, nnTriples);
    log.info('Triple.upsertMany result:', nnTripleResult);

    log.info('Calling Triple.upsertMany with', labelTriples.length, 'label triples');
    const labelTripleResult = await Triple.upsertMany(source.url, labelTriples);
    log.info('Triple.upsertMany result for label triples:', labelTripleResult);

    if (extendLabelsOnly) {
      log.info('Skipping extendPaths for headUrl:', source.url, 'because dontExtend flag is set');
      const upsertedIds = labelTripleResult
        .map((r) => Object.values(r.upsertedIds || {}))
        .flat()
        .filter((id): id is Types.ObjectId => id != null);
      const labelTripleDocs = upsertedIds.length
        ? ((await Triple.find({ _id: { $in: upsertedIds } })) as TripleDocument[])
        : [];
      await extendPaths({ triples: labelTripleDocs });
      return;
    }

    // extend paths with source url as head
    log.info('Calling extendPaths for headUrl:', source.url);
    await extendPaths({ headUrl: source.url });
    log.info('extendPaths complete for headUrl:', source.url);
  }

  /**
   * Returns literal triples with rdfs:label or rdfs:comment predicates that have language 'en'.
   * Returns them as SimpleTriple format for compatibility with the result type.
   */
  getLabelTriples(triples: SimpleTriple[]): SimpleLiteralTriple[] {
    const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
    const RDFS_COMMENT = 'http://www.w3.org/2000/01/rdf-schema#comment';

    return triples
      .filter((t): t is SimpleLiteralTriple => {
        if (t.predicate !== RDFS_LABEL && t.predicate !== RDFS_COMMENT) return false;
        const lit = t as SimpleLiteralTriple;
        return lit.object.language === 'en';
      })
      .map(
        (t): SimpleLiteralTriple => ({
          subject: t.subject,
          predicate: t.predicate,
          type: TripleType.LITERAL,
          object: t.object
        })
      );
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

  /**
   * Assign domain label fetch jobs to a worker based on its reported availability, and update the assigned jobs count
   * @param workerId ID of the worker to assign jobs to
   * @param workerAvail Object describing the worker's available job capacities
   * @param assigned Object tracking the count of assigned jobs by type for this worker
   * @returns An async iterable of domain label fetch job requests to assign to the worker
   */
  async *assignLabelFetch(
    workerId: string,
    workerAvail: JobCapacity,
    assigned: AssignedJobs
  ): AsyncIterable<DomainLabelFetchJobRequest> {
    if (!workerAvail?.domainLabelFetch?.capacity) {
      log.warn(`Worker ${workerId} has no capacity for domainLabelFetch jobs`);
      return;
    }

    log.debug(
      `Getting ${workerAvail.domainLabelFetch.capacity} domainLabelFetch jobs for ${workerId}`
    );
    const getRunningDomains = () => this.jobs.getRunningDomains();
    let gotRes = false;

    for await (const labelJob of Domain.labelsToFetch(
      workerId,
      workerAvail.domainLabelFetch.capacity,
      workerAvail.domainLabelFetch.resourcesPerDomain,
      getRunningDomains
    )) {
      gotRes = true;
      if (
        labelJob?.resources?.length &&
        (await this.jobs.registerJob(
          labelJob.domain.jobId,
          labelJob.domain.origin,
          'domainLabelFetch'
        ))
      ) {
        assigned.labelFetch++;
        yield {
          type: 'domainLabelFetch',
          jobId: labelJob.domain.jobId,
          ...labelJob
        };
      } else {
        log.info(`No resources with labels to fetch for worker ${workerId}`);
      }
    }
    if (!gotRes) {
      log.info(`No domains with labels to fetch for worker ${workerId}`);
    }
  }

  /**
   * Assign domain crawl jobs to a worker based on its reported availability, and update the assigned jobs count
   * @param workerId ID of the worker to assign jobs to
   * @param workerAvail Object describing the worker's available job capacities
   * @param assigned Object tracking the count of assigned jobs by type for this worker
   * @returns An async iterable of domain crawl job requests to assign to the worker
   */
  async *assignDomainCrawl(
    workerId: string,
    workerAvail: JobCapacity,
    assigned: AssignedJobs
  ): AsyncIterable<DomainCrawlJobRequest> {
    if (!workerAvail?.domainCrawl?.capacity) {
      log.warn(`Worker ${workerId} has no capacity for domainCrawl jobs`);
      return;
    }

    log.debug(`Getting ${workerAvail.domainCrawl.capacity} domainCrawl jobs for ${workerId}`);
    const getRunningDomains = () => this.jobs.getRunningDomains();
    let gotRes = false;
    for await (const crawl of Domain.domainsToCrawl2(
      workerId,
      workerAvail.domainCrawl.capacity,
      workerAvail.domainCrawl.resourcesPerDomain,
      getRunningDomains
    )) {
      log.silly('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX assigning domainCrawl', {
        workerId,
        workerAvail,
        crawl
      });
      gotRes = true;
      if (
        crawl?.resources?.length &&
        (await this.jobs.registerJob(crawl.domain.jobId, crawl.domain.origin, 'domainCrawl'))
      ) {
        assigned.crawl++;
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

  /**
   * Assign robots check jobs to a worker based on its reported availability, and update the assigned jobs count
   * @param workerId ID of the worker to assign jobs to
   * @param workerAvail Object describing the worker's available job capacities
   * @param assigned Object tracking the count of assigned jobs by type for this worker
   * @returns An async iterable of robots check job requests to assign to the worker
   */
  async *assignRobotsCheck(
    workerId: string,
    workerAvail: JobCapacity,
    assigned: AssignedJobs
  ): AsyncIterable<RobotsCheckJobRequest> {
    if (!workerAvail?.robotsCheck?.capacity) {
      log.warn(`Worker ${workerId} has no capacity for robotsCheck jobs`);
      return;
    }

    log.debug(`Getting ${workerAvail.robotsCheck.capacity} robotsCheck jobs for ${workerId}`);
    const getRunningDomains = () => this.jobs.getRunningDomains();
    let gotRes = false;
    for await (const check of Domain.domainsToCheck(
      workerId,
      workerAvail.robotsCheck.capacity,
      getRunningDomains
    )) {
      gotRes = true;
      if (await this.jobs.registerJob(check.jobId, check.origin, 'robotsCheck')) {
        log.silly('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX assigning robotsCheck', {
          workerId,
          workerAvail,
          check
        });
        assigned.check++;
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

  /**
   * Assign jobs to a worker based on its reported availability, prioritizing domain label fetch, then domain crawl, then robots check jobs
   * @param workerId ID of the worker to assign jobs to
   * @param workerAvail Object describing the worker's available job capacities
   * @returns An async iterable of job requests to assign to the worker
   */
  async *assignJobs(
    workerId: string,
    workerAvail: JobCapacity
  ): AsyncIterable<Exclude<JobRequest, ResourceCrawlJobRequest | ResourceLabelFetchJobRequest>> {
    if (this.jobs.beingSaved.count() > 0) {
      log.warn(
        `Too many jobs (${this.jobs.beingSaved.count()}) being saved, waiting for them to reduce before assigning new jobs`
      );
      return; // TODO check if this is correct
    } else {
      log.debug(
        `Only ${this.jobs.beingSaved.count()} jobs being saved, proceeding to assign new jobs for worker ${workerId}`
      );
    }
    let assigned = {
      check: 0,
      crawl: 0,
      labelFetch: 0
    };

    // domainLabelFetch jobs
    yield* this.assignLabelFetch(workerId, workerAvail, assigned);

    // domainCrawl jobs
    yield* this.assignDomainCrawl(workerId, workerAvail, assigned);

    // robotsCheck jobs
    yield* this.assignRobotsCheck(workerId, workerAvail, assigned);

    if (!assigned.check && !assigned.crawl && !this.jobs.count() && !this.jobs.beingSaved.count()) {
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
        assigned.check,
        assigned.crawl,
        this.jobs.toString()
      );
    }
  }

  private async getPathTypeForUrl(url: string): Promise<PathType> {
    let pathType = PathType.TRAVERSAL;
    const tp = await TraversalPath.findOne({
      'head.url': url,
      'head.type': HEAD_TYPE.URL,
      status: 'active'
    })
      .select('processId')
      .lean();

    if (tp) {
      const proc = await Process.findOne({ pid: (tp as any).processId })
        .select('curPathType')
        .lean();
      if (proc) {
        pathType = (proc as any).curPathType ?? PathType.TRAVERSAL;
      }
    } else {
      const ep = await EndpointPath.findOne({
        'head.url': url,
        'head.type': HEAD_TYPE.URL,
        status: 'active'
      })
        .select('processId')
        .lean();

      if (ep) {
        pathType = PathType.ENDPOINT;
      }
    }
    return pathType;
  }
}
