import { createLogger } from '@derzis/common/server';
import { HttpError } from '@derzis/common';
import type {
  DomainLabelFetchJobInfo,
  RobotsCheckResultError,
  RobotsCheckResultOk
} from '@derzis/common';
import { Counter } from './Counter';
import { HEAD_TYPE, Path, UrlHead, isTraversalPath, Head } from './Path';

function isUrlHead(head: Head): head is UrlHead {
  return head.type === HEAD_TYPE.URL;
}
import { Process } from './Process';
import { Resource } from './Resource';
import { type QueryFilter, Types } from 'mongoose';
import {
  prop,
  index,
  getModelForClass,
  type ReturnModelType,
  PropType,
  type DocumentType
} from '@typegoose/typegoose';
import type { DomainCrawlJobInfo } from '@derzis/common';
import config from '@derzis/config';
import { ResourceLabel, ResourceLabelDocument } from './ResourceLabel';
const log = createLogger('Domain');

type DomainErrorType =
  | 'E_ROBOTS_TIMEOUT'
  | 'E_RESOURCE_TIMEOUT'
  | 'E_DOMAIN_NOT_FOUND'
  | 'E_RESOURCE_ISSUE'
  | 'E_UNKNOWN';

class LastWarningClass {
  @prop({
    type: String,
    required: true,
    enum: ['E_ROBOTS_TIMEOUT', 'E_RESOURCE_TIMEOUT', 'E_DOMAIN_NOT_FOUND', 'E_UNKNOWN']
  })
  public errType!: DomainErrorType;
}
class WarningsClass {
  @prop({ default: 0, type: Number })
  public E_ROBOTS_TIMEOUT!: number;

  @prop({ default: 0, type: Number })
  public E_RESOURCE_TIMEOUT!: number;

  @prop({ default: 0, type: Number })
  public E_DOMAIN_NOT_FOUND!: number;

  @prop({ default: 0, type: Number })
  public E_UNKNOWN!: number;
}
class RobotsClass {
  @prop({
    enum: ['unvisited', 'checking', 'not_found', 'error', 'done'],
    default: 'unvisited',
    type: String
  })
  public status!: 'unvisited' | 'checking' | 'not_found' | 'error' | 'done';

  @prop({ type: String })
  public text?: string;

  @prop({ type: Date })
  public checked?: Date;

  @prop({ type: Number })
  public elapsedTime?: number;
}

class CrawlClass {
  @prop({ default: 0, type: Number, index: true, required: true })
  public delay!: number;

  @prop({ default: 0, type: Number })
  public queued!: number;

  @prop({ default: 0, type: Number })
  public success!: number;

  @prop({ default: 0, type: Number })
  public ongoing!: number;

  @prop({ default: 0, type: Number })
  public pathHeads!: number;

  @prop({ default: 0, type: Number })
  public failed!: number;

  @prop({ type: Date, required: true })
  public nextAllowed!: Date;
}

@index({ delay: 1 })
@index({ nextAllowed: 1 })
@index({
  status: 1,
  'crawl.pathHeads': 1,
  'crawl.nextAllowed': -1
})
@index({
  'robots.status': 1
})
@index({
  jobId: 1
})
@index({ status: 1, 'crawl.nextAllowed': 1 })
@index({ 'crawl.pathHeads': 1, 'crawl.nextAllowed': 1 })
@index({ origin: 1 })
@index({ origin: 1, jobId: 1 })
class DomainClass {
  @prop({ required: true, type: String })
  public origin!: string;

  @prop({
    enum: ['unvisited', 'checking', 'error', 'ready', 'crawling', 'labelFetching'],
    default: 'unvisited',
    type: String
  })
  public status!: 'unvisited' | 'checking' | 'error' | 'ready' | 'crawling' | 'labelFetching';

  @prop({ type: Boolean })
  public error?: boolean;

  @prop({ default: [], type: [LastWarningClass] }, PropType.ARRAY)
  public lastWarnings!: LastWarningClass[];

  @prop({ default: {}, type: WarningsClass })
  public warnings!: WarningsClass;

  @prop({ type: RobotsClass })
  public robots?: RobotsClass;

  @prop({ type: String })
  public workerId?: string;

  @prop({ required: true, type: Number })
  public jobId!: number;

  @prop({ required: true, type: CrawlClass })
  public crawl!: CrawlClass;

  @prop({ type: Date })
  public lastAccessed?: Date;

  public static async saveRobotsError(
    this: ReturnModelType<typeof DomainClass>,
    jobResult: RobotsCheckResultError,
    crawlDelay: number
  ) {
    const doc =
      jobResult.err.errorType === 'http'
        ? robotsNotFound(jobResult, crawlDelay)
        : jobResult.err.errorType === 'host_not_found'
          ? robotsHostNotFoundError()
          : robotsUnknownError(jobResult);

    let d = await this.findOneAndUpdate(
      {
        origin: jobResult.origin,
        jobId: jobResult.jobId
      },
      doc,
      { new: true }
    );

    // update all paths 'isUnvisited'
    await Path.updateMany(
      {
        'head.domain.origin': jobResult.origin,
        'head.type': HEAD_TYPE.URL
      },
      { 'head.domain.isUnvisited': false }
    );

    //if (jobResult.err.errorType === 'host_not_found') {
    //  for await (const path of TraversalPath.find({ 'head.domain': jobResult.origin, status: 'active' })) {
    //    // await path.markDisabled(); // TODO make sure this was not needed
    //    d = await this.findOneAndUpdate(
    //      { origin: jobResult.origin },
    //      { $inc: { 'crawl.pathHeads': -1 } },
    //      { new: true }
    //    );
    //  }
    //}

    return d;
  }

  public static async saveRobotsOk(
    this: ReturnModelType<typeof DomainClass>,
    jobResult: RobotsCheckResultOk,
    crawlDelay: number
  ) {
    const msCrawlDelay = 1000 * crawlDelay;
    const doc = {
      $set: {
        'robots.text': jobResult.details.robotsText,
        'robots.checked': jobResult.details.endTime,
        'robots.elapsedTime': jobResult.details.elapsedTime,
        'robots.status': 'done',
        status: 'ready',
        'crawl.delay': crawlDelay,
        'crawl.nextAllowed': new Date(jobResult.details.endTime + msCrawlDelay),
        lastAccessed: jobResult.details.endTime
      },
      $unset: {
        workerId: '',
        jobId: ''
      }
    };
    await this.findOneAndUpdate(
      {
        origin: jobResult.origin,
        jobId: jobResult.jobId
      },
      doc,
      { new: true }
    );

    // update all paths 'isUnvisited'
    await Path.updateMany(
      {
        'head.domain.origin': jobResult.origin,
        'head.type': HEAD_TYPE.URL
      },
      { 'head.domain.isUnvisited': false }
    );

    return;
  }

  public static async upsertMany(this: ReturnModelType<typeof DomainClass>, urls: string[]) {
    type DomainUpsertOp = {
      filter: { origin: string };
      update: { $inc: { 'crawl.queued': number } };
      upsert: true;
    };
    const domains: { [url: string]: DomainUpsertOp } = {};

    for (const u of urls) {
      if (!domains[u]) {
        domains[u] = {
          filter: { origin: u },
          update: { $inc: { 'crawl.queued': 0 } },
          upsert: true
        };
      }
      domains[u].update.$inc['crawl.queued']++;
    }
    return this.bulkWrite(Object.values(domains).map((d) => ({ updateOne: d })));
  }

  /**
   * Locks domains for robots.txt checking
   * Also updates the status of associated path head origins to 'checking'
   * @param wId - The worker ID
   * @param origins - The origins to lock
   * @returns {Promise<DomainClass[]>} - The locked domains
   */
  public static async lockForRobotsCheck(
    this: ReturnModelType<typeof DomainClass>,
    wId: string,
    origins: string[]
  ): Promise<DomainClass[]> {
    const jobId = await Counter.genId('jobs');
    const query = {
      origin: { $in: origins },
      status: 'unvisited'
    };
    const update = {
      $set: {
        status: 'checking',
        jobId,
        workerId: wId
      }
    };
    const options = {
      new: true,
      fields: 'origin jobId'
    };
    await this.findOneAndUpdate(query, update, options);
    const domains = await this.find({ jobId }).lean();
    return domains;
  }

  /**
   * Unlocks domains that were locked for robots.txt checking but not processed
   * @param wId - The worker ID
   * @param origins - The origins to unlock
   * @returns {Promise<void>}
   */
  public static async unlockFromRobotsCheck(
    this: ReturnModelType<typeof DomainClass>,
    wId: string,
    origins: string[]
  ): Promise<void> {
    const query = {
      origin: { $in: origins },
      status: 'checking',
      workerId: wId
    };
    const update = {
      $set: { status: 'unvisited' },
      $unset: { jobId: '', workerId: '' }
    };
    await this.updateMany(query, update);
  }
  public static async lockForLabelFetch(
    this: ReturnModelType<typeof DomainClass>,
    wId: string,
    origins: string[]
  ): Promise<DomainClass[]> {
    const jobId = await Counter.genId('jobs');
    if (origins.length === 0) {
      return [];
    }
    const query = {
      origin: origins.length === 1 ? origins[0] : { $in: origins },
      status: 'ready',
      'crawl.nextAllowed': { $lte: Date.now() }
    };
    const update = {
      $set: {
        status: 'labelFetching',
        jobId,
        workerId: wId
      }
    };
    const options = {
      new: true,
      fields: 'origin jobId'
    };
    await this.findOneAndUpdate(query, update, options);
    const domains = await this.find({ jobId }).lean();
    return domains;
  }

  /**
   * Unlocks domains that were locked for label fetching but not processed
   * @param wId - The worker ID
   * @param origins - The origins to unlock
   * @returns {Promise<void>}
   */
  public static async unlockFromLabelFetch(
    this: ReturnModelType<typeof DomainClass>,
    wId: string,
    origins: string[]
  ): Promise<void> {
    const query = {
      origin: { $in: origins },
      status: 'labelFetching',
      workerId: wId
    };
    const update = {
      $set: { status: 'ready' },
      $unset: { jobId: '', workerId: '' }
    };
    await this.updateMany(query, update);
  }
  /**
   * Locks domains for crawling
   * Also updates the status of associated path head origins to 'crawling'
   * @param wId - The worker ID
   * @param origins - The origins to lock
   * @returns {Promise<DomainClass[]>} - The locked domains
   */
  public static async lockForCrawl(
    this: ReturnModelType<typeof DomainClass>,
    wId: string,
    origins: string[]
  ): Promise<DomainClass[]> {
    const jobId = await Counter.genId('jobs');
    const query = {
      origin: { $in: origins },
      status: 'ready',
      'crawl.nextAllowed': { $lte: Date.now() }
    };
    const update = {
      $set: {
        status: 'crawling',
        jobId,
        workerId: wId
      }
    };
    const options = {
      new: true,
      fields: 'origin jobId'
    };
    await this.findOneAndUpdate(query, update, options);
    const domains = await this.find({ jobId }).lean();
    return domains;
  }

  /**
   * Unlocks domains that were locked for crawling but not processed
   * @param wId - The worker ID
   * @param origins - The origins to unlock
   * @returns {Promise<void>}
   */
  public static async unlockFromCrawl(
    this: ReturnModelType<typeof DomainClass>,
    wId: string,
    origins: string[]
  ): Promise<void> {
    const query = {
      origin: { $in: origins },
      status: 'crawling',
      workerId: wId
    };
    const update = {
      $set: {
        status: 'ready'
      },
      $unset: {
        jobId: '',
        workerId: ''
      }
    };
    await this.updateMany(query, update);
  }

  /**
   * Generator function to get domains that need robots.txt checking
   * Iterates over processes and their paths to find domains to check, locking them in the process
   * @param wId - The worker ID
   * @param limit - The maximum number of domains to yield
   * @returns {AsyncGenerator<DomainClass>}
   */
  public static async *domainsToCheck(
    this: ReturnModelType<typeof DomainClass>,
    wId: string,
    limit: number,
    getRunningDomains?: () => string[]
  ): AsyncGenerator<DomainClass> {
    let domainsFound = 0;
    let procSkip = 0;
    let pathLimit = 20;

    PROCESS_LOOP: while (domainsFound < limit) {
      const proc = await Process.getOneRunning(procSkip);
      if (!proc) {
        return;
      }
      procSkip++;

      let lastSeenCreatedAt: Date | null = null;
      let lastSeenId: Types.ObjectId | null = null;
      let lastSeenLength: number | null = null;
      let lastSeenShortestPathLength: number | null = null;
      PATHS_LOOP: while (domainsFound < limit) {
        const runningDomains = getRunningDomains ? getRunningDomains() : [];
        const paths = await proc.getPathsForRobotsChecking(
          proc.curPathType,
          runningDomains,
          lastSeenCreatedAt,
          lastSeenId,
          lastSeenLength,
          lastSeenShortestPathLength,
          pathLimit
        );

        // if this process has no more available paths, skip it
        if (!paths.length) {
          continue PROCESS_LOOP;
        }

        const lastPath = paths[paths.length - 1];
        lastSeenCreatedAt = lastPath.createdAt ?? null;
        lastSeenId = lastPath._id;
        if (isTraversalPath(lastPath)) {
          lastSeenLength = lastPath.nodes?.count ?? null;
        } else {
          lastSeenShortestPathLength = lastPath.shortestPathLength ?? null;
        }

        const origins = new Set<string>(
          paths
            .filter((p) => isUrlHead(p.head))
            .map((p) => p.head.domain.origin)
        );
        const domains = await this.lockForRobotsCheck(wId, Array.from(origins));
        log.silly(
          `Worker ${wId} locked the following domains for robots checking for process ${proc.id}: ${domains.map(
            (d) => d.origin
          )}`
        );

        // these paths returned no available domains, skip them
        if (!domains.length) {
          continue PATHS_LOOP;
        }

        const remainingCapacity = limit - domainsFound;
        if (domains.length > remainingCapacity) {
          const domainsToUnlock = domains.slice(remainingCapacity).map((d) => d.origin);
          await this.unlockFromRobotsCheck(wId, domainsToUnlock);
          domains.splice(remainingCapacity);
        }
        for (const d of domains) {
          domainsFound++;
          yield d;
        }
      }
    }
    return;
  }

  /**
   * Gets additional resources for a domain crawl
   * @param domain - The domain to get resources for
   * @param dPathHeads - The domain's path heads
   * @param resLimit - The maximum number of resources to get
   * @returns {Promise<{url: string}[]>}
   */
  static async getAdditionalResources(
    domain: string,
    dPathHeads: { url: string }[],
    resLimit: number
  ): Promise<{ url: string }[]> {
    const limit = Math.max(resLimit - dPathHeads.length, 0);
    const additionalResources = limit
      ? await Resource.find({
          domain,
          status: 'unvisited',
          url: { $nin: dPathHeads.map((r) => r.url) }
        })
          .limit(limit)
          .select('url')
          .lean()
      : [];
    const allResources = [...dPathHeads, ...additionalResources].slice(0, resLimit);
    return allResources;
  }

  /**
   * Updates the domain's crawl ongoing count
   * @param domain - The domain to update
   * @param resources - The resources being crawled
   * @param jobId - The job ID of the crawl
   * @returns {Promise<void>}
   */
  static async markLabelFetching(
    this: ReturnModelType<typeof DomainClass>,
    domain: string,
    resources: { url: string }[],
    jobId: number
  ): Promise<void> {
    await this.updateOne({ origin: domain, jobId }, { 'crawl.ongoing': resources.length });
  }

  /**
   * Marks resources and paths as crawling and updates the domain's ongoing count
   * @param domain - The domain to mark as crawling
   * @param resources - The resources to mark as crawling
   * @param jobId - The job ID to mark the resources with
   * @returns {Promise<void>}
   */
  static async markRPDCrawling(
    this: ReturnModelType<typeof DomainClass>,
    domain: string,
    resources: { url: string }[],
    jobId: number
  ): Promise<void> {
    await Resource.updateMany(
      { url: { $in: resources.map((r) => r.url) } },
      { status: 'crawling', jobId }
    ).lean();
    await this.updateOne({ origin: domain, jobId }, { 'crawl.ongoing': resources.length });
  }

  /**
   * Generator function to get domains with resources to fetch labels for
   * @param wId - The worker ID
   * @param domLimit - The maximum number of domains to fetch labels for
   * @param resLimit - The maximum number of resources per domain to fetch labels for
   * @returns {AsyncGenerator<DomainLabelFetchJobInfo>}
   */
  public static async *labelsToFetch(
    this: ReturnModelType<typeof DomainClass>,
    wId: string,
    domLimit: number,
    resLimit: number,
    getRunningDomains?: () => string[]
  ): AsyncGenerator<DomainLabelFetchJobInfo> {
    log.info(
      `Starting label fetch locking for worker ${wId} with domain limit ${domLimit} and resource limit ${resLimit}`
    );

    let domainsFound = 0;
    let lastSeenCreatedAt: Date | null = null;
    const labelsByDomain: { [domain: string]: string[] } = {};
    const BATCH_SIZE = 100;

    let hasMore = true;
    while (hasMore) {
      // Query BATCH_SIZE ResourceLabels
      const query: QueryFilter<ResourceLabelDocument> = { status: 'new' };
      if (lastSeenCreatedAt) {
        query.createdAt = { $gt: lastSeenCreatedAt };
      }
      const rls = await ResourceLabel.find(query)
        .sort({ createdAt: 1 })
        .limit(BATCH_SIZE)
        .select('url domain createdAt')
        .lean();

      log.debug(
        `Worker ${wId} fetched ${rls.length} resource labels for label fetching, last seen createdAt: ${
          lastSeenCreatedAt ? lastSeenCreatedAt.toISOString() : 'none'
        }`
      );
      if (!rls.length) {
        hasMore = false;
      } else {
        lastSeenCreatedAt = rls[rls.length - 1].createdAt ?? null;

        // Split them by domain
        for (const rl of rls) {
          if (!labelsByDomain[rl.domain]) {
            labelsByDomain[rl.domain] = [];
          }
          if (labelsByDomain[rl.domain].length < resLimit) {
            labelsByDomain[rl.domain].push(rl.url);
          }
        }

        // Try to lock domains which already have enough urls (>= resLimit)
        log.debug(
          `Worker ${wId} found the following domains with at least ${resLimit} resource labels: ${Object.entries(
            labelsByDomain
          )
            .filter(([, urls]) => urls.length >= resLimit)
            .map(([d]) => d)}`
        );
        let domainsReady = Object.entries(labelsByDomain)
          .filter(([, urls]) => urls.length >= resLimit)
          .map(([d]) => d);
        if (getRunningDomains) {
          const running = getRunningDomains();
          domainsReady = domainsReady.filter((d) => !running.includes(d));
        }
        const dsLocked = await this.lockForLabelFetch(wId, domainsReady);
        log.debug(
          `Worker ${wId} locked the following domains for label fetching: ${dsLocked.map((d) => d.origin)}`
        );

        // Ignore (drop) domains not locked
        for (const d of domainsReady) {
          if (!dsLocked.find((dl) => dl.origin === d)) {
            delete labelsByDomain[d];
          }
        }

        const remainingCapacity = domLimit - domainsFound;
        log.debug(
          `Worker ${wId} has capacity for ${remainingCapacity} more domains to fetch labels for.`
        );
        if (dsLocked.length > remainingCapacity) {
          const domainsToUnlock = dsLocked.slice(remainingCapacity).map((d) => d.origin);
          await this.unlockFromLabelFetch(wId, domainsToUnlock);
          dsLocked.splice(remainingCapacity);
        }
        // For each locked domain, yield it + its urls limited to resLimit
        for (const d of dsLocked) {
          const resources = labelsByDomain[d.origin].slice(0, resLimit).map((url) => ({ url }));
          await this.markLabelFetching(d.origin, resources, d.jobId);
          yield { domain: d, resources };
          domainsFound++;
          delete labelsByDomain[d.origin];
        }

        // If domLimit number of domains have been yielded, return
        if (domainsFound >= domLimit) {
          return;
        }

        // Check if we should continue (did we get a full batch?)
        if (rls.length < BATCH_SIZE) {
          hasMore = false;
        }
      }
    }

    // If there are no more ResourceLabels to query, yield whatever domains are left that can be locked
    const domainsReady = Object.entries(labelsByDomain)
      .filter(([, urls]) => urls.length > 0)
      .map(([d]) => d)
      .slice(0, domLimit - domainsFound);
    const dsLocked = await this.lockForLabelFetch(wId, domainsReady);

    for (const d of dsLocked) {
      yield {
        domain: d,
        resources: labelsByDomain[d.origin].slice(0, resLimit).map((url) => ({ url }))
      };
      domainsFound++;
      delete labelsByDomain[d.origin];
    }
  }

  /**
   * Generator function to get domains to crawl
   * @param wId - The worker ID
   * @param domLimit - The maximum number of domains to crawl
   * @param resLimit - The maximum number of resources per domain
   * @returns {AsyncGenerator<DomainCrawlJobInfo>}
   */
  public static async *domainsToCrawl2(
    this: ReturnModelType<typeof DomainClass>,
    wId: string,
    domLimit: number,
    resLimit: number,
    getRunningDomains?: () => string[]
  ): AsyncGenerator<DomainCrawlJobInfo> {
    log.info(
      `Starting domain crawl locking for worker ${wId} with domain limit ${domLimit} and resource limit ${resLimit}`
    );
    let domainsFound = 0;
    let procSkip = 0;
    let pathLimit = 20; // TODO get from config

    let skipDomains: { [origin: string]: Date } = {};

    // iterate over processes
    PROCESS_LOOP: while (domainsFound < domLimit) {
      log.info(
        `Worker ${wId} looking for process to crawl, skipping ${procSkip} processes so far.`
      );
      const proc = await Process.getOneRunning(procSkip);
      if (!proc) {
        return;
      }
      procSkip++;
      if (await proc.isDone()) {
        continue PROCESS_LOOP;
      }

      // for pagination of paths within the process
      let lastSeenCreatedAt: Date | null = null;
      let lastSeenId: Types.ObjectId | null = null;
      let lastSeenLength: number | null = null;
      let lastSeenShortestPathLength: number | null = null;

      // iterate over process' paths
      PATHS_LOOP: while (domainsFound < domLimit) {
        log.info(
          `Worker ${wId} looking for paths to crawl in process ${proc.id}, cursor: ${lastSeenCreatedAt?.toISOString() ?? 'none'}`
        );
        // determine which domains to skip based on their crawl.nextAllowed time
        const now = new Date();
        const blDomains = [];
        for (const d in skipDomains) {
          if (skipDomains[d] <= now) {
            delete skipDomains[d];
          } else {
            blDomains.push(d);
          }
        }
        if (Object.keys(skipDomains).length) {
          log.info(
            `Skipping domains: ${Object.keys(skipDomains)} because they cannot be crawled yet.`
          );
        }
        if (getRunningDomains) {
          blDomains.push(...getRunningDomains());
        }

        // get paths for this process
        const paths = await proc.getPathsForDomainCrawl(
          proc.curPathType,
          blDomains,
          lastSeenCreatedAt,
          lastSeenId,
          lastSeenLength,
          lastSeenShortestPathLength,
          pathLimit
        );
        if (!paths.length) {
          continue PROCESS_LOOP;
        }

        const lastPath = paths[paths.length - 1];
        lastSeenCreatedAt = (lastPath as { createdAt: Date }).createdAt;
        lastSeenId = (lastPath as { _id: Types.ObjectId })._id;
        // Track length for proper cursor pagination with compound sort
        if (config.manager.pathType === 'traversal') {
          lastSeenLength = (lastPath as { nodes: { count: number } }).nodes?.count ?? null;
        } else {
          lastSeenShortestPathLength =
            (lastPath as { shortestPathLength: number }).shortestPathLength ?? null;
        }

        // get only unvisited path heads
        const unvisHeads = paths
          .filter((p) => p.head.type === HEAD_TYPE.URL)
          .map((p) => p.head as UrlHead)
          .filter((h) => h.status === 'unvisited');
        if (!unvisHeads.length) {
          log.silly(
            `No unvisited path heads found for process ${proc.id} with current path batch, skipping to next batch.`
          );
          continue PATHS_LOOP;
        }

        // lock domains for crawling based on unvisited path heads
        log.info(
          `Preparing to lock for crawl domains from the following resources`,
          Array.from(new Set(unvisHeads.map((h) => h.url)))
        );
        const origins = new Set<string>(unvisHeads.map((h) => h.domain.origin));
        const domains = await this.lockForCrawl(wId, Array.from(origins).slice(0, 20));
        log.silly(
          `Worker ${wId} locked the following domains for crawling for process ${proc.id}: ${domains.map(
            (d) => d.origin
          )}`
        );

        // these paths returned no available domains, skip them
        if (!domains.length) {
          log.info(
            `No domains could be locked for crawling for process ${proc.id} with current path batch, skipping to next batch.`
          );
          const domains = await this.find({ origin: { $in: Array.from(origins) } })
            .select('origin crawl')
            .lean();
          for (const d of domains) {
            if (d.crawl.nextAllowed > new Date()) {
              skipDomains[d.origin] = d.crawl.nextAllowed;
              log.info(
                `Domain ${d.origin} cannot be crawled yet, next allowed at ${d.crawl.nextAllowed}`
              );
            }
          }
          continue PATHS_LOOP;
        }

        log.info(`Locked domains for crawling: ${domains.map((d) => d.origin)}`);

        // throw away domains over the limit
        if (domainsFound + domains.length > domLimit) {
          const allowed = domLimit - domainsFound;
          log.info(
            `Domain limit reached, only processing ${allowed} out of ${domains.length} locked domains, unlocking the rest.`
          );
          const domainsToUnlock = domains.slice(allowed).map((d) => d.origin);
          await this.unlockFromCrawl(wId, domainsToUnlock);
          domains.splice(allowed);
        }

        domainsFound += domains.length;

        const domainInfo: { [origin: string]: DomainCrawlJobInfo } = {};
        for (const d of domains) {
          domainInfo[d.origin] = { domain: d, resources: [] };
        }
        for (const h of unvisHeads) {
          if (h.domain.origin in domainInfo) {
            domainInfo[h.domain.origin].resources!.push({ url: h.url });
          }
        }

        for (const d in domainInfo) {
          const dPathHeads = domainInfo[d].resources!;
          const allResources = await this.getAdditionalResources(d, dPathHeads, resLimit);

          await this.markRPDCrawling(d, allResources, domainInfo[d].domain.jobId);

          let res = {
            domain: domainInfo[d].domain,
            resources: allResources
          };
          domainsFound++;
          yield res;
        }
      }
    }
  }

  //public static async *domainsToCrawl(
  //	this: ReturnModelType<typeof DomainClass>,
  //	wId: string,
  //	limit: number
  //) {
  //	const query = {
  //		status: 'ready',
  //		'crawl.pathHeads': { $gt: 0 },
  //		'crawl.nextAllowed': { $lte: Date.now() }
  //	};
  //	const options = {
  //		returnDocument: 'before' as const,
  //		sort: { 'crawl.pathHeads': -1 },
  //		fields: 'origin crawl robots.text jobId status'
  //	};
  //	for (let i = 0; i < limit; i++) {
  //		const jobId = await Counter.genId('jobs');
  //		const update = {
  //			$set: {
  //				status: 'crawling',
  //				workerId: wId,
  //				jobId
  //			}
  //		};
  //		const oldDoc = await this.findOneAndUpdate(query, update, options).lean();
  //		if (oldDoc) {
  //			const d = await this.findOne({ origin: oldDoc.origin }).lean();
  //			if (d && d.robots && !Object.keys(d.robots).length) {
  //				delete d.robots;
  //			}
  //			yield d;
  //		} else {
  //			return;
  //		}
  //	}
  //	return;
  //}

  public static async setNextCrawlAllowed(
    this: ReturnModelType<typeof DomainClass>,
    origin: string,
    ts: number,
    crawlDelay: number
  ) {
    const nextAllowed = new Date(ts + crawlDelay * 1000);

    const filter = {
      origin: new URL(origin).origin,
      'crawl.nextAllowed': {
        $lt: nextAllowed
      }
    };
    let d = await this.findOneAndUpdate(
      filter,
      {
        'crawl.nextAllowed': nextAllowed
      },
      { returnDocument: 'after' }
    );

    return d;
  }
}

const robotsNotFound = (jobResult: RobotsCheckResultError, crawlDelay: number) => {
  let robotStatus = 'error';
  const msCrawlDelay = 1000 * crawlDelay;
  if ((jobResult.err as HttpError).httpStatus === 404) {
    robotStatus = 'not_found';
  }

  const endTime = jobResult.details?.endTime || Date.now();
  const nextAllowed = jobResult.details ? new Date(endTime + msCrawlDelay) : Date.now() + 1000;
  return {
    $set: {
      'robots.status': robotStatus,
      status: 'ready' as const,
      'crawl.delay': crawlDelay,
      'crawl.nextAllowed': nextAllowed
    },
    $unset: {
      workerId: '',
      jobId: ''
    }
  };
};

const robotsUnknownError = (jobResult: RobotsCheckResultError) => {
  log.error(`Unknown error in robots check (job #${jobResult.jobId}) for ${jobResult.origin}`, {
    jobResult
  });
  return {
    $set: {
      'robots.status': 'error' as const,
      status: 'ready' as const,
      'crawl.delay': 1,
      'crawl.nextAllowed': Date.now() + 1000,
      error: true
    },
    $push: {
      lastWarnings: {
        $each: [{ errType: 'E_UNKNOWN' }],
        $slice: -10
      }
    },
    $inc: {
      'warnings.E_UNKNOWN': 1
    },
    $unset: {
      workerId: '',
      jobId: ''
    }
  };
};

const robotsHostNotFoundError = () => {
  return {
    $set: {
      'robots.status': 'error' as const,
      status: 'error' as const,
      'crawl.nextAllowed': Date.now() + 1000,
      'crawl.delay': 1,
      error: true
    },
    $push: {
      lastWarnings: {
        $each: [{ errType: 'E_DOMAIN_NOT_FOUND' }],
        $slice: -10
      }
    },
    $inc: {
      'warnings.E_DOMAIN_NOT_FOUND': 1
    },
    $unset: {
      workerId: '',
      jobId: ''
    }
  };
};

const Domain = getModelForClass(DomainClass, {
  schemaOptions: { timestamps: true, collection: 'domains' }
});
export type DomainDocument = DocumentType<DomainClass>;
export { Domain, DomainClass };
