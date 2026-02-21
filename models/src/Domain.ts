import { createLogger } from '@derzis/common/server';
import { HttpError } from '@derzis/common';
import type { PathType, RobotsCheckResultError, RobotsCheckResultOk } from '@derzis/common';
import { Counter } from './Counter';
import { TraversalPath, HEAD_TYPE, UrlHead } from './Path';
import { Process } from './Process';
import { Resource } from './Resource';
import { type UpdateOneModel, Types } from 'mongoose';
import {
  prop,
  index,
  getModelForClass,
  type ReturnModelType,
  PropType,
  post,
  DocumentType
} from '@typegoose/typegoose';
import type { DomainCrawlJobInfo } from '@derzis/common';
import config from '@derzis/config';
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

@post<DomainClass>('findOneAndUpdate', async function (doc) {
  if (doc) {
    // TODO what about EndpointPaths?
    await TraversalPath.updateMany(
      { 'head.domain.origin': doc.origin, status: 'active', 'head.type': HEAD_TYPE.URL },
      { $set: { 'head.domain.status': doc.status } }
    );
  }
})
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
class DomainClass {
  @prop({ required: true, type: String })
  public origin!: string;

  @prop({
    enum: ['unvisited', 'checking', 'error', 'ready', 'crawling'],
    default: 'unvisited',
    type: String
  })
  public status!: 'unvisited' | 'checking' | 'error' | 'ready' | 'crawling';

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
    return await this.findOneAndUpdate(
      {
        origin: jobResult.origin,
        jobId: jobResult.jobId
      },
      doc,
      { new: true }
    );
  }

  public static async upsertMany(this: ReturnModelType<typeof DomainClass>, urls: string[]) {
    const domains: { [url: string]: UpdateOneModel<DomainClass> } = {};

    for (const u of urls) {
      if (!domains[u]) {
        const filter = { origin: u };
        const update: {
          $inc: { 'crawl.queued': number };
        } = {
          $inc: { 'crawl.queued': 0 }
        };

        domains[u] = {
          filter,
          update,
          upsert: true
        };
      }
      (domains[u].update as any).$inc!['crawl.queued']++;
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
    if (domains.length) {
      await TraversalPath.updateMany(
        {
          'head.domain.origin': { $in: domains.map((d) => d.origin) },
          status: 'active',
          'head.type': HEAD_TYPE.URL
        },
        { $set: { 'head.domain.status': 'checking' } }
      );
    }
    return domains;
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
    const domains = this.find({ jobId }).lean();
    if (domains.length) {
      await TraversalPath.updateMany(
        {
          'head.domain.origin': { $in: domains.map((d: DomainClass) => d.origin) },
          status: 'active',
          'head.type': HEAD_TYPE.URL
        },
        { $set: { 'head.domain.status': 'crawling' } }
      );
    }

    return domains;
  }

  public static async *domainsToCheck(
    this: ReturnModelType<typeof DomainClass>,
    wId: string,
    limit: number
  ) {
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
      PATHS_LOOP: while (domainsFound < limit) {
        const paths = await proc.getPathsForRobotsChecking(
          config.manager.pathType as PathType,
          lastSeenCreatedAt,
          lastSeenId,
          pathLimit
        );

        // if this process has no more available paths, skip it
        if (!paths.length) {
          continue PROCESS_LOOP;
        }

        const lastPath = paths[paths.length - 1] as any;
        lastSeenCreatedAt = lastPath.createdAt;
        lastSeenId = lastPath._id;

        const origins = new Set<string>(paths
          .filter((p) => p.head.type === HEAD_TYPE.URL)
          .map((p) => (p.head as UrlHead).domain.origin));
        const domains = await this.lockForRobotsCheck(wId, Array.from(origins));

        // these paths returned no available domains, skip them
        if (!domains.length) {
          continue PATHS_LOOP;
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
    await TraversalPath.updateMany(
      {
        'head.url': { $in: resources.map((r) => r.url) },
        status: 'active',
        'head.type': HEAD_TYPE.URL
      },
      { $set: { 'head.status': 'crawling' } }
    ).lean();
    await this.updateOne({ origin: domain, jobId }, { 'crawl.ongoing': resources.length });
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
    resLimit: number
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

      let lastSeenCreatedAt: Date | null = null;
      let lastSeenId: Types.ObjectId | null = null;
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

        // get paths for this process
        const paths = await proc.getPathsForDomainCrawl(
          config.manager.pathType as PathType,
          blDomains,
          lastSeenCreatedAt,
          lastSeenId,
          pathLimit
        );
        if (!paths.length) {
          continue PROCESS_LOOP;
        }

        const lastPath = paths[paths.length - 1];
        lastSeenCreatedAt = (lastPath as { createdAt: Date }).createdAt;
        lastSeenId = (lastPath as { _id: Types.ObjectId })._id;

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

        log.info(
          `Preparing to lock for crawl domains from the following resources`,
          Array.from(new Set(unvisHeads.map((h) => h.url)))
        );
        const origins = new Set<string>(unvisHeads.map((h) => h.domain.origin));
        const domains = await this.lockForCrawl(wId, Array.from(origins).slice(0, 20));

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
            `Domain limit reached, only processing ${allowed} out of ${domains.length} locked domains.`
          );
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
  log.error(`Unknown error in robots check (job #${jobResult.jobId}) for ${jobResult.origin}`);
  console.log(jobResult);
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
