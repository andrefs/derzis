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
} from '@derzis/models';
import { notifyLabelsFetched } from '@derzis/models/Process/process-notifications';
import { type JobResult, type RobotsCheckResult, type CrawlResourceResult } from '@derzis/common';
import { createLogger } from '@derzis/common/server';
const log = createLogger('Manager');
import RunningJobs from './RunningJobs';
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

          if (res.acknowledged && res.modifiedCount) {
            this.jobs.deregisterJob(jobResult.origin);
            log.debug(`Done saving domain crawl (job #${jobResult.jobId}) for ${jobResult.origin}`);
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
          await Domain.findOneAndUpdate(
            { origin: jobResult.origin },
            { $inc: { 'crawl.ongoing': -1 } }
          );
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
            this.jobs.deregisterJob(jobResult.origin);
            log.debug(
              `Done saving resource label fetch (job #${jobResult.jobId}) for domain ${jobResult.origin}: ${jobResult.url}`
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
    }
    if (jobResult.jobType === 'domainLabelFetch') {
      log.warn(
        `Received completion of domain label fetch (job #${jobResult.jobId}) for ${jobResult.origin}:`,
        jobResult.details
      );
      // Reset domain status from 'labelFetching' to 'ready'
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
        this.jobs.deregisterJob(jobResult.origin);
        log.debug(`Done saving domain label fetch (job #${jobResult.jobId}) for ${jobResult.origin}`);
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
      await ResourceLabel.findOneAndUpdate(
        { url: jobResult.url },
        { status: 'error' }
      );
      return;
    }

    const { triples } = jobResult.details;

    // Get the ResourceLabel to check the extend flag
    const resourceLabel = await ResourceLabel.findOne({ url: jobResult.url });
    const extend = resourceLabel?.extend ?? false;

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
    if (!triples.length) {
      return;
    }

    // Get the source Resource
    const source = (await Resource.findOne({
      url: jobResult.url
    })) as ResourceClass;

    // Store triples in Triple collection
    log.info('Calling Triple.upsertMany with', triples.length, 'label triples');
    const tripleResult = await Triple.upsertMany(source, triples);
    log.info('Triple.upsertMany result:', tripleResult);

    if (extend) {
      // Extend paths with this resource as head (normal flow)
      await this.updateAllPathsWithHead(jobResult.url);
    } else {
      // Get the saved triples to link to ProcessTriple
      const savedIds = tripleResult.flatMap(r => r.upsertedIds ? Object.values(r.upsertedIds) : []);
      const savedTriples = await Triple
        .find({ _id: { $in: savedIds } })
        .select('_id type')
        .lean();

      const procTripleInputs = savedTriples.map(t => ({
        processId: rl.pid,
        triple: t._id,
        tripleType: t.type,
        processStep: -1 // label fetch triples are not associated with a specific step, so we can use a placeholder value
      }));
      await ProcessTriple.upsertMany(procTripleInputs);
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

    const pids = config.manager.pathType === PathType.TRAVERSAL
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

  /**
   * Assign domain label fetch jobs to a worker based on its reported availability, and update the assigned jobs count
   * @param workerId ID of the worker to assign jobs to
   * @param workerAvail Object describing the worker's available job capacities
   * @param assigned Object tracking the count of assigned jobs by type for this worker
   * @returns An async iterable of domain label fetch job requests to assign to the worker
   */
  async * assignLabelFetch(
    workerId: string,
    workerAvail: JobCapacity,
    assigned: AssignedJobs
  ): AsyncIterable<DomainLabelFetchJobRequest> {
    if (!workerAvail?.domainLabelFetch?.capacity) {
      log.warn(`Worker ${workerId} has no capacity for domainLabelFetch jobs`);
      return;
    }

    log.debug(`Getting ${workerAvail.domainLabelFetch.capacity} domainLabelFetch jobs for ${workerId}`);
    let gotRes = false;

    for await (const labelJob of Domain.labelsToFetch(
      workerId,
      workerAvail.domainLabelFetch.capacity,
      workerAvail.domainLabelFetch.resourcesPerDomain
    )) {
      gotRes = true;
      if (labelJob?.resources?.length &&
        (await this.jobs.registerJob(labelJob.domain.jobId, labelJob.domain.origin, 'domainLabelFetch'))) {
        assigned.labelFetch++;
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


  /**
   * Assign domain crawl jobs to a worker based on its reported availability, and update the assigned jobs count
   * @param workerId ID of the worker to assign jobs to
   * @param workerAvail Object describing the worker's available job capacities
   * @param assigned Object tracking the count of assigned jobs by type for this worker
   * @returns An async iterable of domain crawl job requests to assign to the worker
   */
  async * assignDomainCrawl(workerId: string, workerAvail: JobCapacity, assigned: AssignedJobs): AsyncIterable<DomainCrawlJobRequest> {
    if (!workerAvail?.domainCrawl?.capacity) {
      log.warn(`Worker ${workerId} has no capacity for domainCrawl jobs`);
      return;
    }

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
  async * assignRobotsCheck(workerId: string, workerAvail: JobCapacity, assigned: AssignedJobs): AsyncIterable<RobotsCheckJobRequest> {
    if (!workerAvail?.robotsCheck?.capacity) {
      log.warn(`Worker ${workerId} has no capacity for robotsCheck jobs`);
      return;
    }

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
  async * assignJobs(
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
    let assigned = {
      check: 0,
      crawl: 0,
      labelFetch: 0
    }



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
}
