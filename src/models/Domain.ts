import { FilterQuery } from 'mongoose';
import { Schema, model, Model, Document } from 'mongoose';
import { UpdateOneModel } from 'mongodb';
import { HttpError, createLogger } from 'src/common';
import { RobotsCheckResultError, RobotsCheckResultOk } from 'src/worker';
import { Counter } from './Counter';
import { Path } from './Path';
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
  processIds: string[];
}

export interface IDomainDocument extends IDomain, Document { }

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
  upsertMany: (urls: string[], pids: string[]) => Promise<void>;
  domainsToCheck: (wId: string, limit: number) => Iterable<IDomain>;
  domainsToCrawl: (wId: string, limit: number) => Iterable<IDomain>;
}

const DomainSchema: Schema<IDomainDocument> = new Schema(
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
    processIds: [String],
  },
  { timestamps: true }
);

DomainSchema.index({
  status: 1,
  'crawl.pathHeads': 1,
  'crawl.nextAllowed': -1,
});

DomainSchema.index({
  'crawl.nextAllowed': -1,
});

DomainSchema.index({
  'robots.status': 1,
});

DomainSchema.index({
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

DomainSchema.statics.saveRobotsError = async function(
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

DomainSchema.statics.saveRobotsOk = async function(
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

DomainSchema.statics.upsertMany = async function(
  urls: string,
  pids: string[]
) {
  let domains: { [url: string]: UpdateOneModel<IDomain> } = {};

  for (const u of urls) {
    if (!domains[u]) {
      domains[u] = {
        filter: { origin: u },
        update: {
          $inc: { 'crawl.queued': 0 },
          $addToSet: {
            processIds: { $each: pids },
          },
        },
        upsert: true,
      };
    }
    (domains[u]['update'] as any).$inc['crawl.queued']++;
  }
  return this.bulkWrite(Object.values(domains).map((d) => ({ updateOne: d })));
};

DomainSchema.statics.domainsToCheck = async function*(wId, limit) {
  const query = {
    robots: { status: 'unvisited' },
    'crawl.pathHeads': { $gt: 0 },
  };
  const options = {
    new: true,
    sort: { 'crawl.pathHeads': -1 },
    fields: 'origin jobId',
  };
  for (let i = 0; i < limit; i++) {
    const jobId = await Counter.genId('jobs');
    const update = {
      $set: {
        'robots.status': 'checking',
        jobId,
        workerId: wId,
      },
    };
    const d = await this.findOneAndUpdate(query, update, options).lean();
    if (d) {
      yield d;
    } else {
      return;
    }
  }
  return;
};

DomainSchema.statics.domainsToCrawl = async function*(wId, limit) {
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

export const Domain = model<IDomainDocument, IDomainModel>(
  'Domain',
  DomainSchema
);
