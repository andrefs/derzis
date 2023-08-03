import { HydratedDocument, Model, model, Schema, Types } from 'mongoose';
import { urlType } from '@derzis/common';
import config from '@derzis/config';
import {
  Resource,
  Domain,
  SimpleTriple,
  ITriple,
  Triple,
} from '@derzis/models';

export interface PathSkeleton {
  seed: { url: string };
  head: { url: string };
  predicates: { elems: string[] };
  nodes: { elems: string[] };
  outOfBounds: {
    links: {
      predicate: string;
      node: string;
    }[];
  };
  processId: string;
}

export interface IPath {
  processId: string;
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
  outOfBounds: {
    count: number;
    links: [
      {
        predicate: string;
        node: string;
      }
    ];
  };
  head: {
    url: string;
    domain: string;
    needsCrawling: boolean;
  };
  status:
    | 'active'
    | 'disabled' // a better alternative path was found
    | 'finished'; // path reached limits
  status2: {
    type: 'ready' | 'processing';
    required: true;
    default: 'ready';
  };
}

export interface IPathMethods {
  markDisabled(): Promise<void>;
  markFinished(): Promise<void>;
  shouldCreateNewPath(triple: SimpleTriple): boolean;
  tripleIsOutOfBounds(triple: SimpleTriple): boolean;
  extendWithExistingTriples(): Promise<{
    newPaths: PathDocument[];
    procTriples: string[];
  }>;
  extend(
    triples: HydratedDocument<ITriple>[]
  ): Promise<{ newPaths: PathDocument[]; procTriples: string[] }>;
}

export type PathDocument = HydratedDocument<IPath, IPathMethods>;
export interface PathModel extends Model<IPath, {}, IPathMethods> {}

const schema = new Schema<IPath, {}, IPathMethods>(
  {
    processId: {
      type: String,
      required: true,
    },
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
    outOfBounds: {
      count: {
        type: Number,
        default: 0,
      },
      links: [
        {
          predicate: String,
          node: String,
        },
      ],
    },
    head: {
      url: { ...urlType, required: true },
      domain: urlType,
      needsCrawling: {
        type: Boolean,
        default: true,
      },
    },
    status: {
      type: String,
      enum: ['active', 'disabled', 'finished'],
      default: 'active',
    },
    status2: {
      type: String,
      enum: ['ready', 'processing'],
      required: true,
      default: 'ready',
    },
  },
  { timestamps: true }
);

schema.index({ processId: 1 });

schema.index({
  'seed.url': 1,
  'head.url': 1,
  'predicates.count': 1,
});

schema.index({
  'head.url': 1,
  'nodes.count': 1,
});

schema.pre('save', async function () {
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

schema.method('markDisabled', async function () {
  this.status = 'disabled';
  await this.save();
  await Resource.rmPath(this);
  return;
});

schema.method('markFinished', async function () {
  this.status = 'finished';
  await this.save();
  await Resource.rmPath(this);
  return;
});

schema.method('shouldCreateNewPath', function (t: ITriple) {
  // triple is reflexive
  if (t.subject === t.object) {
    return false;
  }

  // head appears in triple predicate
  if (t.predicate === this.head.url) {
    return false;
  }

  const newHeadUrl: string = t.subject === this.head.url ? t.object : t.subject;

  // new head already contained in path
  if (this.nodes.elems.includes(newHeadUrl)) {
    return false;
  }
  return true;
});

schema.method('tripleIsOutOfBounds', function (t: ITriple) {
  const pathPreds: Set<string> = new Set(this.predicates.elems);
  return (
    this.nodes.count >= this.params.maxPathLength ||
    (!pathPreds.has(t.predicate) &&
      this.predicates.count >= this.params.maxPredicates)
  );
});

schema.method('copy', function () {
  const copy: PathSkeleton = {
    processId: this.processId,
    seed: this.seed,
    head: this.head,
    outOfBounds: this.outOfBounds,
    predicates: { elems: [...this.predicates.elems] },
    nodes: { elems: [...this.nodes.elems] },
  };
  return copy;
});

schema.method('extendWithExistingTriples', async function () {
  let triples: HydratedDocument<ITriple>[] = await Triple.find({
    nodes: this.head.url,
  });
  return this.extend(triples);
});

schema.method('extend', async function (triples: HydratedDocument<ITriple>[]) {
  let newPaths: { [prop: string]: { [newHead: string]: PathSkeleton } } = {};
  let procTriples: Types.ObjectId[] = [];

  for (const t of triples.filter(this.shouldCreateNewPath)) {
    const newHeadUrl: string =
      t.subject === this.head.url ? t.object : t.subject;
    const prop = t.predicate;

    newPaths[prop] = newPaths[prop] || {};
    // avoid extending the same path twice with the same triple
    if (!newPaths[prop][newHeadUrl]) {
      const np = this.copy();

      if (this.tripleIsOutOfBounds(t)) {
        np.outOfBounds.push({ predicate: prop, node: newHeadUrl });
      } else {
        procTriples.push(t._id);
        np.predicates.elems = Array.from(
          new Set([...this.predicates.elems, prop])
        );
        np.nodes.elems.push(newHeadUrl);
      }
    }
  }
  const nps: PathSkeleton[] = [];
  Object.values(newPaths).forEach((x) =>
    Object.values(x).forEach((y) => nps.push(y))
  );

  return { newPaths: nps, procTriples };
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
