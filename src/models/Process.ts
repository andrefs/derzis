import {
  Document,
  HydratedDocument,
  model,
  Model,
  Schema,
  Types,
} from 'mongoose';
import { Resource } from './Resource';
import { Triple, SimpleTriple, ITriple } from './Triple';
import { humanize } from 'humanize-digest';
import { Domain } from './Domain';
import { IPath, Path, PathDocument } from './Path';
import { ProcessTriple } from './ProcessTriple';

export interface IProcess {
  pid: string;
  notification: {
    email: string;
    webhook: string;
    ssePath: string;
  };
  description: string;
  seeds: Types.Array<string>;
  params: {
    maxPathLength: number;
    maxPathProps: number;
  };
  pathHeads: {
    required: true;
    type: { [key: string]: number };
  };
  status: 'queued' | 'running' | 'done' | 'error';
}

export type ProcessDocument = IProcess &
  Document & { updatedAt: Date; createdAt: Date };

interface IProcessMethods {
  getTriples(): AsyncIterable<SimpleTriple>;
  getTriplesJson(): AsyncIterable<string>;
  getInfo(): Promise<object>;
  getPaths(pathSkip: number, pathLimit: number): Promise<PathDocument[]>;
  extendWithExistingTriples(paths: PathDocument[]): Promise<void>;
  extendPaths(triplesByNode: {
    [url: string]: HydratedDocument<ITriple>[];
  }): Promise<void>;
}

interface ProcessModel extends Model<IProcess, {}, IProcessMethods> {
  startNext(): Promise<boolean>;
  getOneRunning(skip: number): Promise<IProcess & IProcessMethods>;
}

const schema = new Schema<IProcess, ProcessModel, IProcessMethods>(
  {
    pid: {
      type: String,
      index: true,
      unique: true,
    },
    notification: {
      email: String,
      webhook: String,
      ssePath: String,
    },
    description: String,
    seeds: [
      {
        type: String,
      },
    ],
    params: {
      maxPathLength: {
        type: Number,
        default: 2,
      },
      maxPathProps: {
        type: Number,
        default: 1,
      },
    },
    pathHeads: {
      type: Object,
    },
    status: {
      type: String,
      enum: ['queued', 'running', 'done', 'error'],
      default: 'queued',
    },
  },
  { timestamps: true }
);

schema.index({ status: 1 });
schema.index({ createdAt: 1 });

schema.pre('save', async function () {
  const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
  const count = await this.collection.countDocuments({
    createdAt: { $gt: today },
  });
  const date = today.toISOString().split('T')[0] + '-' + count;
  const word = humanize(date);
  this.pid = `${word}-${date}`;
  this.notification.ssePath = `/processes/${this.pid}/events`;
});

schema.method('getTriples', async function* () {
  const triples = Triple.find({ processIds: this.pid });
  for await (const { subject, predicate, object } of triples) {
    yield { subject, predicate, object };
  }
});

schema.method('getTriplesJson', async function* () {
  for await (const t of this.getTriples()) {
    yield JSON.stringify(t);
  }
});

schema.method('getPaths', async function (skip = 0, limit = 20) {
  const paths = await Path.find({
    processId: this.pid,
    'nodes.count': { $lte: this.params.maxPathLength },
    'predicates.count': { $lte: this.params.maxPathProps },
  })
    .sort({ 'nodes.count': -1 })
    .limit(limit)
    .skip(skip)
    .select('head.domain head.url')
    .lean();
  return paths;
});

schema.method(
  'extendPathsWithExistingTriples',
  async function (paths: PathDocument[]) {
    for (const path of paths) {
      const newPathObjs = [];
      const toDelete = new Set();
      const procTriples = new Set();

      const { newPaths: nps, procTriples: pts } =
        await path.extendWithExistingTriples();

      if (nps.length) {
        toDelete.add(path._id);
        newPathObjs.push(...nps);
        for (const pt of pts) {
          procTriples.add(pt);
        }
      }

      // create new paths
      const newPaths = await Path.create(newPathObjs);

      // delete old paths
      await Path.deleteMany({ _id: { $in: Array.from(toDelete) } });

      await this.extendPathsWithExistingTriples(newPaths);
    }
  }
);

schema.method(
  'extendPaths',
  async function (triplesByNode: {
    [url: string]: HydratedDocument<ITriple>[];
  }) {
    const paths = await Path.find({
      processId: this.pid,
      head: { $in: new Set(Object.keys(triplesByNode)) },
    });

    const pathsToDelete = new Set();
    const newPathObjs = [];
    const toDelete = new Set();
    const procTriples = new Set();

    for (const path of paths) {
      const { newPaths: nps, procTriples: pts } = await path.extend(
        triplesByNode[path.head.url]
      );
      if (nps.length) {
        toDelete.add(path._id);
        newPathObjs.push(...nps);
        for (const pt of pts) {
          procTriples.add(pt);
        }
      }
    }

    // add proc-triple associations
    await ProcessTriple.create(
      [...procTriples].map((tId) => ({ processId: this.pid, tripleId: tId }))
    );

    // create new paths
    const newPaths = await Path.create(newPathObjs);

    // delete old paths
    await Path.deleteMany({ _id: { $in: Array.from(toDelete) } });

    // add existing heads
    await this.extendPathsWithExistingTriples(newPaths);
  }
);

schema.method('getInfo', async function () {
  const baseFilter = { processIds: this.pid };
  const lastResource = await Resource.findOne(baseFilter).sort({
    updatedAt: -1,
  });
  return {
    resources: {
      total: await Resource.countDocuments(baseFilter).lean(),
      done: await Resource.countDocuments({
        ...baseFilter,
        status: 'done',
      }).lean(), // TODO add index
      crawling: await Resource.countDocuments({
        ...baseFilter,
        status: 'crawling',
      }).lean(), // TODO add index
      error: await Resource.countDocuments({
        ...baseFilter,
        status: 'error',
      }).lean(), // TODO add index
      seed: await Resource.countDocuments({
        ...baseFilter,
        isSeed: true,
      }).lean(), // TODO add index
    },
    triples: {
      total: await Triple.countDocuments(baseFilter).lean(),
    },
    domains: {
      total: await Domain.countDocuments(baseFilter).lean(),
      beingCrawled: (
        await Domain.find({ ...baseFilter, status: 'crawling' })
          .select('origin')
          .lean()
      ).map((d) => d.origin),
      ready: await Domain.countDocuments({
        ...baseFilter,
        status: 'ready',
      }).lean(), // TODO add index
      crawling: await Domain.countDocuments({
        ...baseFilter,
        status: 'crawling',
      }).lean(), // TODO add index
      error: await Domain.countDocuments({
        ...baseFilter,
        status: 'error',
      }).lean(), // TODO add index
    },
    paths: {
      total: await Path.countDocuments({
        'seed.url': { $in: this.seeds },
      }).lean(),
      finished: await Path.countDocuments({
        'seed.url': { $in: this.seeds },
        status: 'finished',
      }).lean(), // TODO add index
      disabled: await Path.countDocuments({
        'seed.url': { $in: this.seeds },
        status: 'disabled',
      }).lean(), // TODO add index
      active: await Path.countDocuments({
        'seed.url': { $in: this.seeds },
        status: 'active',
      }).lean(), // TODO add index
    },
    // TODO remove allPaths
    allPaths: {
      total: await Path.countDocuments().lean(),
      finished: await Path.countDocuments({ status: 'finished' }).lean(), // TODO add index
      disabled: await Path.countDocuments({ status: 'disabled' }).lean(), // TODO add index
      active: await Path.countDocuments({ status: 'active' }).lean(), // TODO add index
    },
    createdAt: this.createdAt,
    timeRunning: lastResource
      ? (lastResource!.updatedAt.getTime() - this.createdAt.getTime()) / 1000
      : null,
    params: this.params,
    notification: this.notification,
    status: this.status,
    seeds: this.seeds,
  };
});

// TODO configurable number of simultaneous processes
schema.static('startNext', async function () {
  const runningProcs = await this.countDocuments({ status: 'running' });
  if (!runningProcs) {
    const process = await this.findOneAndUpdate(
      { status: 'queued' },
      { $set: { status: 'running' } },
      { new: true }
    );
    if (process) {
      await Resource.insertSeeds(process.seeds, process.pid);
      return true;
    }
  }
  return false;
});

schema.static('getOneRunning', async function (skip = 0) {
  const x = await this.findOne({ status: 'running' })
    .sort({ createdAt: -1 })
    .skip(skip);
  return x;
});

export const Process = model<IProcess, ProcessModel>('Process', schema);
