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

  public genExistingTriplesFilter(process: ProcessClass) {
    let predFilter;

    if (this.predicates.count >= process.currentStep.maxPathProps) {
      if (process.currentStep.predLimit.limType === 'whitelist') {
        const predWhiteList = [];
        for (const p of this.predicates.elems) {
          if (process.currentStep.predLimit.limPredicates.includes(p)) {
            predWhiteList.push(p);
          }
        }
        predFilter = { $in: predWhiteList };
      } else {
        predFilter = {
          $in: this.predicates.elems,
          $nin: process.currentStep.predLimit.limPredicates
        };
      }
    } else {
      if (process.currentStep.predLimit.limType === 'whitelist') {
        predFilter = { $in: process.currentStep.predLimit.limPredicates };
      } else {
        predFilter = { $nin: process.currentStep.predLimit.limPredicates };
      }
    }

    const followDirection = process!.currentStep.followDirection;
    const predsDirMetrics = process!.curPredsDirMetrics();
    let directionFilter = {};

    if (followDirection && predsDirMetrics && predsDirMetrics.size) {
      const subjPreds: string[] = [];
      const objPreds: string[] = [];
      Array.from(predsDirMetrics).forEach(([pred, { bf }]) => {
        const bfRatio = bf.subj / bf.obj;
        if (bfRatio >= 1) {
          subjPreds.push(pred);
        } else {
          objPreds.push(pred);
        }
      });
      directionFilter = {
        $or: [
          { predicate: { $nin: [...subjPreds, ...objPreds] } },
          { predicate: { $in: subjPreds }, subject: this.head.url },
          { predicate: { $in: objPreds }, object: this.head.url }
        ]
      };
    }

    return {
      predicate: predFilter,
      nodes: this.head.url,
      _id: { $nin: this.triples },
      ...directionFilter
    };
  }

  public async extendWithExistingTriples(
    process: ProcessClass
  ): Promise<{ extendedPaths: TraversalPathSkeleton[]; procTriples: Types.ObjectId[] }> {
    const triplesFilter = this.genExistingTriplesFilter(process);
    let triples: TripleDocument[] = await Triple.find(triplesFilter);
    if (!triples.length) {
      return { extendedPaths: [], procTriples: [] };
    }
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
