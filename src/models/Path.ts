import { HydratedDocument, Model, model, Schema, Types } from 'mongoose';
import { urlType } from '@derzis/common';
import config from '@derzis/config';
import { Resource, Domain } from '@derzis/models';

export interface PathSkeleton {
  seed: { url: string };
  head: { url: string };
  predicates: { elems: string[] };
  nodes: { elems: string[] };
  parentPath: IPath;
<<<<<<< Updated upstream
=======
  processId: string;
>>>>>>> Stashed changes
}

export interface IPath {
  seed: {
    url: string;
  };
  predicates: {
    elems: string[];
    count: number;
  };
  lastPredicate: string;
  nodes: {
    elems: string[];
    count: number;
  };
  head: {
    url: string;
    domain: string;
    needsCrawling: boolean;
  };
  parentPath: Types.ObjectId;
<<<<<<< Updated upstream
=======
  processId: string;
>>>>>>> Stashed changes
  status:
  | 'active'
  | 'disabled' // a better alternative path was found
  | 'finished'; // path reached limits
}

export interface IPathMethods {
  markDisabled(): Promise<void>;
  markFinished(): Promise<void>;
}

export type PathDocument = HydratedDocument<IPath, IPathMethods>;
export interface PathModel extends Model<IPath, {}, IPathMethods> { }

const schema = new Schema<IPath, {}, IPathMethods>(
  {
    seed: {
      url: { ...urlType, required: true },
    },
    predicates: {
      elems: [urlType],
      count: Number,
    },
    lastPredicate: urlType,
    nodes: {
      elems: [urlType],
      count: Number,
    },
    head: {
      url: { ...urlType, required: true },
      domain: urlType,
      needsCrawling: {
        type: Boolean,
        default: true,
      },
    },
    parentPath: {
      type: Schema.Types.ObjectId,
      ref: 'Path',
    },
    status: {
      type: String,
      enum: ['active', 'disabled', 'finished'],
      default: 'active',
    },
  },
  { timestamps: true }
);

schema.index({
  'seed.url': 1,
  'head.url': 1,
  'predicates.count': 1,
});

schema.index({
  'head.url': 1,
  'nodes.count': 1,
});

schema.pre('save', async function() {
  this.nodes.count = this.nodes.elems.length;
  this.predicates.count = this.predicates.elems.length;
  if (this.predicates.count) {
    this.lastPredicate = this.predicates.elems[this.predicates.count - 1];
  }
  const head = await Resource.findOne({ url: this.head.url });
  const origin = new URL(this.head.url).origin;
  const domain = await Domain.findOne({ origin }).select('status').lean();
  this.head.domain = origin;
  this.head.needsCrawling =
    !domain || (head?.status === 'unvisited' && domain.status !== 'error');
  if (head?.status === 'error' || domain?.status === 'error') {
    this.status = 'disabled';
    await Resource.rmPath(this);
    return;
  }
  if (this.nodes.count >= config.graph.maxPathLength) {
    this.status = 'finished';
    await Resource.rmPath(this);
    return;
  }
  this.status = 'active';
});

schema.method('markDisabled', async function() {
  this.status = 'disabled';
  await this.save();
  await Resource.rmPath(this);
  return;
});

schema.method('markFinished', async function() {
  this.status = 'finished';
  await this.save();
  await Resource.rmPath(this);
  return;
});

//schema.post('save', async function(doc){
//  const resUpdate = doc.status === 'active' ?
//    {'$addToSet': {paths: doc._id}} :
//    {'$pull': {paths: doc._id}};
//
//  const domUpdate = doc.status === 'active' ?
//    {'$inc': {'crawl.pathHeads':  1}} :
//    {'$inc': {'crawl.pathHeads': -1}};
//
//  const Resource = require('./Resource');
//  await Resource.updateOne({url: doc.head.url}, resUpdate);
//  const r = await Resource.findOne({url: doc.head.url});
//  r.headCount = r.paths?.length || 0;
//  await r.save();
//
//  await require('./Domain').updateOne({origin: new URL(doc.head.url).origin}, domUpdate);
//});

export const Path = model<IPath, PathModel>('Path', schema);
