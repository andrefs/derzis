import { HydratedDocument, Model, model, Schema, Types } from 'mongoose';
import { urlType } from '@derzis/common';
import config from '@derzis/config';
import {
  Resource,
  Domain,
  SimpleTriple,
  ITriple,
  Triple,
  Process,
  IProcessDocument,
  ProcessTriple,
} from '@derzis/models';

export interface PathSkeleton {
  seed: { url: string };
  head: { url: string };
  predicates: { elems: string[] };
  nodes: { elems: string[] };
  outOfBounds?: Schema.Types.ObjectId;
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
  outOfBounds?: Schema.Types.ObjectId;
  head: {
    url: string;
    domain: string;
  };
}

export interface IPathMethods {
  markDisabled(): Promise<void>;
  markFinished(): Promise<void>;
  shouldCreateNewPath(triple: SimpleTriple): boolean;
  tripleIsOutOfBounds(triple: SimpleTriple, process: IProcessDocument): boolean;
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
      type: Schema.Types.ObjectId,
      ref: 'Triple',
    },
    head: {
      url: { ...urlType, required: true },
      domain: urlType,
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

schema.pre<IPath>('save', async function () {
  this.nodes.count = this.nodes.elems.length;
  this.predicates.count = this.predicates.elems.length;
  if (this.predicates.count) {
    this.lastPredicate = this.predicates.elems[this.predicates.count - 1];
  }
  const origin = new URL(this.head.url).origin;
  this.head.domain = origin;
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
  console.log('XXXXXXXXXXXXXX shouldCreateNewPath', { t, _this: this });
  // triple is reflexive
  if (t.subject === t.object) {
    return false;
  }

  // head appears in triple predicate
  if (t.predicate === this.head.url) {
    return false;
  }

  const newHeadUrl: string = t.subject === this.head.url ? t.object : t.subject;

  // path already has outOfBounds triple
  if (!!this.outOfBounds) {
    return false;
  }

  // new head already contained in path
  if (this.nodes.elems.includes(newHeadUrl)) {
    return false;
  }

  return true;
});

schema.method(
  'tripleIsOutOfBounds',
  function (t: ITriple, process: IProcessDocument) {
    const pathPreds: Set<string> = new Set(this.predicates.elems);
    return (
      this.nodes.count >= process.params.maxPathLength ||
      (!pathPreds.has(t.predicate) &&
        this.predicates.count >= process.params.maxPathProps)
    );
  }
);

schema.method('copy', function () {
  const copy: PathSkeleton = {
    processId: this.processId,
    seed: this.seed,
    head: this.head,
    predicates: { elems: [...this.predicates.elems] },
    nodes: { elems: [...this.nodes.elems] },
  };
  return copy;
});

schema.method('extendWithExistingTriples', async function () {
  // if path has outOfBounds triple, try to extend with that
  if (!!this.outOfBounds) {
    const t = await Triple.findById(this.outOfBounds);
    const process = await Process.findOne({ pid: this.processId });
    if (
      !this.tripleIsOutOfBounds(t, process) &&
      process?.whiteBlackListsAllow(t!)
    ) {
      const newHeadUrl: string =
        t!.subject === this.head.url ? t!.object : t!.subject;
      const prop = t!.predicate;

      const np = this.copy();
      np.head.url = newHeadUrl;
      np.predicates.elems = Array.from(
        new Set([...this.predicates.elems, prop])
      );
      np.nodes.elems.push(newHeadUrl);

      await ProcessTriple.create({
        pid: this.processId,
        triple: t,
      });
      await Path.create(np);
      await Path.deleteOne({ _id: this._id });

      return np.extendWithExistingTriples();
    }
  }
  // find triples which include the head but dont belong to the path yet
  let triples: HydratedDocument<ITriple>[] = await Triple.find({
    nodes: { $eq: this.head.url, $nin: this.nodes.elems },
  });
  return this.extend(triples);
});

schema.method('extend', async function (triples: HydratedDocument<ITriple>[]) {
  console.log('XXXXXXXXXXXX path.extend 0', { head: this.head, triples });
  let newPaths: { [prop: string]: { [newHead: string]: PathSkeleton } } = {};
  let procTriples: Types.ObjectId[] = [];
  const process = await Process.findOne({ pid: this.processId });
  console.log('XXXXXXXXXXXX path.extend 0.1', { process });

  for (const t of triples.filter(
    (t) => this.shouldCreateNewPath(t) && process?.whiteBlackListsAllow(t)
  )) {
    console.log('XXXXXXXXXXXX path.extend 1', { t });
    const newHeadUrl: string =
      t.subject === this.head.url ? t.object : t.subject;
    const prop = t.predicate;
    console.log('XXXXXXXXXXXX path.extend 2', { newHeadUrl, prop });

    newPaths[prop] = newPaths[prop] || {};
    // avoid extending the same path twice with the same triple
    if (!newPaths[prop][newHeadUrl]) {
      const np = this.copy();
      np.head.url = newHeadUrl;
      console.log('XXXXXXXXXXXX path.extend 3', { np });

      if (this.tripleIsOutOfBounds(t, process)) {
        console.log('XXXXXXXXXXXX path.extend 4');
        np.outOfBounds = t._id;
      } else {
        console.log('XXXXXXXXXXXX path.extend 5');
        procTriples.push(t._id);
        np.predicates.elems = Array.from(
          new Set([...this.predicates.elems, prop])
        );
        np.nodes.elems.push(newHeadUrl);
      }
      console.log('XXXXXXXXXXXX path.extend 6', { np });
      newPaths[prop][newHeadUrl] = np;
    }
  }
  console.log('XXXXXXXXXXXX path.extend 7', { newPaths, procTriples });
  const nps: PathSkeleton[] = [];
  Object.values(newPaths).forEach((x) =>
    Object.values(x).forEach((y) => nps.push(y))
  );
  console.log('XXXXXXXXXXXX path.extend 8', { newPaths, nps, procTriples });

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
