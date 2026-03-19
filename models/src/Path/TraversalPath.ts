import { Types, type QueryFilter } from 'mongoose';
import {
  prop,
  index,
  pre,
  getDiscriminatorModelForClass,
  PropType,
  modelOptions,
  type DocumentType
} from '@typegoose/typegoose';
import {
  NamedNodeTripleClass,
  type NamedNodeTripleDocument,
  type LiteralTripleDocument,
  Triple,
  type TripleDocument,
  isNamedNode,
  isLiteral
} from '../Triple';
import {
  BranchFactorClass,
  buildLimsByType,
  type LimsByType,
  matchesAny,
  matchesOne,
  ProcessClass,
  StepClass,
  type PredLimitation,
  isUrlHead
} from '../Process';
import { Domain } from '../Domain';
import { PathClass, Path, ResourceCount, HEAD_TYPE, UrlHead, type Head, SeedClass } from './Path';
import { PathType, TripleType, type TypedTripleId } from '@derzis/common';
import { createLogger } from '@derzis/common/server';
import type { ExtendedPathsResult } from '../types';
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

  if (isUrlHead(this.head)) {
    const urlHead = this.head;
    if (!urlHead.url || typeof urlHead.url !== 'string' || urlHead.url.trim() === '') {
      throw new Error(`Invalid TraversalPath: head.type is 'url' but head.url is missing or empty`);
    }
    try {
      new URL(urlHead.url);
    } catch {
      throw new Error(`Invalid TraversalPath: head.url '${urlHead.url}' is not a valid URL`);
    }
    const origin = new URL(urlHead.url).origin;
    const d = await Domain.findOne({ origin });
    if (d) {
      urlHead.domain = {
        origin: d.origin,
        isUnvisited: d.status === 'unvisited'
      };
    }
  }
})
// For keyset pagination (cursor-based pagination)
@index({ createdAt: 1, _id: 1 })
// Base indexes
@index({ type: 1 }, { name: 'idx_traversal_type' })
// For the predicates count/elems filtering
@index({ 'predicates.count': 1, processId: 1, status: 1 })
@index({ 'nodes.count': 1, processId: 1, status: 1 })
// If predicates.elems queries are common
@index({ 'predicates.elems': 1 })
@index({
  processId: 1,
  status: 1,
  createdAt: 1
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
  'nodes.count': 1,
  'predicates.count': 1
})
// Optimized index for complex path query in getPathsForDomainCrawl
// Supports filters: processId, status, head.type, head.domain.isUnvisited, head.status, nodes.count
@index({
  processId: 1,
  status: 1,
  'head.type': 1,
  'head.domain.isUnvisited': 1,
  'head.status': 1,
  'nodes.count': 1
})
@index({ 'head.status': 1, status: 1 }, { name: 'idx_traversal_head_status' })
@index({ type: 1, 'head.domain.origin': 1, status: 1 }, { name: 'idx_traversal_domain_status' })
@index({ processId: 1, 'head.url': 1 }, { name: 'idx_traversal_process_url' })
@index({ processId: 1, status: 1, extensionCounter: 1 }, { name: 'idx_traversal_extend' })
// Indexes for path extension API (headUrl and full extend)
@index({
  processId: 1,
  status: 1,
  'head.type': 1,
  'head.url': 1,
  'nodes.count': 1,
  extensionCounter: 1
})
// Optimized index for getPathsForDomainCrawl and getPathsForRobotsChecking with head.domain and length-first sort
@index({
  processId: 1,
  status: 1,
  'head.type': 1,
  'head.domain.origin': 1,
  'nodes.count': 1,
  createdAt: 1,
  _id: 1
})
// Optimized index for extendExistingPaths with length-first sort and pagination cursor
@index({
  processId: 1,
  status: 1,
  'head.type': 1,
  'nodes.count': 1,
  extensionCounter: 1,
  createdAt: 1,
  _id: 1
})
// Covering index for extendExistingPaths with predicates.elems filter
@index({
  type: 1,
  processId: 1,
  status: 1,
  'head.type': 1,
  'nodes.count': 1,
  'predicates.count': 1,
  'predicates.elems': 1,
  extensionCounter: 1,
  createdAt: 1,
  _id: 1
})
@modelOptions({
  schemaOptions: {
    timestamps: true
  }
})
export class TraversalPathClass extends PathClass {
  @prop({ required: true, type: SeedClass })
  public seed!: SeedClass;

  @prop({ validate: (value: string) => !!value, type: String })
  public lastPredicate?: string;

  @prop({ type: ResourceCount })
  public predicates!: ResourceCount;

  @prop({ type: ResourceCount })
  public nodes!: ResourceCount;

  @prop(
    { required: true, ref: 'NamedNodeTriple', type: [Types.ObjectId], default: [] },
    PropType.ARRAY
  )
  public triples!: Types.ObjectId[];

  public copy(this: TraversalPathClass): TraversalPathSkeleton {
    const copy: TraversalPathSkeleton = {
      processId: this.processId,
      type: PathType.TRAVERSAL,
      seed: {
        url: this.seed.url
      },
      head: this.head,
      status: this.status,
      predicates: { elems: [...this.predicates.elems] },
      nodes: { elems: [...this.nodes.elems] }
    };
    return copy;
  }

  /**
   * Generates extended paths based on the provided triples and process configuration.
   * @param triples The list of triples to consider for path extension.
   * @param process The current process instance containing configuration for path extension.
   * @returns An object containing the extended paths and the corresponding triples to be processed.
   */
  public async genExtendedPaths(
    process: ProcessClass,
    triples?: TripleDocument[]
  ): Promise<ExtendedPathsResult<TraversalPathSkeleton>> {
    // If the head is a literal, we cannot extend further, so return empty results.
    if (!isUrlHead(this.head)) {
      return { extendedPaths: [], procTriples: [] };
    }

    let triplesToExtend = triples;
    if (!triplesToExtend) {
      const triplesFilter = this.genExistingTriplesFilter(process);
      if (!triplesFilter) {
        return { extendedPaths: [], procTriples: [] };
      }
      triplesToExtend = await Triple.find(triplesFilter);
      log.silly(`Found ${triplesToExtend.length} triples to extend path ${this._id}`);
      if (!triplesToExtend.length) {
        return { extendedPaths: [], procTriples: [] };
      }
    }

    // Exclude triples already used in this path
    triplesToExtend = triplesToExtend.filter((t) => !this.triples.includes(t._id));

    if (!triplesToExtend.length) {
      return { extendedPaths: [], procTriples: [] };
    }

    const urlHead = this.head;
    let extendedPaths: { [prop: string]: { [newHead: string]: TraversalPathSkeleton } } = {};
    let procTriples: TypedTripleId[] = [];
    const predsBF = process.curPredsBranchFactor();
    const followDirection = process.currentStep.followDirection;

    // Named node triples
    const namedNodeTriples = triplesToExtend
      .filter((t): t is NamedNodeTripleDocument => isNamedNode(t))
      .filter(
        (t) =>
          this.isExtensionValid(t) &&
          this.isExtensionAllowed(t, process.currentStep) &&
          t.directionOk(urlHead.url, followDirection, predsBF)
      );

    for (const t of namedNodeTriples) {
      log.silly('Extending path with NamedNodeTriple', t);
      const newHeadUrl: string = t.subject === urlHead.url ? t.object : t.subject;
      const prop = t.predicate;

      extendedPaths[prop] = extendedPaths[prop] || {};
      if (!extendedPaths[prop][newHeadUrl] && !this.tripleIsOutOfBounds(t, process)) {
        const domain = new URL(newHeadUrl).origin;
        const ep = this.copy();
        const head: Head = {
          type: HEAD_TYPE.URL,
          url: newHeadUrl,
          domain: {
            origin: domain,
            isUnvisited: true // this will be updated before saving
          },
          status: 'unvisited'
        };
        ep.head = head;
        ep.status = 'active';
        ep.triples = [...this.triples, t._id];
        ep.predicates.elems = Array.from(new Set([...this.predicates.elems, prop]));
        ep.nodes.elems.push(newHeadUrl);

        procTriples.push({ id: t._id.toString(), type: TripleType.NAMED_NODE });
        log.silly('New path', ep);
        extendedPaths[prop][newHeadUrl] = ep;
      }
    }

    // Literal triples
    const literalTriples = triplesToExtend
      .filter((t): t is LiteralTripleDocument => isLiteral(t))
      .filter((t) => this.isExtensionValid(t));

    for (const t of literalTriples) {
      log.silly('Extending path with LiteralTriple', t);
      const prop = t.predicate;
      const literalKey = `literal:${t.object.value}|${t.object.datatype || ''}|${t.object.language || ''}`;

      extendedPaths[prop] = extendedPaths[prop] || {};
      if (!extendedPaths[prop][literalKey]) {
        const ep = this.copy();
        const head: Head = {
          type: HEAD_TYPE.LITERAL,
          value: t.object.value,
          datatype: t.object.datatype,
          language: t.object.language
        };

        ep.head = head;
        ep.status = 'active';
        ep.triples = [...this.triples, t._id];
        ep.predicates.elems = Array.from(new Set([...this.predicates.elems, prop]));
        log.silly('New path with literal head', ep);
        extendedPaths[prop][literalKey] = ep;
      }
    }

    const eps: TraversalPathSkeleton[] = [];
    Object.values(extendedPaths).forEach((x) => Object.values(x).forEach((y) => eps.push(y)));

    log.silly('Extended paths', eps);
    return { extendedPaths: eps, procTriples };
  }

  /**
   * Determines whether a new path should be created based on the given triple and the current path's head and nodes.
   * For URL heads, checks if the triple can extend the path without creating cycles.
   * For literal heads, no new paths can be created.
   * @param t The triple to evaluate for path extension.
   * @returns A boolean indicating whether a new path should be created based on the triple.
   */
  public isExtensionValid(
    this: TraversalPathClass,
    t: NamedNodeTripleClass | LiteralTripleDocument
  ): boolean {
    // If the head is not a URL, we cannot extend
    if (!isUrlHead(this.head)) {
      return false;
    }

    const urlHead = this.head;
    if (isLiteral(t)) {
      if (t.predicate === urlHead.url) {
        return false;
      }
      return true;
    }

    const namedNodeTriple = t;
    if (namedNodeTriple.subject === namedNodeTriple.object) {
      return false;
    }
    if (namedNodeTriple.predicate === urlHead.url) {
      return false;
    }

    const newHeadUrl: string =
      namedNodeTriple.subject === urlHead.url ? namedNodeTriple.object : namedNodeTriple.subject;

    if (this.nodes.elems.includes(newHeadUrl)) {
      return false;
    }
    return true;
  }

  public isExtensionAllowed(
    this: TraversalPathClass,
    t: NamedNodeTripleClass,
    currentStep: StepClass
  ): boolean {
    const limsByType = buildLimsByType(currentStep.predLimitations || []);

    if (!this.isExtensionAllowedByTriple(t, currentStep, limsByType)) {
      return false;
    }

    // Always enforce maxPathLength
    if (this.nodes.count >= currentStep.maxPathLength) {
      return false;
    }

    // Exempt rdfs:label and rdfs:comment from past constraints
    const EXEMPT_PREDICATES = new Set([
      'http://www.w3.org/2000/01/rdf-schema#label',
      'http://www.w3.org/2000/01/rdf-schema#comment'
    ]);
    if (EXEMPT_PREDICATES.has(t.predicate)) {
      return true;
    }

    // Non-exempt predicates must satisfy past constraints
    return this.isExtensionAllowedByPath(currentStep, limsByType);
  }

  public isExtensionAllowedByPath(
    this: TraversalPathClass,
    currentStep: StepClass,
    limsByType: LimsByType
  ): boolean {
    if (!currentStep?.predLimitations?.length) {
      return true;
    }
    if (this.nodes.count >= currentStep?.maxPathLength) {
      return false;
    }

    if (
      limsByType['require-past'] &&
      !matchesAny(this.predicates.elems, limsByType['require-past'])
    ) {
      return false;
    }
    if (
      limsByType['disallow-past'] &&
      matchesAny(this.predicates.elems, limsByType['disallow-past'])
    ) {
      return false;
    }
    return true;
  }

  public isExtensionAllowedByTriple(
    this: TraversalPathClass,
    t: NamedNodeTripleClass,
    currentStep: StepClass,
    limsByType: LimsByType
  ): boolean {
    // Exempt rdfs:label and rdfs:comment from all limitations
    const EXEMPT_PREDICATES = new Set([
      'http://www.w3.org/2000/01/rdf-schema#label',
      'http://www.w3.org/2000/01/rdf-schema#comment'
    ]);
    if (EXEMPT_PREDICATES.has(t.predicate)) {
      return true;
    }

    // if path predicates are maxed out, predicate must be in predicates.elems
    if (
      this.predicates.count >= currentStep.maxPathProps &&
      !this.predicates.elems.includes(t.predicate)
    ) {
      return false;
    }
    if (limsByType['require-future'] && !matchesOne(t.predicate, limsByType['require-future'])) {
      return false;
    }
    if (limsByType['disallow-future'] && matchesOne(t.predicate, limsByType['disallow-future'])) {
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
   * Uses predLimitations to determine allowed/disallowed predicates for future extensions.
   * @param predLimitations Array of predicate limitations with past/future constraints.
   * @param pathFull Boolean indicating whether the path is considered full based on predicate count.
   * @returns An object containing allowed and not allowed predicates, and the corresponding filter for existing triples, or null if no triples should be returned.
   */
  public genPredicatesFilter(
    predLimitations: PredLimitation[],
    pathFull: boolean
  ): {
    allowed: Set<string>;
    notAllowed: Set<string>;
    predFilter: QueryFilter<NamedNodeTripleClass>;
  } | null {
    // Extract future constraints from predLimitations
    const requireFuture: string[] = [];
    const disallowFuture: string[] = [];

    for (const pl of predLimitations) {
      if (pl.lims.includes('require-future')) {
        requireFuture.push(pl.predicate);
      }
      if (pl.lims.includes('disallow-future')) {
        disallowFuture.push(pl.predicate);
      }
    }

    // If no future constraints, allow all predicates
    if (requireFuture.length === 0 && disallowFuture.length === 0) {
      return { allowed: new Set(), notAllowed: new Set(), predFilter: {} };
    }

    const allowed = new Set<string>();
    const notAllowed = new Set<string>();

    // Map limType to legacy values for literal predicate handling
    const hasRequireFuture = requireFuture.length > 0;
    const hasDisallowFuture = disallowFuture.length > 0;
    const limType = hasRequireFuture ? 'whitelist' : 'blacklist';

    if (!pathFull) {
      if (hasRequireFuture) {
        for (const p of requireFuture) {
          allowed.add(p);
        }
      }
      if (hasDisallowFuture) {
        for (const p of disallowFuture) {
          notAllowed.add(p);
        }
      }
    } else {
      // Path is full - can only extend with predicates already in path
      if (hasRequireFuture) {
        for (const p of this.predicates.elems) {
          if (requireFuture.includes(p)) {
            allowed.add(p);
          }
        }
      }
      if (hasDisallowFuture) {
        for (const p of this.predicates.elems) {
          if (!disallowFuture.includes(p)) {
            allowed.add(p);
          }
        }
      }
    }

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
      predFilter =
        allowed.size === 1
          ? { predicate: Array.from(allowed)[0] }
          : { predicate: { $in: Array.from(allowed) } };
    } else if (notAllowed.size) {
      predFilter =
        notAllowed.size === 1
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
   * @param predsBF Map of predicate direction metrics, where the key is the predicate and the value contains branch factor and seed position ratio.
   * @returns An object representing the filter for existing triples based on directionality, or an empty object if no directionality filtering is needed.
   */
  public genDirectionFilter(
    allowed: Set<string>,
    notAllowed: Set<string>,
    limType: string,
    followDirection: boolean,
    predsBF: Map<string, BranchFactorClass> | undefined
  ): QueryFilter<NamedNodeTripleClass> {
    if (!isUrlHead(this.head)) {
      return {};
    }

    const urlHead = this.head;

    if (!followDirection || !predsBF || predsBF.size === 0) {
      return {};
    }

    const subjPreds = new Set<string>();
    const objPreds = new Set<string>();
    const noDirPreds = new Set<string>();

    for (const [pred, bf] of predsBF) {
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
      if (!predsBF.has(p)) {
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
          noDirList.length === 1 ? { predicate: noDirList[0] } : { predicate: { $in: noDirList } }
        );
      } else {
        or.push(
          noDirList.length === 1
            ? { predicate: { $ne: noDirList[0] } }
            : { predicate: { $nin: noDirList } }
        );
      }
    }

    return or.length > 1 ? { $or: or } : or.length === 1 ? or[0] : {};
  }

  /**
   * Generates a filter for existing triples to be used for extending the current path, based on the current process step's configuration. The filter is constructed
   * based on the current process step's predicate limits and directionality metrics.
   * @param process The current process instance containing the current step's configuration.
   * @returns An object representing the filter for existing triples, or null if no triples should be returned based on the limits.
   */
  public genExistingTriplesFilter(
    process: ProcessClass
  ): QueryFilter<NamedNodeTripleDocument> | null {
    if (!isUrlHead(this.head)) {
      return null;
    }

    const urlHead = this.head;
    const predLimitations = process.currentStep.predLimitations || [];
    const pathFull = this.predicates.count >= process.currentStep.maxPathProps;

    // filter based on predicate limits and path fullness
    // Always call genPredicatesFilter - it handles empty predLimitations correctly
    const predResult = this.genPredicatesFilter(predLimitations, pathFull);
    if (!predResult) {
      log.silly(`Path ${this._id} cannot be extended based on current limits`);
      return null;
    }
    const { allowed, notAllowed, predFilter } = predResult;

    // Determine limType for direction filter
    const hasRequireFuture = predLimitations.some((pl) => pl.lims.includes('require-future'));
    const limType = hasRequireFuture ? 'whitelist' : 'blacklist';

    const followDirection = process.currentStep.followDirection;
    const predsBF = process.curPredsBranchFactor();

    // filter based on directionality metrics
    const directionFilter = this.genDirectionFilter(
      allowed,
      notAllowed,
      limType,
      followDirection,
      predsBF
    );

    const baseFilter: QueryFilter<NamedNodeTripleDocument> = {
      nodes: urlHead.url,
      _id: { $nin: this.triples }
    };

    const hasDirectionFilter = directionFilter && Object.keys(directionFilter).length > 0;

    const result: QueryFilter<NamedNodeTripleDocument> = hasDirectionFilter
      ? { ...baseFilter, ...directionFilter }
      : { ...baseFilter, ...predFilter };
    return result;
  }
}

export const TraversalPath = getDiscriminatorModelForClass(
  Path,
  TraversalPathClass,
  PathType.TRAVERSAL
);

export type TraversalPathDocument = DocumentType<TraversalPathClass>;
