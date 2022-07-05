import { HydratedDocument, Model, model, Schema, Types } from 'mongoose';
import {urlType, WorkerError} from '@derzis/common';
import {Domain} from '@derzis/models';
import {Path} from '@derzis/models'
import { BulkWriteResult } from 'mongodb';
import { IPath, IPathMethods } from './Path';
import { ITriple, SimpleTriple } from './Triple';
import { IDomain } from './Domain';
import { CrawlResourceResultDetails } from '@derzis/worker';

export interface IResource {
  url: string,
  domain: string,
  isSeed: boolean,
  status: 'unvisited' | 'done' | 'crawling' | 'error',
  triples: Types.DocumentArray<ITriple>,
  paths: Types.DocumentArray<IPath>,
  minPathLength: number,
  headCount: number,
  jobId: number,
  crawlId: {
    domainTs: Date,
    counter: number
  },
  processIds: Types.Array<string>
};

interface ResourceModel extends Model<IResource, {}> {
  addMany: (resources: {url:string, domain:string}[], pids: string[]) => Promise<IResource[]>,
  addFromTriples: (source: IResource, triples: SimpleTriple[]) => Promise<IResource[]>,
  markAsCrawled: (url: string, details: CrawlResourceResultDetails, error?: WorkerError) => Promise<{path: IPath, domain: IDomain}>,
  insertSeeds: (urls: string[], pid: string) => Promise<IResource>,
  addPaths: (paths: HydratedDocument<IPath, IPathMethods>[]) => Promise<BulkWriteResult>,
  rmPath: (path: IPath) => Promise<void>,
}


const schema = new Schema<IResource, ResourceModel>({
  url: {...urlType, index: true, unique: true},
  domain: {...urlType, required: true},
  isSeed: {
    type: Boolean,
    required: true,
    default: false
  },
  status: {
    type: String,
    enum: ['unvisited', 'done', 'crawling', 'error'],
    default: 'unvisited'
  },
  triples: [{
    type: Schema.Types.ObjectId,
    ref: 'Triple'
  }],
  paths: [{
    type: Schema.Types.ObjectId,
    ref: 'Path'
  }],
  minPathLength: Number,
  headCount: {
    type: Number,
    default: 0
  },
  jobId: Number,
  crawlId: {
    domainTs: Schema.Types.Date,
    counter: Number
  },
  processIds: [String]
}, {timestamps: true});

schema.virtual('process', {
  ref: 'Process',
  localField: 'processIds',
  foreignField: 'pid',
  justOne: false
});

schema.index({
  domain: 1,
  status: 1,
  minPathLength: 1,
  headCount: 1
});

schema.index({
  processIds: 1
});

schema.static('addMany', async function addMany(resources, pids){
  let insertedDocs: IResource[] = [];
  let existingDocs: IResource[] = [];
  await this.insertMany(resources.map((r: IResource) => ({...r, processIds: pids})), {ordered: false})
    .then(docs => insertedDocs = docs)
    .catch(err => {
      for(const e of err.writeErrors){
        if(e.err.code && e.err.code === 11000){
          existingDocs.push(resources[e.err.index]);
        }
        // TO DO handle other errors
      }
      insertedDocs = err.insertedDocs;
    });

  if(existingDocs.length){
    await this.updateMany(
      {url: {$in: existingDocs.map(d => d.url)}},
      {$addToSet: {processIds: {$each: pids}}}
    );
  }
  if(insertedDocs.length){
    await Domain.upsertMany(resources.map((r: IResource) => r.domain), pids);
  }
  return insertedDocs;
});

schema.static('addFromTriples', async function addFromTriples(source: IResource, triples: SimpleTriple[]){
  const resources: {[pos: string]: boolean} = {};
  for (const t of triples){
    resources[t.subject] = true;
    resources[t.object] = true;
  }

  return await this.addMany(Object.keys(resources).map(u => ({
    url: u,
    domain: new URL(u).origin,
  })), source.processIds);
});


schema.static('markAsCrawled', async function markAsCrawled(url, details, error){
  // Resource
  const oldRes = await this.findOneAndUpdate({url, status: 'crawling'}, {
    status: error? 'error' :'done',
    paths: [],
    headCount: 0,
    crawlId: details.crawlId
  });


  // Paths
  const path = await Path.updateMany({'head.url': url}, {
    'head.alreadyCrawled': true
  });

  // Domain
  const baseFilter = {origin: new URL(url).origin};
  let d = await Domain.findOne(baseFilter)!;

  if(oldRes){
    let updateInc = error ? 
      { 'crawl.failed':  1 }:
      { 'crawl.success': 1 };
    const update = {
      '$inc': {
        ...updateInc,
        'crawl.queued': -1,
        'crawl.ongoing': -1,
        'crawl.pathHeads': -oldRes.headCount
      }
    };

    await d!.updateOne(update);
  }

  const nextAllowed = new Date(details.ts + d!.crawl.delay*1000);
  const filter = {
    ...baseFilter,
    'crawl.nextAllowed': {
      '$lt': nextAllowed
    }
  };
  d = await Domain.findOneAndUpdate(filter,{'crawl.nextAllowed': nextAllowed});

  return {
    path,
    domain: d
  };
});


schema.static('insertSeeds', async function insertSeeds(urls, pid){
  const upserts = urls.map((u: string) => ({
    updateOne: {
      filter: {url: u},
      update:{
        $set:{isSeed: true},
        $setOnInsert: {
          url: u,
          domain: new URL(u).origin,
        },
        $addToSet: {processIds: pid}
      },
      upsert: true,
      setDefaultsOnInsert: true
    }
  }));

  const res = await this.bulkWrite(upserts);
  await Domain.upsertMany(urls.map((u:string) => new URL(u).origin), pid);

  const paths: IPath[] = urls.map((u: string) => ({
    seed: {url: u},
    head: {url: u},
    nodes: {elems: [u]},
    predicates: {elems: []},
    status: 'active'
  }));

  const insPaths = await Path.create(paths);
  return this.addPaths(insPaths);
});


schema.static('addPaths', async function addPaths(paths){
  const res = await this.bulkWrite(paths.map((p: HydratedDocument<IPath>) => ({
    updateOne: {
      filter: {url: p.head.url},
      update: {
        '$addToSet': {paths: p._id},
        '$inc': {headCount: 1},
        '$min': {
          minPathLength: p.nodes.count
        }
      }
    }
  })));
  const dom = await Domain.bulkWrite(paths.map((p: HydratedDocument<IPath>) => ({
    updateOne: {
      filter: {origin: p.head.domain},
      update: {'$inc': {'crawl.pathHeads': 1}}
    }
  })));
  return {res,dom};
});

schema.static('rmPath', async function rmPath(path){
  const res = await this.updateOne({url: path.head.url, paths: new Types.ObjectId(path._id)}, {
    '$pull': {paths: new Types.ObjectId(path._id)},
    '$inc': {headCount: -1}
  });
  if(res.acknowledged && res.modifiedCount){
    await Domain.updateOne({origin: path.head.domain}, {'$inc': {'crawl.headCount': -1}});
  }
});

export const Resource = model<IResource, ResourceModel>('Resource', schema);
