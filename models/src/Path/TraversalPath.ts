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
    const limType = process.currentStep.predLimit.limType;
    const limPredicates = process.currentStep.predLimit.limPredicates || [];
    const pathFull = this.predicates.count >= process.currentStep.maxPathProps;

    let allowed: Set<string> = new Set();
    let notAllowed: Set<string> = new Set();

    if (!pathFull) {
      if (limType === 'whitelist') {
        allowed = new Set(limPredicates);
      } else {
        notAllowed = new Set(limPredicates);
      }
    } else {
      if (limType === 'whitelist') {
        allowed = new Set(this.predicates.elems.filter((p) => limPredicates.includes(p)));
      } else {
        allowed = new Set(this.predicates.elems.filter((p) => !limPredicates.includes(p)));
      }
    }

    if (allowed.size === 0 && (pathFull || limType === 'whitelist')) {
      return null;
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

    const followDirection = process.currentStep.followDirection;
    const predsDirMetrics = process.curPredsDirMetrics();
    let directionFilter = {};

    if (followDirection && predsDirMetrics && predsDirMetrics.size) {
      const subjPreds: Set<string> = new Set();
      const objPreds: Set<string> = new Set();
      const noDirPreds: Set<string> = new Set();

      for (const [pred, { bf }] of predsDirMetrics) {
        if (allowed.size && !allowed.has(pred)) {
          continue;
        }
        if (notAllowed.size && notAllowed.has(pred)) {
          continue;
        }

        const bfRatio = bf.subj / bf.obj;
        if (bfRatio >= 1.2) {
          subjPreds.add(pred);
        } else if (bfRatio <= 0.83) {
          objPreds.add(pred);
        } else {
          noDirPreds.add(pred);
        }
      }

      for (const p of allowed) {
        if (!predsDirMetrics.has(p)) {
          noDirPreds.add(p);
        }
      }

      if (subjPreds.size === 0 && objPreds.size === 0 && noDirPreds.size === 0) {
        directionFilter = {};
      } else {
        let or: object[] = [];

        if (subjPreds.size > 0) {
          const subjList = Array.from(subjPreds);
          or.push(
            subjList.length === 1
              ? { predicate: subjList[0], subject: this.head.url }
              : { predicate: { $in: subjList }, subject: this.head.url }
          );
        }

        if (objPreds.size > 0) {
          const objList = Array.from(objPreds);
          or.push(
            objList.length === 1
              ? { predicate: objList[0], object: this.head.url }
              : { predicate: { $in: objList }, object: this.head.url }
          );
        }

        if (noDirPreds.size > 0) {
          const noDirList = Array.from(noDirPreds);
          if (limType === 'whitelist') {
            or.push(
              noDirList.length === 1
                ? { predicate: noDirList[0] }
                : { predicate: { $in: noDirList } }
            );
          } else {
            or.push(
              noDirList.length === 1
                ? { predicate: { $ne: noDirList[0] } }
                : { predicate: { $nin: noDirList } }
            );
          }
        }

        directionFilter = or.length > 1
          ? { $or: or }
          : or.length === 1
            ? or[0]
            : {};
      }
    }


    const baseFilter = {
      nodes: this.head.url,
      _id: { $nin: this.triples }
    };

    const hasDirectionFilter = directionFilter && Object.keys(directionFilter).length > 0;

    if (hasDirectionFilter) {
      return { ...baseFilter, ...directionFilter };
    } else {
      return { ...baseFilter, ...predFilter };
    }
  }

  public async extendWithExistingTriples(
    process: ProcessClass
  ): Promise<{ extendedPaths: TraversalPathSkeleton[]; procTriples: Types.ObjectId[] }> {
    const triplesFilter = this.genExistingTriplesFilter(process);
    if (!triplesFilter) {
      return { extendedPaths: [], procTriples: [] };
    }
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
