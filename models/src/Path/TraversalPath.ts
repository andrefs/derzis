import { Types, Document, FilterQuery } from 'mongoose';
import { prop, index, pre, getModelForClass, PropType } from '@typegoose/typegoose';
import { TripleClass, Triple, type TripleDocument } from '../Triple';
import { BranchFactorClass, ProcessClass, SeedPosRatioClass } from '../Process';
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

// Primary query efficiency
@index({ "processId": 1, "status": 1 })
// For the predicates count/elems filtering
@index({ "predicates.count": 1, "processId": 1, "status": 1 })
@index({ "nodes.count": 1, "processId": 1, "status": 1 })
// If predicates.elems queries are common
@index({ "predicates.elems": 1 })
@index({
  "processId": 1,
  "status": 1,
  "createdAt": 1
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
@index({
  processId: 1,
  status: 1,
  "nodes.count": 1,
  "predicates.count": 1
})
@index({ status: 1 })
@index({ 'head.url': 1, status: 1 })
@index({ 'head.status': 1, status: 1 })
@index({ 'head.domain.status': 1, status: 1 })
@index({ 'head.domain.origin': 1, status: 1 })
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

  // type is always 'traversal' for this class
  @prop({ enum: ['traversal'], required: true, type: String, default: 'traversal' })
  public type!: 'traversal';

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

  /**
  * Generates a filter for existing triples based on predicate limits and path fullness.
  * @param limType The type of predicate limit ('whitelist' or 'blacklist').
  * @param limPredicates The list of predicates in the limit.
  * @param pathFull Boolean indicating whether the path is considered full based on predicate count.
  * @returns An object containing allowed and not allowed predicates, and the corresponding filter for existing triples, or null if no triples should be returned.
  */
  public genPredicatesFilter(
    limType: string,
    limPredicates: string[],
    pathFull: boolean
  ): { allowed: Set<string>; notAllowed: Set<string>; predFilter: FilterQuery<TripleClass> } | null {
    const allowed = new Set<string>();
    const notAllowed = new Set<string>();

    if (!pathFull) {
      if (limType === 'whitelist') {
        allowed.clear();
        for (const p of limPredicates) {
          allowed.add(p);
        }
      } else {
        for (const p of limPredicates) {
          notAllowed.add(p);
        }
      }
    } else {
      if (limType === 'whitelist') {
        for (const p of this.predicates.elems) {
          if (limPredicates.includes(p)) {
            allowed.add(p);
          }
        }
      } else {
        for (const p of this.predicates.elems) {
          if (!limPredicates.includes(p)) {
            allowed.add(p);
          }
        }
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

    return { allowed, notAllowed, predFilter };
  }

  /**
  * Generates a filter for existing triples based on predicate directionality metrics.
  * @param allowed Set of predicates that are allowed based on predicate limits.
  * @param notAllowed Set of predicates that are not allowed based on predicate limits.
  * @param limType The type of predicate limit ('whitelist' or 'blacklist').
  * @param followDirection Boolean indicating whether to enforce directionality.
  * @param predsDirMetrics Map of predicate direction metrics, where the key is the predicate and the value contains branch factor and seed position ratio.
  * @returns An object representing the filter for existing triples based on directionality, or an empty object if no directionality filtering is needed.
  */
  public genDirectionFilter(
    allowed: Set<string>,
    notAllowed: Set<string>,
    limType: string,
    followDirection: boolean,
    predsDirMetrics: Map<string, { bf: BranchFactorClass; spr: SeedPosRatioClass }> | undefined
  ): FilterQuery<TripleClass> {
    if (!followDirection || !predsDirMetrics || predsDirMetrics.size === 0) {
      return {};
    }

    const subjPreds = new Set<string>();
    const objPreds = new Set<string>();
    const noDirPreds = new Set<string>();

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
      return {};
    }

    const or: object[] = [];

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

    return or.length > 1
      ? { $or: or }
      : or.length === 1
        ? or[0]
        : {};
  }

  /**
  * Generates a filter for existing triples based on the current process step's predicate limits and directionality metrics.
  * @param process The current process instance containing the current step's configuration.
  * @returns An object representing the filter for existing triples, or null if no triples should be returned based on the limits.
  */
  public genExistingTriplesFilter(process: ProcessClass): FilterQuery<TripleClass> | null {
    const limType = process.currentStep.predLimit.limType;
    const limPredicates = process.currentStep.predLimit.limPredicates || [];
    const pathFull = this.predicates.count >= process.currentStep.maxPathProps;

    // filter based on predicate limits and path fullness
    const predResult = this.genPredicatesFilter(limType, limPredicates, pathFull);
    if (!predResult) {
      log.silly(`Path ${this._id} cannot be extended based on current limits`);
      return null;
    }
    const { allowed, notAllowed, predFilter } = predResult;

    const followDirection = process.currentStep.followDirection;
    const predsDirMetrics = process.curPredsDirMetrics();

    // filter based on directionality metrics 
    const directionFilter = this.genDirectionFilter(
      allowed,
      notAllowed,
      limType,
      followDirection,
      predsDirMetrics
    );

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
