import { Types, Document } from 'mongoose';
import { prop, index, pre, getModelForClass, PropType } from '@typegoose/typegoose';
import { TripleClass, Triple, type TripleDocument } from '../Triple';
import { ProcessClass } from '../Process';
import { Domain } from '../Domain';
import { PathClass, type PathSkeleton, ResourceCount } from './Path';
import { createLogger } from '@derzis/common/server';
const log = createLogger('TraversalPath');

export type TraversalPathSkeleton = Pick<
  TraversalPathClass,
  'processId' | 'seed' | 'head' | 'type' | 'status'
> &
  RecursivePartial<TraversalPathClass> & {
    predicates: Pick<ResourceCount, 'elems'>;
    nodes: Pick<ResourceCount, 'elems'>;
    triples?: Types.ObjectId[];
  };

type RecursivePartial<T> = {
  [P in keyof T]?: T[P] extends object ? RecursivePartial<T[P]> : T[P];
};

@pre<TraversalPathClass>('save', async function () {
  this.type = 'traversal';
  this.nodes.count = this.nodes.elems.length;
  this.predicates.count = this.predicates.elems.length;
  if (this.predicates.count) {
    this.lastPredicate = this.predicates.elems[this.predicates.count - 1];
  }

  const origin = new URL(this.head.url).origin;
  const d = await Domain.findOne({ origin });
  if (d) {
    this.head.domain = {
      origin: d.origin,
      status: d.status
    };
  }
})
@index({ processId: 1 })
@index({ type: 1 })
@index({
  'seed.url': 1,
  'head.url': 1,
  'predicates.count': 1
})
@index({
  'head.url': 1,
  'nodes.count': 1
})
@index({ status: 1 })
@index({ 'head.url': 1, status: 1 })
@index({ 'head.status': 1, status: 1 })
@index({ 'head.domain.status': 1, status: 1 })
@index({ processId: 1, 'head.url': 1 })
@index({
  processId: 1,
  status: 1,
  'head.domain.status': 1,
  'nodes.count': 1,
  'predicates.count': 1
})
class TraversalPathClass extends PathClass {
  @prop({ validate: (value: string) => !!value, type: String })
  public lastPredicate?: string;

  @prop({ type: ResourceCount })
  public predicates!: ResourceCount;

  @prop({ type: ResourceCount })
  public nodes!: ResourceCount;

  @prop({ required: true, ref: 'Triple', type: [Types.ObjectId], default: [] }, PropType.ARRAY)
  public triples!: Types.ObjectId[];

  public copy(this: TraversalPathClass): TraversalPathSkeleton {
    const copy = {
      processId: this.processId,
      type: this.type,
      seed: {
        url: this.seed.url
      },
      head: {
        url: this.head.url,
        status: this.head.status,
        domain: { origin: this.head.domain.origin, status: this.head.domain.status }
      },
      predicates: { elems: [...this.predicates.elems] },
      nodes: { elems: [...this.nodes.elems] },
      status: this.status
    };
    return copy;
  }

  public async genExtended(
    triples: TripleClass[],
    process: ProcessClass
  ): Promise<{ extendedPaths: PathSkeleton[]; procTriples: Types.ObjectId[] }> {
    let extendedPaths: { [prop: string]: { [newHead: string]: TraversalPathSkeleton } } = {};
    let procTriples: Types.ObjectId[] = [];
    const predsDirMetrics = process.curPredsDirMetrics();
    const followDirection = process!.currentStep.followDirection;

    for (const t of triples.filter(
      (t) =>
        this.shouldCreateNewPath(t) &&
        process?.whiteBlackListsAllow(t) &&
        t.directionOk(this.head.url, followDirection, predsDirMetrics)
    )) {
      log.silly('Extending path with triple', t);
      const newHeadUrl: string = t.subject === this.head.url ? t.object : t.subject;
      const prop = t.predicate;

      extendedPaths[prop] = extendedPaths[prop] || {};
      if (!extendedPaths[prop][newHeadUrl] && !this.tripleIsOutOfBounds(t, process!)) {
        const ep = this.copy();
        ep.head.url = newHeadUrl;
        ep.head.status = 'unvisited';
        ep.triples = [...this.triples, t._id];
        ep.predicates.elems = Array.from(new Set([...this.predicates.elems, prop]));
        ep.nodes.elems.push(newHeadUrl);
        ep.status = 'active';

        procTriples.push(t._id);
        log.silly('New path', ep);
        extendedPaths[prop][newHeadUrl] = ep;
      }
    }
    const eps: TraversalPathSkeleton[] = [];
    Object.values(extendedPaths).forEach((x) => Object.values(x).forEach((y) => eps.push(y)));

    log.silly('Extended paths', eps);
    return { extendedPaths: eps, procTriples };
  }

  public shouldCreateNewPath(this: TraversalPathClass, t: TripleClass): boolean {
    if (t.subject === t.object) {
      return false;
    }

    if (t.predicate === this.head.url) {
      return false;
    }

    const newHeadUrl: string = t.subject === this.head.url ? t.object : t.subject;

    if (this.nodes.elems.includes(newHeadUrl)) {
      return false;
    }

    return true;
  }

  public tripleIsOutOfBounds(t: TripleClass, process: ProcessClass): boolean {
    const pathPreds: Set<string> = new Set(this.predicates.elems);
    return (
      this.nodes.count >= process.currentStep.maxPathLength ||
      (!pathPreds.has(t.predicate) && this.predicates.count >= process.currentStep.maxPathProps)
    );
  }

  genMaxPathPropsFilter(process: ProcessClass) {
    const allowed = new Set<string>();
    if (process.currentStep.predLimit.limType === 'whitelist') {
      for (const p of this.predicates.elems) {
        if (process.currentStep.predLimit.limPredicates.includes(p)) {
          allowed.add(p);
        }
      }
    } else {
      for (const p of this.predicates.elems) {
        if (!process.currentStep.predLimit.limPredicates.includes(p)) {
          allowed.add(p);
        }
      }
    }
    return allowed
  }

  public genExistingTriplesFilter(process: ProcessClass) {
    let allowed: Set<string> = new Set();
    let notAllowed: Set<string> = new Set();

    /**** WHITE/BLACKLIST FILTER ****/
    if (this.predicates.count >= process.currentStep.maxPathProps) {
      allowed = this.genMaxPathPropsFilter(process);
    } else {
      if (process.currentStep.predLimit.limType === 'whitelist') {
        allowed = new Set(process.currentStep.predLimit.limPredicates);
      } else {
        notAllowed = new Set(process.currentStep.predLimit.limPredicates);
      }
    }
    let predFilter;
    if (allowed.size) {
      predFilter = allowed.size === 1
        ? { predicate: Array.from(allowed)[0] }
        : { predicate: { $in: Array.from(allowed) } };
    } else if (notAllowed.size) {
      predFilter = notAllowed.size === 1
        ? { predicate: { $ne: Array.from(notAllowed)[0] } }
        : { predicate: { $nin: Array.from(notAllowed) } };
    } else {
      predFilter = {};
    }

    /**** DIRECTION FILTER ****/
    // this includes the white/blacklist filter for predicates
    const followDirection = process!.currentStep.followDirection;
    const predsDirMetrics = process!.curPredsDirMetrics();
    let directionFilter = {};

    if (followDirection && predsDirMetrics && predsDirMetrics.size) {
      const subjPreds: Set<string> = new Set(); // preds that have more subjs than objs (BF ratio > 1)
      const objPreds: Set<string> = new Set(); // preds that have more objs than subjs (BF ratio < 1)

      // we use the BF ratio to determine the direction of the predicate,
      // and the direction we want to follow
      for (const [pred, { bf }] of predsDirMetrics) {
        if (allowed.size && !allowed.has(pred)) {
          continue;
        }
        if (notAllowed.size && notAllowed.has(pred)) {
          continue;
        }
        const bfRatio = bf.subj / bf.obj;
        if (bfRatio >= 1) {
          subjPreds.add(pred);
        } else {
          objPreds.add(pred);
        }
      }

      console.log('XXXXXXXXXXXXX1', {
        subjPreds: subjPreds.size,
        objPreds: objPreds.size,
        allowed: allowed.size,
        notAllowed: notAllowed.size,
        predElems: this.predicates.elems,
        limType: process.currentStep.predLimit.limType,
        limPredicates: process.currentStep.predLimit.limPredicates,
        predsCount: this.predicates.count,
        maxPathProps: process.currentStep.maxPathProps
      });

      let or = [];
      if (subjPreds.size && objPreds.size && !allowed.size) {
        const list = [...subjPreds, ...objPreds, ...Array.from(notAllowed)];
        or.push({ predicate: list.length === 1 ? { $ne: list[0] } : { $nin: list } });
      }
      if (subjPreds.size) {
        const list = Array.from(subjPreds);
        or.push({ predicate: list.length === 1 ? list[0] : { $in: list }, subject: this.head.url });
      }
      if (objPreds.size) {
        const list = Array.from(objPreds);
        or.push({ predicate: list.length === 1 ? list[0] : { $in: list }, object: this.head.url });
      }

      // if or has only one filter, we can use it directly 
      directionFilter = or.length > 1
        ? { $or: or }
        : or.length === 1
          ? or[0]
          : {};
    }

    const baseFilter = {
      nodes: this.head.url,
      _id: { $nin: this.triples }
    };

    // direction filter already includes the white/blacklist filter for predicates,
    // so we only need predFilter if we don't have a direction filter
    return directionFilter && Object.keys(directionFilter).length
      ? { ...baseFilter, ...directionFilter }
      : { ...baseFilter, ...predFilter };
  }

  public async extendWithExistingTriples(
    process: ProcessClass
  ): Promise<{ extendedPaths: TraversalPathSkeleton[]; procTriples: Types.ObjectId[] }> {
    const triplesFilter = this.genExistingTriplesFilter(process);
    let triples: TripleDocument[] = await Triple.find(triplesFilter);
    if (!triples.length) {
      return { extendedPaths: [], procTriples: [] };
    }
    log.silly(`Extending path ${this._id} with existing ${triples.length} triples`);
    return this.genExtended(triples, process) as Promise<{
      extendedPaths: TraversalPathSkeleton[];
      procTriples: Types.ObjectId[];
    }>;
  }
}

const TraversalPath = getModelForClass(TraversalPathClass, {
  schemaOptions: { timestamps: true, collection: 'traversalPaths' }
});

type TraversalPathDocument = TraversalPathClass & Document;

export { TraversalPath, TraversalPathClass, type TraversalPathDocument };
