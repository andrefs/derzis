import { Types, FilterQuery } from 'mongoose';
import { prop, index, pre, getDiscriminatorModelForClass, PropType, modelOptions, DocumentType } from '@typegoose/typegoose';
import { NamedNodeTripleClass, NamedNodeTriple, type NamedNodeTripleDocument, LiteralTriple, type LiteralTripleDocument, Triple, type TripleDocument, isNamedNode, isLiteral } from '../Triple';
import { BranchFactorClass, ProcessClass, SeedPosRatioClass } from '../Process';
import { Domain } from '../Domain';
import { PathClass, Path, ResourceCount, hasLiteralHead, HEAD_TYPE, UrlHead, LiteralHead, type Head } from './Path';
import { PathType, TripleType, type TypedTripleId, type LiteralObject } from '@derzis/common';
import { createLogger } from '@derzis/common/server';
const log = createLogger('TraversalPath');
import config from '@derzis/config';
const bfNeutralZone = config.manager.predicates.branchingFactor.neutralZone;

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

/**
 * Pre-save hook to update the counts of predicates and nodes, set the last predicate, and populate domain information for URL heads before saving a TraversalPath document.
 * This ensures that the counts and last predicate are always accurate, and that URL heads have up-to-date domain information based on the URL's origin.
 */
@pre<TraversalPathClass>('save', async function () {
  this.nodes.count = this.nodes.elems.length;
  this.predicates.count = this.predicates.elems.length;
  if (this.predicates.count) {
    this.lastPredicate = this.predicates.elems[this.predicates.count - 1];
  }

  if (this.head.type === HEAD_TYPE.URL) {
    const urlHead = this.head as UrlHead;
    const origin = new URL(urlHead.url).origin;
    const d = await Domain.findOne({ origin });
    if (d) {
      urlHead.domain = {
        origin: d.origin,
        status: d.status
      };
    }
  }
})

// Primary query efficiency
@index({ "processId": 1, "status": 1 })
// For keyset pagination (cursor-based pagination)
@index({ createdAt: 1, _id: 1 })
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
@index({ status: 1 })
@index({ 'head.url': 1, status: 1 })
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
@index({ 'head.status': 1, status: 1 })
@index({ 'head.domain.status': 1, status: 1 })
@index({ type: 1, 'head.domain.origin': 1, status: 1 })
@index({ processId: 1, 'head.url': 1 })
@index({ processId: 1, status: 1, extensionCounter: 1 })
@index({ type: 1, processId: 1, status: 1, 'head.domain.status': 1 })
@modelOptions({
  schemaOptions: {
    timestamps: true,
  }
})
export class TraversalPathClass extends PathClass {
  @prop({ validate: (value: string) => !!value, type: String })
  public lastPredicate?: string;

  @prop({ type: ResourceCount })
  public predicates!: ResourceCount;

  @prop({ type: ResourceCount })
  public nodes!: ResourceCount;

  @prop({ required: true, ref: 'NamedNodeTriple', type: [Types.ObjectId], default: [] }, PropType.ARRAY)
  public triples!: Types.ObjectId[];

  @prop({ enum: PathType, required: true, type: String })
  public type!: PathType.TRAVERSAL;

  public copy(this: TraversalPathClass): TraversalPathSkeleton {
    const copy: TraversalPathSkeleton = {
      processId: this.processId,
      type: PathType.TRAVERSAL,
      seed: {
        url: this.seed.url
      },
      head: this.head as Head,
      predicates: { elems: [...this.predicates.elems] }, // count will be updated in pre-save hook
      nodes: { elems: [...this.nodes.elems] }, // count will be updated in pre-save hook
      status: this.status
    };
    return copy;
  }

  /**
   * Generates extended paths based on the provided triples and process configuration.
   * @param triples The list of triples to consider for path extension.
   * @param process The current process instance containing configuration for path extension.
   * @returns An object containing the extended paths and the corresponding triples to be processed.
   */
  public async genExtended(
    triples: TripleDocument[],
    process: ProcessClass
  ): Promise<{ extendedPaths: TraversalPathSkeleton[]; procTriples: TypedTripleId[] }> {
    // If the head is a literal, we cannot extend further, so return empty results.
    if (this.head.type === HEAD_TYPE.LITERAL) {
      return { extendedPaths: [], procTriples: [] };
    }

    const urlHead = this.head as UrlHead;
    let extendedPaths: { [prop: string]: { [newHead: string]: TraversalPathSkeleton } } = {};
    let procTriples: TypedTripleId[] = [];
    const predsDirMetrics = process.curPredsDirMetrics();
    const followDirection = process!.currentStep.followDirection;

    // Named node triples
    const namedNodeTriples = triples
      .filter((t): t is NamedNodeTripleDocument => isNamedNode(t))
      .filter(t =>
        this.shouldCreateNewPath(t) &&
        process?.whiteBlackListsAllow(t) &&
        t.directionOk(urlHead.url, followDirection, predsDirMetrics)
      );

    for (const t of namedNodeTriples) {
      log.silly('Extending path with NamedNodeTriple', t);
      const newHeadUrl: string = t.subject === urlHead.url ? t.object : t.subject;
      const prop = t.predicate;

      extendedPaths[prop] = extendedPaths[prop] || {};
      if (!extendedPaths[prop][newHeadUrl] && !this.tripleIsOutOfBounds(t, process!)) {
        const ep = this.copy();
        ep.head = {
          type: HEAD_TYPE.URL,
          url: newHeadUrl,
          status: 'unvisited',
        } as Head;
        ep.triples = [...this.triples, t._id];
        ep.predicates.elems = Array.from(new Set([...this.predicates.elems, prop]));
        ep.nodes.elems.push(newHeadUrl);
        ep.status = 'active';

        procTriples.push({ id: t._id.toString(), type: TripleType.NAMED_NODE });
        log.silly('New path', ep);
        extendedPaths[prop][newHeadUrl] = ep;
      }
    }

    // Literal triples
    const literalTriples = triples
      .filter((t): t is LiteralTripleDocument => isLiteral(t))
      .filter(t => this.shouldCreateNewPath(t));

    for (const t of literalTriples) {
      log.silly('Extending path with LiteralTriple', t);
      const prop = t.predicate;
      const literalKey = `literal:${t.object.value}|${t.object.datatype || ''}|${t.object.language || ''}`;

      extendedPaths[prop] = extendedPaths[prop] || {};
      if (!extendedPaths[prop][literalKey]) {
        const ep = this.copy();
        ep.head = {
          type: HEAD_TYPE.LITERAL,
          value: t.object.value,
          datatype: t.object.datatype,
          language: t.object.language
        } as Head;
        ep.triples = [...this.triples, t._id];
        ep.predicates.elems = Array.from(new Set([...this.predicates.elems, prop]));
        ep.status = 'active';

        procTriples.push({ id: t._id.toString(), type: TripleType.LITERAL });
        log.silly('New path with literal head', ep);
        extendedPaths[prop][literalKey] = ep;
      }
    }

    const eps: TraversalPathSkeleton[] = [];
    Object.values(extendedPaths).forEach((x) => Object.values(x).forEach((y) => eps.push(y)));

    log.silly('Extended paths', eps);
    return { extendedPaths: eps, procTriples };
  }

  public shouldCreateNewPath(this: TraversalPathClass, t: NamedNodeTripleClass | LiteralTripleDocument): boolean {
    // If the head is not a URL, we cannot extend
    if (this.head.type !== HEAD_TYPE.URL) {
      return false;
    }

    const urlHead = this.head as UrlHead;
    if (t.type === TripleType.LITERAL) {
      if (t.predicate === urlHead.url) {
        return false;
      }
      return true;
    }

    const namedNodeTriple = t as NamedNodeTripleClass;

    if (namedNodeTriple.subject === namedNodeTriple.object) {
      return false;
    }

    if (namedNodeTriple.predicate === urlHead.url) {
      return false;
    }

    const newHeadUrl: string = namedNodeTriple.subject === urlHead.url ? namedNodeTriple.object : namedNodeTriple.subject;

    if (this.nodes.elems.includes(newHeadUrl)) {
      return false;
    }

    return true;
  }

  public tripleIsOutOfBounds(t: NamedNodeTripleClass, process: ProcessClass): boolean {
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
  ): { allowed: Set<string>; notAllowed: Set<string>; predFilter: FilterQuery<NamedNodeTripleClass> } | null {
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

    // TODO FIXME hardcoded for now
    // Allow predicates with literal objects (e.g. rdfs:label, rdfs:comment)
    const litPred = [
      'http://www.w3.org/2000/01/rdf-schema#label',
      'http://www.w3.org/2000/01/rdf-schema#comment'
    ];
    if (limType === 'blacklist') {
      for (const p of litPred) {
        notAllowed.delete(p);
      }
    }
    if (limType === 'whitelist') {
      for (const p of litPred) {
        allowed.add(p);
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
  ): FilterQuery<NamedNodeTripleClass> {
    if (this.head.type !== HEAD_TYPE.URL) {
      return {};
    }

    const urlHead = this.head as UrlHead;

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
      if (bfRatio >= bfNeutralZone.max) {
        subjPreds.add(pred);
      } else if (bfRatio <= bfNeutralZone.min) {
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

    // TODO FIXME hardcoded for now
    // Allow predicates with literal objects (e.g. rdfs:label, rdfs:comment)
    noDirPreds.add('http://www.w3.org/2000/01/rdf-schema#label');
    noDirPreds.add('http://www.w3.org/2000/01/rdf-schema#comment');

    if (subjPreds.size === 0 && objPreds.size === 0 && noDirPreds.size === 0) {
      return {};
    }

    const or: object[] = [];

    if (subjPreds.size > 0) {
      const subjList = Array.from(subjPreds);
      or.push(
        subjList.length === 1
          ? { predicate: subjList[0], subject: urlHead.url }
          : { predicate: { $in: subjList }, subject: urlHead.url }
      );
    }

    if (objPreds.size > 0) {
      const objList = Array.from(objPreds);
      or.push(
        objList.length === 1
          ? { predicate: objList[0], object: urlHead.url }
          : { predicate: { $in: objList }, object: urlHead.url }
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
  * Generates a filter for existing triples to be used for extending the current path, based on the current process step's configuration. The filter is constructed
  * based on the current process step's predicate limits and directionality metrics.
  * @param process The current process instance containing the current step's configuration.
  * @returns An object representing the filter for existing triples, or null if no triples should be returned based on the limits.
  */
  public genExistingTriplesFilter(
    process: ProcessClass): FilterQuery<NamedNodeTripleDocument> | null {
    if (this.head.type !== HEAD_TYPE.URL) {
      return null;
    }

    const urlHead = this.head as UrlHead;
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
      predsDirMetrics,
    );

    const baseFilter = {
      nodes: urlHead.url,
      _id: { $nin: this.triples }
    };

    const hasDirectionFilter = directionFilter && Object.keys(directionFilter).length > 0;

    if (hasDirectionFilter) {
      return { ...baseFilter, ...directionFilter };
    } else {
      return { ...baseFilter, ...predFilter };
    }
  }

  /**
  * Extends the current path with existing triples from the database that match the generated filter based on the current process step's configuration.
  * @param process The current process instance containing the current step's configuration.
  * @returns An object containing the extended paths and the corresponding triples to be processed, or empty results if no extension is possible.
  */
  public async extendWithExistingTriples(
    process: ProcessClass
  ): Promise<{ extendedPaths: TraversalPathSkeleton[]; procTriples: TypedTripleId[] }> {
    if (hasLiteralHead(this)) {
      return { extendedPaths: [], procTriples: [] };
    }

    const triplesFilter = this.genExistingTriplesFilter(process);
    if (!triplesFilter) {
      return { extendedPaths: [], procTriples: [] };
    }

    const triples = await Triple.find(triplesFilter);

    if (!triples.length) {
      return { extendedPaths: [], procTriples: [] };
    }
    log.silly(`Extending path ${this._id} with existing ${triples.length} triples`);
    return this.genExtended(triples, process);
  }
}

export const TraversalPath = getDiscriminatorModelForClass(Path, TraversalPathClass, PathType.TRAVERSAL);

export type TraversalPathDocument = DocumentType<TraversalPathClass>;

