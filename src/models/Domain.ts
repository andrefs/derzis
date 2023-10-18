import { UpdateOneModel } from 'mongodb';
import { HttpError, createLogger } from '@derzis/common';
import {
  DomainCrawlJobInfo,
  RobotsCheckResultError,
  RobotsCheckResultOk,
} from '@derzis/worker';
import { Counter } from './Counter';
import { Path, PathDocument } from './Path';
import { Process } from './Process';
import { Resource } from './Resource';
import {
  prop,
  index,
  getModelForClass,
  ReturnModelType,
} from '@typegoose/typegoose';
const log = createLogger('Domain');

@index({
  status: 1,
  'crawl.pathHeads': 1,
  'crawl.nextAllowed': -1,
})
@index({
  'crawl.nextAllowed': -1,
})
@index({
  'robots.status': 1,
})
@index({
  jobId: 1,
})
class LastWarningClass {
  @prop()
  public errType!:
    | 'E_ROBOTS_TIMEOUT'
    | 'E_RESOURCE_TIMEOUT'
    | 'E_DOMAIN_NOT_FOUND'
    | 'E_UNKNOWN';
}
class WarningsClass {
  @prop({ default: 0 })
  public E_ROBOTS_TIMEOUT!: number;

  @prop({ default: 0 })
  public E_RESOURCE_TIMEOUT!: number;

  @prop({ default: 0 })
  public E_DOMAIN_NOT_FOUND!: number;

  @prop({ default: 0 })
  public E_UNKNOWN!: number;
}
class RobotsClass {
  @prop({
    enum: ['unvisited', 'checking', 'not_found', 'error', 'done'],
    default: 'unvisited',
  })
  public status!: 'unvisited' | 'checking' | 'not_found' | 'error' | 'done';

  @prop()
  public text?: string;

  @prop()
  public checked?: Date;

  @prop()
  public elapsedTime?: number;
}
class CrawlClass {
  @prop({ default: 0 })
  public delay!: number;

  @prop({ default: 0 })
  public queued!: number;

  @prop({ default: 0 })
  public success!: number;

  @prop({ default: 0 })
  public ongoing!: number;

  @prop({ default: 0 })
  public pathHeads!: number;

  @prop({ default: 0 })
  public failed!: number;

  @prop()
  public nextAllowed?: Date;
}
class DomainClass {
  @prop({ required: true, index: true, unique: true })
  public origin!: string;

  @prop({
    enum: ['unvisited', 'checking', 'error', 'ready', 'crawling'],
    default: 'unvisited',
  })
  public status!: 'unvisited' | 'checking' | 'error' | 'ready' | 'crawling';

  @prop()
  public error?: Boolean;

  @prop({ default: [] })
  public lastWarnings!: LastWarningClass[];

  @prop({ default: {} })
  public warnings!: WarningsClass;

  @prop()
  public robots?: RobotsClass;

  @prop()
  public workerId?: string;

  @prop()
  public jobId?: number;

  @prop({ required: true })
  public crawl!: CrawlClass;

  @prop()
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
        jobId: jobResult.jobId,
      },
      doc,
      { new: true }
    );

    if (jobResult.err.errorType === 'host_not_found') {
      for await (const path of Path.find({ 'head.domain': jobResult.origin })) {
        // await path.markDisabled(); // TODO make sure this was not needed
        d = await this.findOneAndUpdate(
          { origin: jobResult.origin },
          { $inc: { 'crawl.pathHeads': -1 } },
          { new: true }
        );
      }
    }

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
        lastAccessed: jobResult.details.endTime,
      },
      $unset: {
        workerId: '',
        jobId: '',
      },
    };
    return await this.findOneAndUpdate(
      {
        origin: jobResult.origin,
        jobId: jobResult.jobId,
      },
      doc,
      { new: true }
    );
  }

  public static async upsertMany(
    this: ReturnModelType<typeof DomainClass>,
    urls: string[]
  ) {
    let domains: { [url: string]: UpdateOneModel<DomainClass> } = {};

    for (const u of urls) {
      if (!domains[u]) {
        domains[u] = {
          filter: { origin: u },
          update: {
            $inc: { 'crawl.queued': 0 },
          },
          upsert: true,
        };
      }
      (domains[u]['update'] as any).$inc['crawl.queued']++;
    }
    return this.bulkWrite(
      Object.values(domains).map((d) => ({ updateOne: d }))
    );
  }

  public static async lockForRobotsCheck(
    this: ReturnModelType<typeof DomainClass>,
    wId: string,
    origins: string[]
  ) {
    const jobId = await Counter.genId('jobs');
    const query = {
      origin: { $in: origins },
      status: 'unvisited',
    };
    const update = {
      $set: {
        status: 'checking',
        jobId,
        workerId: wId,
      },
    };
    const options = {
      new: true,
      fields: 'origin jobId',
    };
    await this.findOneAndUpdate(query, update, options);
    return this.find({ jobId }).lean();
  }

  public static async lockForCrawl(
    this: ReturnModelType<typeof DomainClass>,
    wId: string,
    origins: string[]
  ) {
    const jobId = await Counter.genId('jobs');
    const query = {
      origin: { $in: origins },
      status: 'ready',
      'crawl.nextAllowed': { $lte: Date.now() },
    };
    const update = {
      $set: {
        status: 'crawling',
        jobId,
        workerId: wId,
      },
    };
    const options = {
      new: true,
      fields: 'origin jobId',
    };
    await this.findOneAndUpdate(query, update, options);
    return this.find({ jobId }).lean();
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

      let pathSkip = 0;
      PATHS_LOOP: while (domainsFound < limit) {
        const paths = await proc.getPaths(pathSkip, pathLimit);

        // if this process has no more available paths, skip it
        if (!paths.length) {
          continue PROCESS_LOOP;
        }
        pathSkip += pathLimit;

        const origins = new Set<string>(paths.map((p) => p.head.domain));
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

  public static async *domainsToCrawl2(
    this: ReturnModelType<typeof DomainClass>,
    wId: string,
    domLimit: number,
    resLimit: number
  ) {
    let domainsFound = 0;
    let procSkip = 0;
    let pathLimit = 20; // TODO get from config

    // iterate over processes
    PROCESS_LOOP: while (domainsFound < domLimit) {
      const proc = await Process.getOneRunning(procSkip);
      if (!proc) {
        return;
      }
      procSkip++;

      let pathSkip = 0;
      // iterate over process' paths
      PATHS_LOOP: while (domainsFound < domLimit) {
        const paths: PathDocument[] = await proc.getPaths(pathSkip, pathLimit);

        // if this process has no more available paths, skip it
        if (!paths.length) {
          continue PROCESS_LOOP;
        }
        pathSkip += pathLimit;

        // get only unvisited path heads
        const heads = [...new Set(paths.map((p) => p.head.url))];
        const unvisHeads = await Resource.find({
          url: { $in: heads },
          status: 'unvisited',
        }).lean();

        if (!unvisHeads.length) {
          continue PATHS_LOOP;
        }

        const origins = new Set<string>(unvisHeads.map((h) => h.domain));
        const domains = await this.lockForCrawl(
          wId,
          Array.from(origins).slice(0, 20)
        );

        // these paths returned no available domains, skip them
        if (!domains.length) {
          continue PATHS_LOOP;
        }

        domainsFound += domains.length;

        const domainInfo: {
          [origin: string]: DomainCrawlJobInfo;
        } = {};
        for (const d of domains) {
          domainInfo[d.origin] = { domain: d, resources: [] };
        }
        for (const h of unvisHeads) {
          if (h.domain in domainInfo) {
            domainInfo[h.domain].resources!.push({ url: h.url });
          }
        }

        for (const d in domainInfo) {
          const dPathHeads = domainInfo[d].resources!;
          const limit = Math.max(resLimit - dPathHeads.length, 0);

          const additionalResources = limit
            ? await Resource.find({
                origin: d,
                status: 'unvisited',
                url: { $nin: dPathHeads.map((r) => r.url) },
              })
                .limit(limit)
                .select('url')
                .lean()
            : [];
          const allResources = [...dPathHeads, ...additionalResources].slice(
            0,
            resLimit
          );

          await Resource.updateMany(
            { url: { $in: allResources.map((r) => r.url) } },
            { status: 'crawling', jobId: domainInfo[d].domain.jobId }
          ).lean();
          await this.updateOne(
            { origin: d, jobId: domainInfo[d].domain.jobId },
            { 'crawl.ongoing': allResources.length }
          );

          let res = {
            domain: domainInfo[d].domain,
            resources: allResources,
          };
          domainsFound++;
          yield res;
        }
      }
    }
  }

  public static async *domainsToCrawl(
    this: ReturnModelType<typeof DomainClass>,
    wId: string,
    limit: number
  ) {
    const query = {
      status: 'ready',
      'crawl.pathHeads': { $gt: 0 },
      'crawl.nextAllowed': { $lte: Date.now() },
    };
    const options = {
      returnDocument: 'before' as const,
      sort: { 'crawl.pathHeads': -1 },
      fields: 'origin crawl robots.text jobId status',
    };
    for (let i = 0; i < limit; i++) {
      const jobId = await Counter.genId('jobs');
      const update = {
        $set: {
          status: 'crawling',
          workerId: wId,
          jobId,
        },
      };
      const oldDoc = await this.findOneAndUpdate(query, update, options).lean();
      if (oldDoc) {
        const d = await this.findOne({ origin: oldDoc.origin }).lean();
        if (d && d.robots && !Object.keys(d.robots).length) {
          delete d.robots;
        }
        yield d;
      } else {
        return;
      }
    }
    return;
  }
}

const robotsNotFound = (
  jobResult: RobotsCheckResultError,
  crawlDelay: number
) => {
  let robotStatus = 'error';
  const msCrawlDelay = 1000 * crawlDelay;
  if ((jobResult.err as HttpError).httpStatus === 404) {
    robotStatus = 'not_found';
  }

  const endTime = jobResult.details?.endTime || Date.now();
  const nextAllowed = jobResult.details
    ? new Date(endTime + msCrawlDelay)
    : Date.now() + 1000;
  return {
    $set: {
      'robots.status': robotStatus,
      status: 'ready' as const,
      'crawl.delay': crawlDelay,
      'crawl.nextAllowed': nextAllowed,
    },
    $unset: {
      workerId: '',
      jobId: '',
    },
  };
};

const robotsUnknownError = (jobResult: RobotsCheckResultError) => {
  log.error(
    `Unknown error in robots check (job #${jobResult.jobId}) for ${jobResult.origin}`
  );
  console.log(jobResult);
  return {
    $set: {
      'robots.status': 'error' as const,
      status: 'ready' as const,
    },
    $push: {
      lastWarnings: {
        $each: [{ errType: 'E_UNKNOWN' }],
        $slice: -10,
      },
    },
    $inc: {
      'warnings.E_UNKNOWN': 1,
    },
    $unset: {
      workerId: '',
      jobId: '',
    },
  };
};

const robotsHostNotFoundError = () => {
  return {
    $set: {
      'robots.status': 'error' as const,
      status: 'error' as const,
      error: true,
    },
    $push: {
      lastWarnings: {
        $each: [{ errType: 'E_DOMAIN_NOT_FOUND' }],
        $slice: -10,
      },
    },
    $inc: {
      'warnings.E_DOMAIN_NOT_FOUND': 1,
    },
    $unset: {
      workerId: '',
      jobId: '',
    },
  };
};

const Domain = getModelForClass(DomainClass, {
  schemaOptions: { timestamps: true },
});
export { Domain, DomainClass };
