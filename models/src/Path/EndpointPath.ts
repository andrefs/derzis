import { Types, type QueryFilter } from 'mongoose';
import {
  prop,
  index,
  pre,
  getDiscriminatorModelForClass,
  type DocumentType
} from '@typegoose/typegoose';
import {
  NamedNodeTripleClass,
  type NamedNodeTripleDocument,
  type LiteralTripleDocument,
  Triple,
  type TripleDocument,
  type BlankNodeTripleDocument,
  isNamedNode,
  isLiteral,
  isBlankNode
} from '../Triple';
import { iterateBlankNodeOutgoings } from './blank-node-utils';
import { buildLimsByType, isUrlHead, matchesOne, ProcessClass, StepClass } from '../Process';
import {
  PathClass,
  Path,
  hasLiteralHead,
  HEAD_TYPE,
  UrlHead,
  type LiteralHead,
  type PathSkeleton
} from './Path';
import { PathType, TripleType, type TypedTripleId, isBlankNodeId } from '@derzis/common';
import config from '@derzis/config';
import { type RecursivePartial } from '@derzis/common';
import { createLogger } from '@derzis/common/server';
import type { ExtendedPathsResult } from '../types';
const log = createLogger('EndpointPath');

interface Candidate {
  headUrl?: string;
  literalHead?: LiteralHead;
  distance: number;
  seedPaths: Record<string, number>;
}

// SeedPathEntry class for tracking seed distances
export class SeedPathEntryClass {
  @prop({ type: String, required: true })
  public seed!: string;

  @prop({ type: Number, required: true, min: 1 })
  public minLength!: number;
}

export type EndpointPathSkeleton = Pick<
  EndpointPathClass,
  'processId' | 'head' | 'type' | 'status'
> &
  RecursivePartial<EndpointPathClass> & {
    shortestPathLength: number;
    seedPaths: Array<{ seed: string; minLength: number }>;
  };

export function isEndpointPathSkeleton(path: PathSkeleton): path is EndpointPathSkeleton {
  return path.type === PathType.ENDPOINT;
}

@index({ processId: 1 }, { name: 'idx_endpoint_process' })
@index({ createdAt: 1, _id: 1 })
@index({ type: 1 }, { name: 'idx_endpoint_type' })
@index(
  { processId: 1, 'head.url': 1 },
  {
    unique: true,
    partialFilterExpression: { 'head.type': HEAD_TYPE.URL }
  }
)
@index({ 'head.url': 1, status: 1 }, { name: 'idx_endpoint_head_url_status' })
@index({ 'head.status': 1, status: 1 }, { name: 'idx_endpoint_head_status' })
@index({ type: 1, 'head.domain.origin': 1, status: 1 }, { name: 'idx_endpoint_domain_status' })
// Optimized index for endpoint path queries with shortestPathLength sort
@index(
  {
    processId: 1,
    status: 1,
    'head.type': 1,
    shortestPathLength: 1,
    createdAt: 1,
    _id: 1
  },
  {
    name: 'idx_endpoint_query',
    partialFilterExpression: { type: PathType.ENDPOINT }
  }
)
// Optimized index for endpoint crawl queries with head.status and head.domain filters
@index(
  {
    processId: 1,
    status: 1,
    'head.type': 1,
    'head.status': 1,
    'head.domain.origin': 1,
    shortestPathLength: 1,
    createdAt: 1
  },
  {
    name: 'idx_endpoint_crawl',
    partialFilterExpression: { type: PathType.ENDPOINT }
  }
)
@pre<EndpointPathClass>('save', async function () {
  if (isUrlHead(this.head)) {
    const urlHead = this.head;
    if (urlHead.type !== HEAD_TYPE.URL) {
      throw new Error(`Invalid EndpointPath: head.type is 'url' but head is not UrlHead`);
    }
    if (!urlHead.url || typeof urlHead.url !== 'string' || urlHead.url.trim() === '') {
      throw new Error(`Invalid EndpointPath: head.type is 'url' but head.url is missing or empty`);
    }
    try {
      new URL(urlHead.url);
    } catch {
      throw new Error(`Invalid EndpointPath: head.url '${urlHead.url}' is not a valid URL`);
    }
  }
})
export class EndpointPathClass extends PathClass {
  @prop({ required: true, type: Number, default: 0 })
  public shortestPathLength!: number;

  // SeedPathEntryClass is defined above for subdocument array
  @prop({ required: true, default: [], type: [SeedPathEntryClass] })
  public seedPaths!: SeedPathEntryClass[];

  public isExtensionValid(this: EndpointPathClass, t: TripleDocument, urlHead?: UrlHead): boolean {
    if (isLiteral(t)) {
      if (urlHead && t.predicate === urlHead.url) return false;
      return true;
    }
    if (isBlankNode(t)) {
      if (t.subject === t.object.id) return false;
      return true;
    }
    // Must be a named node triple
    if (isNamedNode(t)) {
      if (t.subject === t.object) return false;
      if (urlHead && t.predicate === urlHead.url) return false;
      return true;
    }
    return false;
  }

  public isExtensionAllowed(
    this: EndpointPathClass,
    t: TripleDocument,
    currentStep: StepClass
  ): boolean {
    if (!currentStep?.predLimitations?.length) {
      return true;
    }
    if (this.shortestPathLength >= currentStep?.maxPathLength) {
      return false;
    }

    const limsByType = buildLimsByType(currentStep.predLimitations);

    // Exempt rdfs:label and rdfs:comment
    const EXEMPT_PREDICATES = new Set([
      'http://www.w3.org/2000/01/rdf-schema#label',
      'http://www.w3.org/2000/01/rdf-schema#comment'
    ]);
    if (EXEMPT_PREDICATES.has(t.predicate)) {
      return true;
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
    return this.shortestPathLength >= process.currentStep.maxPathLength;
  }

  public genExistingTriplesFilter(
    _process: ProcessClass
  ): QueryFilter<NamedNodeTripleClass> | null {
    if (this.head.type !== HEAD_TYPE.URL) {
      return null;
    }
    if (!isUrlHead(this.head) || !this.head.url) {
      return null;
    }
    return {
      nodes: this.head.url
    };
  }

  public copy(): EndpointPathSkeleton {
    const copy: EndpointPathSkeleton = {
      processId: this.processId,
      type: PathType.ENDPOINT,
      head: this.head,
      status: this.status,
      shortestPathLength: this.shortestPathLength,
      seedPaths: this.seedPaths.map((entry) => ({ seed: entry.seed, minLength: entry.minLength }))
    };
    return copy;
  }

  public async genExtendedPaths(
    process: ProcessClass,
    triples?: TripleDocument[]
  ): Promise<ExtendedPathsResult<EndpointPathSkeleton>> {
    if (hasLiteralHead(this)) {
      return { extendedPaths: [], procTriples: [] };
    }

    // Fetch triples if not provided
    let triplesToExtend = triples;
    if (!triplesToExtend) {
      const triplesFilter = this.genExistingTriplesFilter(process);
      if (!triplesFilter) {
        return { extendedPaths: [], procTriples: [] };
      }
      triplesToExtend = await Triple.find(triplesFilter);
      if (!triplesToExtend.length) {
        return { extendedPaths: [], procTriples: [] };
      }
    }

    const urlHead: UrlHead = isUrlHead(this.head)
      ? this.head
      : {
          type: HEAD_TYPE.URL,
          url: '',
          status: 'unvisited',
          domain: { origin: '', isUnvisited: true }
        };
    if (!isUrlHead(urlHead) || !urlHead.url) {
      return { extendedPaths: [], procTriples: [] };
    }
    const procTriples: TypedTripleId[] = [];
    const processedUrlHeads = new Set<string>();
    const processedLiterals = new Set<string>();

    // Phase 1: Collect candidates using helper methods
    const namedNodeCandidates = collectNamedNodeCandidates.call(
      this,
      triplesToExtend,
      urlHead,
      process,
      procTriples,
      processedUrlHeads
    );
    const literalCandidates = collectLiteralCandidates.call(
      this,
      triplesToExtend,
      urlHead,
      procTriples,
      processedLiterals
    );

    // Phase 1b: Process blank node triples with chaining (if allowed)
    if (config.allowBlankNodes) {
      const blankNodeTriples = triplesToExtend
        .filter((t): t is BlankNodeTripleDocument => isBlankNode(t))
        .filter((t) => this.isExtensionValid(t) && this.isExtensionAllowed(t, process.currentStep));

      const followDirection = process.currentStep.followDirection;
      const predsBF = process.curPredsBranchFactor();

      for await (const { blankTriple: t, outgoing, blankNodeId } of iterateBlankNodeOutgoings(
        blankNodeTriples
      )) {
        // Check validity of outgoing triple
        if (!this.isExtensionValid(outgoing, urlHead)) continue;

        // Check extension allowed for outgoing (predicate limitations, maxPathLength)
        if (!this.isExtensionAllowed(outgoing, process.currentStep)) continue;

        // For NamedNode outgoing, also check direction and handle candidate
        if (isNamedNode(outgoing)) {
          if (!outgoing.directionOk(urlHead.url, followDirection, predsBF)) continue;

          const newHeadUrl: string =
            outgoing.subject === blankNodeId ? outgoing.object : outgoing.subject;
          if (typeof newHeadUrl !== 'string') continue;

          // Check cycle: if newHeadUrl in seedPaths or already processed
          if (this.seedPaths.some((entry) => entry.seed === newHeadUrl)) continue;
          if (processedUrlHeads.has(newHeadUrl)) continue;
          processedUrlHeads.add(newHeadUrl);

          const distance = this.shortestPathLength; // blank node hop doesn't count
          const seedPaths: Record<string, number> = {};
          for (const entry of this.seedPaths) {
            seedPaths[entry.seed] = entry.minLength; // no increment for blank node hop
          }

          namedNodeCandidates.push({ headUrl: newHeadUrl, distance, seedPaths });
          procTriples.push({ id: t._id.toString(), type: TripleType.BLANK_NODE });
          procTriples.push({ id: outgoing._id.toString(), type: TripleType.NAMED_NODE });
        }
        // For Literal outgoing
        else if (isLiteral(outgoing)) {
          const literalKey = JSON.stringify({
            value: outgoing.object.value,
            datatype: outgoing.object.datatype || '',
            language: outgoing.object.language || ''
          });
          if (processedLiterals.has(literalKey)) continue;
          processedLiterals.add(literalKey);

          const distance = this.shortestPathLength;
          const seedPaths: Record<string, number> = {};
          for (const entry of this.seedPaths) {
            seedPaths[entry.seed] = entry.minLength;
          }

          const literalHead: LiteralHead = {
            type: HEAD_TYPE.LITERAL,
            value: outgoing.object.value,
            datatype: outgoing.object.datatype,
            language: outgoing.object.language
          };
          literalCandidates.push({ literalHead, distance, seedPaths });
          procTriples.push({ id: t._id.toString(), type: TripleType.BLANK_NODE });
          procTriples.push({ id: outgoing._id.toString(), type: TripleType.LITERAL });
        }
      }
    }

    const candidates = [...namedNodeCandidates, ...literalCandidates];
    if (candidates.length === 0) {
      return { extendedPaths: [], procTriples };
    }

    // Phase 2: Separate URL and literal candidates
    const urlCandidates = candidates.filter((c) => c.headUrl !== undefined);
    const literalCandidatesOnly = candidates.filter((c) => c.literalHead !== undefined);

    // Phase 3: Query existing endpoint paths for URL heads
    const headUrls = urlCandidates
      .map((c) => c.headUrl)
      .filter((url): url is string => typeof url === 'string');
    const existingMap = await queryExistingEndpointPaths.call(this, headUrls);

    // Phase 4: Process candidates
    const extendedPaths: EndpointPathSkeleton[] = [];

    for (const candidate of urlCandidates) {
      const existing = candidate.headUrl ? existingMap.get(candidate.headUrl) : undefined;
      const newPath = await processUrlCandidate.call(this, candidate, existing);
      if (newPath) {
        extendedPaths.push(newPath);
      }
    }

    for (const candidate of literalCandidatesOnly) {
      const newPath = processLiteralCandidate.call(this, candidate);
      extendedPaths.push(newPath);
    }

    log.silly('extendWithExistingTriples result', { extendedPaths, procTriples });
    return { extendedPaths, procTriples };
  }
}

// ============================================================================
// Helper functions for genExtendedPaths
// ============================================================================

function collectNamedNodeCandidates(
  this: EndpointPathClass,
  triples: TripleDocument[],
  urlHead: UrlHead,
  process: ProcessClass,
  procTriples: TypedTripleId[],
  processedUrlHeads: Set<string>
): Candidate[] {
  const candidates: Candidate[] = [];
  const followDirection = process.currentStep.followDirection;
  const predsBF = process.curPredsBranchFactor();

  const namedNodeTriples = triples
    .filter((t): t is NamedNodeTripleDocument => isNamedNode(t))
    .filter((t): t is NamedNodeTripleDocument => typeof t.object === 'string')
    .filter(
      (t) =>
        this.isExtensionValid(t, urlHead) &&
        this.isExtensionAllowed(t, process.currentStep) &&
        t.directionOk(urlHead.url, followDirection, predsBF)
    );

  for (const t of namedNodeTriples) {
    const newHeadUrl: string =
      typeof t.object === 'string' && t.subject === urlHead.url ? t.object : t.subject;

    // Simple cycle check: skip if extending to any seed URL
    if (this.seedPaths.some((entry) => entry.seed === newHeadUrl)) {
      continue;
    }

    // Out of bounds check
    if (this.tripleIsOutOfBounds(t, process)) {
      continue;
    }

    // Dedup within batch
    if (processedUrlHeads.has(newHeadUrl)) {
      procTriples.push({ id: t._id.toString(), type: TripleType.NAMED_NODE });
      continue;
    }
    processedUrlHeads.add(newHeadUrl);

    const distance = this.shortestPathLength + 1;
    const seedPaths: Record<string, number> = {};
    for (const entry of this.seedPaths) {
      seedPaths[entry.seed] = entry.minLength + 1;
    }

    candidates.push({ headUrl: newHeadUrl, distance, seedPaths });
    procTriples.push({ id: t._id.toString(), type: TripleType.NAMED_NODE });
  }

  return candidates;
}

function collectLiteralCandidates(
  this: EndpointPathClass,
  triples: TripleDocument[],
  urlHead: UrlHead,
  procTriples: TypedTripleId[],
  processedLiterals: Set<string>
): Candidate[] {
  const candidates: Candidate[] = [];

  const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
  const RDFS_COMMENT = 'http://www.w3.org/2000/01/rdf-schema#comment';

  const literalTriples = triples
    .filter((t): t is LiteralTripleDocument => isLiteral(t))
    .filter((t) => this.isExtensionValid(t, urlHead));

  for (const t of literalTriples) {
    const literalKey = JSON.stringify({
      value: t.object.value,
      datatype: t.object.datatype || '',
      language: t.object.language || ''
    });

    if (processedLiterals.has(literalKey)) {
      // Only add rdfs:label and rdfs:comment to procTriples
      if (t.predicate === RDFS_LABEL || t.predicate === RDFS_COMMENT) {
        procTriples.push({ id: t._id.toString(), type: TripleType.LITERAL });
      }
      continue;
    }
    processedLiterals.add(literalKey);

    const distance = this.shortestPathLength + 1;
    const seedPaths: Record<string, number> = {};
    for (const entry of this.seedPaths) {
      seedPaths[entry.seed] = entry.minLength + 1;
    }

    const literalHead: LiteralHead = {
      type: HEAD_TYPE.LITERAL,
      value: t.object.value,
      datatype: t.object.datatype,
      language: t.object.language
    };

    candidates.push({ literalHead, distance, seedPaths });
    // Only add rdfs:label and rdfs:comment to procTriples
    if (t.predicate === RDFS_LABEL || t.predicate === RDFS_COMMENT) {
      procTriples.push({ id: t._id.toString(), type: TripleType.LITERAL });
    }
  }

  return candidates;
}

async function queryExistingEndpointPaths(
  this: EndpointPathClass,
  headUrls: string[]
): Promise<Map<string, EndpointPathDocument>> {
  if (headUrls.length === 0) {
    return Promise.resolve(new Map<string, EndpointPathDocument>());
  }

  const existing = await EndpointPath.find({
    processId: this.processId,
    'head.url': { $in: headUrls }
  });
  const map = new Map<string, EndpointPathDocument>();
  for (const ep of existing) {
    const head = ep.head;
    if (isUrlHead(head) && head.url) {
      map.set(head.url, ep);
    }
  }
  return map;
}

/**
 * Processes a single URL candidate by either updating an existing endpoint path or creating a new one.
 * For existing paths, it performs a read-modify-write to merge seed path information and update the shortest path length if necessary.
 * For new paths, it validates the URL and constructs a new EndpointPathSkeleton.
 * @param candidate - The candidate containing headUrl, distance, and seedPaths information.
 * @param existing - An optional existing EndpointPathDocument that matches the candidate's headUrl.
 * @returns A Promise that resolves to an updated or new EndpointPathSkeleton, or null if no changes were made or if the URL was invalid.
 */

async function processUrlCandidate(
  this: EndpointPathClass,
  candidate: Candidate,
  existing: EndpointPathDocument | undefined
): Promise<EndpointPathSkeleton | null> {
  const { distance, seedPaths } = candidate;

  if (existing) {
    // Read-modify-write to avoid dot-notation conflicts with seed URLs containing dots
    const existingDoc = await EndpointPath.findById(existing._id).exec();
    if (!existingDoc) {
      log.warn('Existing path document not found', { _id: existing._id });
      return null;
    }
    // Build a map of current seedPaths for fast lookup
    const seedPathMap = new Map<string, number>();
    for (const entry of existingDoc.seedPaths) {
      seedPathMap.set(entry.seed, entry.minLength);
    }
    // Merge new seed distances using min
    let changed = false;
    for (const [seed, dist] of Object.entries(seedPaths)) {
      const current = seedPathMap.get(seed);
      if (current === undefined || dist < current) {
        seedPathMap.set(seed, dist);
        changed = true;
      }
    }
    // Update shortestPathLength if the new distance is shorter
    if (distance < existingDoc.shortestPathLength) {
      existingDoc.shortestPathLength = distance;
      changed = true;
    }
    if (changed) {
      existingDoc.seedPaths = Array.from(seedPathMap.entries()).map(([seed, minLength]) => ({
        seed,
        minLength
      }));
      return existingDoc.save().then(() => {
        log.silly('Updated existing endpoint path (read-modify-write)', {
          _id: existing._id,
          shortestPathLength: existingDoc.shortestPathLength,
          seedPathsCount: existingDoc.seedPaths.length
        });
        return existingDoc.copy();
      });
    } else {
      log.silly('No changes to existing endpoint path', { _id: existing._id });
      return null;
    }
  } else {
    // Create new endpoint path
    if (!candidate.headUrl) {
      log.warn('Candidate missing headUrl, skipping', { candidate });
      return Promise.resolve(null);
    }
    let domain: string;
    try {
      domain = new URL(candidate.headUrl).origin;
    } catch (err) {
      log.warn('Invalid headUrl, skipping candidate', { headUrl: candidate.headUrl, error: err });
      return Promise.resolve(null);
    }
    const head: UrlHead = {
      type: HEAD_TYPE.URL,
      url: candidate.headUrl,
      status: 'unvisited',
      domain: {
        origin: domain,
        isUnvisited: true // this will be updated before saving
      }
    };
    const newPath: EndpointPathSkeleton = {
      _id: new Types.ObjectId(),
      processId: this.processId,
      type: PathType.ENDPOINT,
      head,
      status: 'active',
      shortestPathLength: distance,
      seedPaths: Object.entries(seedPaths).map(([seed, minLength]) => ({ seed, minLength })),
      extensionCounter: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    log.silly('Created new endpoint path', newPath);
    return Promise.resolve(newPath);
  }
}

function processLiteralCandidate(
  this: EndpointPathClass,
  candidate: Candidate
): EndpointPathSkeleton {
  const { literalHead, distance, seedPaths } = candidate;
  if (!literalHead) {
    throw new Error('processLiteralCandidate called without literalHead');
  }
  const pathId = new Types.ObjectId();

  const newPath: EndpointPathSkeleton = {
    _id: pathId,
    processId: this.processId,
    type: PathType.ENDPOINT,
    head: literalHead,
    status: 'active',
    shortestPathLength: distance,
    seedPaths: Object.entries(seedPaths).map(([seed, minLength]) => ({ seed, minLength })),
    extensionCounter: 0,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  log.silly('Created new literal endpoint path', newPath);
  return newPath;
}

export const EndpointPath = getDiscriminatorModelForClass(
  Path,
  EndpointPathClass,
  PathType.ENDPOINT
);

export type EndpointPathDocument = DocumentType<EndpointPathClass>;
