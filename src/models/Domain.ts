import { FilterQuery } from 'mongoose';
import { Schema, model, Model, Document } from 'mongoose';
import { UpdateOneModel } from 'mongodb';
import { HttpError, createLogger } from '@derzis/common';
import {
  DomainCrawlJobInfo,
  RobotsCheckResultError,
  RobotsCheckResultOk,
} from '@derzis/worker';
import { Counter } from './Counter';
import { Path } from './Path';
import { Process } from './Process';
import { Resource } from './Resource';
const log = createLogger('Domain');

const errorTypes = [
  'E_ROBOTS_TIMEOUT',
  'E_RESOURCE_TIMEOUT',
  'E_DOMAIN_NOT_FOUND',
  'E_UNKNOWN',
];

export interface IDomain {
  origin: string;
  status: 'unvisited' | 'checking' | 'error' | 'ready' | 'crawling';
  error: Boolean;
  lastWarnings: [
    {
      errType: {
        type: String;
        enum: String;
      };
    }
  ];
  warnings: {
    E_ROBOTS_TIMEOUT: number;
    E_RESOURCE_TIMEOUT: number;
  };
  robots: {
    status: 'unvisited' | 'checking' | 'not_found' | 'error' | 'done';
    text: string;
    checked: Date;
    elapsedTime: number;
  };
  workerId: string;
  jobId: number;
  crawl: {
    delay: number;
    queued: number;
    success: number;
    ongoing: number;
    pathHeads: number;
    failed: number;
    nextAllowed: Date;
  };
  lastAccessed: Date;
}

export interface IDomainDocument extends IDomain, Document {}

interface IDomainModel extends Model<IDomainDocument> {
  saveRobotsOk: (
    jobResult: RobotsCheckResultOk,
    crawlDelay: number
  ) => Promise<IDomain>;
  saveRobotsError: (
    jobResult: RobotsCheckResultError,
    crawlDelay?: number
  ) => Promise<IDomain>;
  //saveRobotsNotFound: (jobResult: RobotsCheckResultError, crawlDelay: number) => Promise<IDomain>,
  //saveRobotsHostNotFoundError: (jobResult: RobotsCheckResultError) => Promise<IDomain>,
  //saveRobotsUnknownError: (jobResult: RobotsCheckResultError) => Promise<IDomain>,
  upsertMany: (urls: string[]) => Promise<void>;
  domainsToCheck: (wId: string, limit: number) => Iterable<IDomain>;
  domainsToCrawl: (wId: string, limit: number) => Iterable<IDomain>;
  domainsToCrawl2: (
    wId: string,
    domLimit: number,
    resLimit: number
  ) => AsyncIterable<DomainCrawlJobInfo>;
  lockForRobotsCheck: (wId: string, origins: string[]) => Promise<IDomain[]>;
  lockForCrawl: (wId: string, origins: string[]) => Promise<IDomain[]>;
}
const schema: Schema<IDomainDocument> = new Schema(
  {
    origin: {
      type: String,
      index: true,
      required: true,
      unique: true,
    },
    status: {
      type: String,
      enum: ['unvisited', 'checking', 'error', 'ready', 'crawling'],
      default: 'unvisited',
    },
    error: Boolean,
    lastWarnings: [
      {
        errType: {
          type: String,
          enum: errorTypes,
        },
      },
    ],
    warnings: {
      E_ROBOTS_TIMEOUT: {
        type: Number,
        default: 0,
      },
      E_RESOURCE_TIMEOUT: {
        type: Number,
        default: 0,
      },
      E_DOMAIN_NOT_FOUND: {
        type: Number,
        default: 0,
      },
      E_UNKNOWN: {
        type: Number,
        default: 0,
      },
    },
    robots: {
      status: {
        type: String,
        enum: ['unvisited', 'checking', 'not_found', 'error', 'done'],
        default: 'unvisited',
      },
      text: String,
      checked: Schema.Types.Date,
      elapsedTime: Number,
      // host, protocol, actual host, ...
    },
    workerId: String,
    jobId: Number,
    crawl: {
      delay: Number,
      queued: {
        type: Number,
        default: 0,
      },
      success: {
        type: Number,
        default: 0,
      },
      ongoing: {
        type: Number,
        default: 0,
      },
      pathHeads: {
        type: Number,
        default: 0,
      },
      failed: {
        type: Number,
        default: 0,
      },
      nextAllowed: Schema.Types.Date,
    },
    lastAccessed: Schema.Types.Date,
  },
  { timestamps: true }
);

schema.index({
  status: 1,
  'crawl.pathHeads': 1,
  'crawl.nextAllowed': -1,
});

schema.index({
  'crawl.nextAllowed': -1,
});

schema.index({
  'robots.status': 1,
});

schema.index({
  jobId: 1,
});

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

schema.statics.saveRobotsError = async function (
  jobResult: RobotsCheckResultError,
  crawlDelay: number
) {
  const doc =
    jobResult.err.errorType === 'http'
      ? robotsNotFound(jobResult, crawlDelay)
      : jobResult.err.errorType === 'host_not_found'
      ? robotsHostNotFoundError()
      : robotsUnknownError(jobResult);

  let d = await Domain.findOneAndUpdate(
    {
      origin: jobResult.origin,
      jobId: jobResult.jobId,
    },
    doc,
    { new: true }
  );

  if (jobResult.err.errorType === 'host_not_found') {
    for await (const path of Path.find({ 'head.domain': jobResult.origin })) {
      await path.markDisabled();
      d = await Domain.findOneAndUpdate(
        { origin: jobResult.origin },
        { $inc: { 'crawl.pathHeads': -1 } },
        { new: true }
      );
    }
  }

  return d;
};

schema.statics.saveRobotsOk = async function (
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
  return await Domain.findOneAndUpdate(
    {
      origin: jobResult.origin,
      jobId: jobResult.jobId,
    },
    doc,
    { new: true }
  );
};

schema.statics.upsertMany = async function (urls: string) {
  let domains: { [url: string]: UpdateOneModel<IDomain> } = {};

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
  return this.bulkWrite(Object.values(domains).map((d) => ({ updateOne: d })));
};

// OLD VERSION
//
// DomainSchema.statics.domainsToCheck = async function* (wId, limit) {
//   const query = {
//     robots: { status: 'unvisited' },
//     'crawl.pathHeads': { $gt: 0 },
//   };
//   const options = {
//     new: true,
//     sort: { 'crawl.pathHeads': -1 },
//     fields: 'origin jobId',
//   };
//   for (let i = 0; i < limit; i++) {
//     const jobId = await Counter.genId('jobs');
//     const update = {
//       $set: {
//         'robots.status': 'checking',
//         jobId,
//         workerId: wId,
//       },
//     };
//     const d = await this.findOneAndUpdate(query, update, options).lean();
//     if (d) {
//       yield d;
//     } else {
//       return;
//     }
//   }
//   return;
// };

schema.statics.lockForRobotsCheck = async function (
  wId: string,
  origins: [string]
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
};

schema.statics.lockForCrawl = async function (wId: string, origins: [string]) {
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
};

schema.statics.domainsToCheck = async function* (wId, limit) {
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
      const domains = await Domain.lockForRobotsCheck(wId, Array.from(origins));

      // these paths returned no available domains, skip them
      if (!domains.length) {
        continue PATHS_LOOP;
      }

      for (const d of domains) {
        yield d;
      }
    }
  }
  return;
};

schema.statics.domainsToCrawl2 = async function* (wId, domLimit, resLimit) {
  console.log('XXXXXXXXXX domainsToCrawl2 0', { wId, domLimit, resLimit });
  let domainsFound = 0;
  let procSkip = 0;
  let pathLimit = 20; // TODO get from config

  PROCESS_LOOP: while (domainsFound < domLimit) {
    const proc = await Process.getOneRunning(procSkip);
    console.log('XXXXXXXXXX domainsToCrawl2 1', { proc });
    if (!proc) {
      return;
    }
    procSkip++;

    let pathSkip = 0;
    PATHS_LOOP: while (domainsFound < domLimit) {
      const paths = await proc.getPaths(pathSkip, pathLimit);
      console.log('XXXXXXXXXX domainsToCrawl2 2', { paths });

      // if this process has no more available paths, skip it
      if (!paths.length) {
        continue PROCESS_LOOP;
      }
      pathSkip += pathLimit;

      const origins = new Set<string>(paths.map((p) => p.head.domain));
      const domains = await Domain.lockForCrawl(
        wId,
        Array.from(origins).slice(0, 20)
      );
      console.log('XXXXXXXXXX domainsToCrawl2 3', { domains });

      // these paths returned no available domains, skip them
      if (!domains.length) {
        continue PATHS_LOOP;
      }

      const domainInfo: {
        [origin: string]: DomainCrawlJobInfo;
      } = {};
      for (const d of domains) {
        domainInfo[d.origin] = { domain: d, resources: [] };
      }
      console.log('XXXXXXXXXX domainsToCrawl2 4', { domainInfo });
      for (const p of paths) {
        if (p.head.domain in domainInfo) {
          domainInfo[p.head.domain].resources!.push({ url: p.head.url });
        }
      }
      console.log('XXXXXXXXXX domainsToCrawl2 5', { domainInfo });

      for (const d in domainInfo) {
        const dPathHeads = domainInfo[d].resources!;
        const limit = Math.max(resLimit - dPathHeads.length, 0);

        console.log('XXXXXXXXXX domainsToCrawl2 6', {
          d,
          resLimit,
          dPathHeads,
          limit,
        });
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
        console.log('XXXXXXXXXX domainsToCrawl2 7', { allResources });

        await Resource.updateMany(
          { url: { $in: allResources.map((r) => r.url) } },
          { status: 'crawling', jobId: domainInfo[d].domain.jobId }
        ).lean();
        await Domain.updateOne(
          { origin: d, jobId: domainInfo[d].domain.jobId },
          { 'crawl.ongoing': allResources.length }
        );

        let res = {
          domain: domainInfo[d].domain,
          resources: allResources,
        };
        console.log('XXXXXXXXXX domainsToCrawl2 8', { res });
        yield res;
      }
    }
  }
};

schema.statics.domainsToCrawl = async function* (wId, limit) {
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
      if (d.robots && !Object.keys(d.robots).length) {
        delete d.robots;
      }
      yield d;
    } else {
      return;
    }
  }
  return;
};

export const Domain = model<IDomainDocument, IDomainModel>('Domain', schema);
