import { HydratedDocument, Model, model, Schema, Types } from 'mongoose';
import { urlType, WorkerError } from '@derzis/common';
import { Domain } from '@derzis/models';
import { Path } from '@derzis/models';
import { BulkWriteResult } from 'mongodb';
import { IPath, IPathMethods } from './Path';
import { ITriple, SimpleTriple } from './Triple';
import { IDomain } from './Domain';
import { CrawlResourceResultDetails } from '@derzis/worker';

export interface IResource {
  url: string;
  domain: string;
  isSeed: boolean;
  status: 'unvisited' | 'done' | 'crawling' | 'error';
  triples: Types.DocumentArray<ITriple>;
  paths: Types.DocumentArray<IPath>;
  minPathLength: number;
  headCount: number;
  jobId: number;
  crawlId: {
    domainTs: Date;
    counter: number;
  };
  updatedAt: Date;
}

interface ResourceModel extends Model<IResource, {}> {
  addMany: (
    resources: { url: string; domain: string }[]
  ) => Promise<IResource[]>;
  addFromTriples: (triples: SimpleTriple[]) => Promise<IResource[]>;
  markAsCrawled: (
    url: string,
    details: CrawlResourceResultDetails,
    error?: WorkerError
  ) => Promise<{ path: IPath; domain: IDomain }>;
  insertSeeds: (urls: string[], pid: string) => Promise<IResource>;
  addPaths: (
    paths: HydratedDocument<IPath, IPathMethods>[]
  ) => Promise<BulkWriteResult>;
  rmPath: (path: IPath) => Promise<void>;
  getUnvisited: (
    domain: string,
    exclude: string[],
    limit: number
  ) => Promise<IResource[]>;
}

const schema = new Schema<IResource, ResourceModel>(
  {
    url: { ...urlType, index: true, unique: true },
    domain: { ...urlType, required: true },
    isSeed: {
      type: Boolean,
      required: true,
      default: false,
    },
    status: {
      type: String,
      enum: ['unvisited', 'done', 'crawling', 'error'],
      default: 'unvisited',
    },
    triples: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Triple',
      },
    ],
    paths: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Path',
      },
    ],
    minPathLength: Number,
    headCount: {
      type: Number,
      default: 0,
    },
    jobId: Number,
    crawlId: {
      domainTs: Schema.Types.Date,
      counter: Number,
    },
  },
  { timestamps: true }
);

schema.index({
  url: 1,
  status: 1,
});

schema.index({
  domain: 1,
  status: 1,
  minPathLength: 1,
  headCount: 1,
});

schema.static('addMany', async function addMany(resources) {
  let insertedDocs: IResource[] = [];
  let existingDocs: IResource[] = [];
  await this.insertMany(resources, { ordered: false })
    .then((docs) => (insertedDocs = docs.map((d) => d.toObject())))
    .catch((err) => {
      for (const e of err.writeErrors) {
        if (e.err.code && e.err.code === 11000) {
          existingDocs.push(resources[e.err.index]);
        }
        // TO DO handle other errors
      }
      insertedDocs = err.insertedDocs;
    });

  return insertedDocs;
});

schema.static(
  'addFromTriples',
  async function addFromTriples(triples: SimpleTriple[]) {
    const resources: { [pos: string]: boolean } = {};
    for (const t of triples) {
      resources[t.subject] = true;
      resources[t.object] = true;
    }

    return await this.addMany(
      Object.keys(resources).map((u) => ({
        url: u,
        domain: new URL(u).origin,
      }))
    );
  }
);

schema.static(
  'markAsCrawled',
  async function markAsCrawled(url, details, error) {
    // Resource
    const oldRes = await this.findOneAndUpdate(
      { url, status: 'crawling' },
      {
        status: error ? 'error' : 'done',
        paths: [],
        headCount: 0,
        crawlId: details.crawlId,
      },
      { returnDocument: 'before' }
    );

    // Paths
    const paths = await Path.updateMany(
      { 'head.url': url },
      {
        status: 'disabled',
        'head.needsCrawling': false,
      }
    );

    // Domain
    const baseFilter = { origin: new URL(url).origin };

    if (oldRes) {
      let updateInc = error ? { 'crawl.failed': 1 } : { 'crawl.success': 1 };
      const update = {
        $inc: {
          ...updateInc,
          'crawl.queued': -1,
          'crawl.ongoing': -1,
          'crawl.pathHeads': -oldRes.headCount,
        },
      };

      await Domain.findOneAndUpdate(baseFilter, update);
    }

    let d = await Domain.findOne(baseFilter)!;

    const nextAllowed = new Date(details.ts + d!.crawl.delay * 1000);
    const filter = {
      ...baseFilter,
      'crawl.nextAllowed': {
        $lt: nextAllowed,
      },
    };
    d = await Domain.findOneAndUpdate(filter, {
      'crawl.nextAllowed': nextAllowed,
    });

    return {
      paths,
      domain: d,
    };
  }
);

schema.static(
  'insertSeeds',
  async function insertSeeds(urls: string[], pid: string) {
    const upserts = urls.map((u: string) => ({
      updateOne: {
        filter: { url: u },
        update: {
          $set: { isSeed: true },
          $setOnInsert: {
            url: u,
            domain: new URL(u).origin,
          },
        },
        upsert: true,
        setDefaultsOnInsert: true,
      },
    }));

    const res = await this.bulkWrite(upserts);
    await Domain.upsertMany(urls.map((u: string) => new URL(u).origin));

    const paths = urls.map((u: string) => ({
      processId: pid,
      seed: { url: u },
      head: { url: u },
      nodes: { elems: [u] },
      predicates: { elems: [] },
      status: 'active',
      status2: 'processing',
    }));

    const insPaths = await Path.create(paths);
    return this.addPaths(insPaths);
  }
);

schema.static('addPaths', async function addPaths(paths) {
  const res = await this.bulkWrite(
    paths.map((p: HydratedDocument<IPath>) => ({
      updateOne: {
        filter: { url: p.head.url },
        update: {
          $addToSet: { paths: p._id },
          $inc: { headCount: 1 },
          $min: {
            minPathLength: p.nodes.count,
          },
        },
      },
    }))
  );
  const dom = await Domain.bulkWrite(
    paths.map((p: HydratedDocument<IPath>) => ({
      updateOne: {
        filter: { origin: p.head.domain },
        update: { $inc: { 'crawl.pathHeads': 1 } },
      },
    }))
  );
  return { res, dom };
});

schema.static('rmPath', async function rmPath(path) {
  const res = await this.updateOne(
    { url: path.head.url, paths: new Types.ObjectId(path._id) },
    {
      $pull: { paths: new Types.ObjectId(path._id) },
      $inc: { headCount: -1 },
    }
  );
  if (res.acknowledged && res.modifiedCount) {
    await Domain.updateOne(
      { origin: path.head.domain },
      { $inc: { 'crawl.headCount': -1 } }
    );
  }
});

schema.static(
  'getUnvisited',
  async function getUnvisited(domain: string, exclude: string[], limit) {
    return await Resource.find({
      origin: domain,
      status: 'unvisited',
      url: { $nin: exclude },
    })
      .limit(limit - exclude.length)
      .select('url')
      .lean();
  }
);

export const Resource = model<IResource, ResourceModel>('Resource', schema);
