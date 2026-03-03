import { type QueryFilter, Types } from 'mongoose';
import {
  prop,
  index,
  getDiscriminatorModelForClass,
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
import { ProcessClass } from '../Process';
import {
  PathClass,
  Path,
  hasLiteralHead,
  HEAD_TYPE,
  UrlHead,
  type Head,
  type LiteralHead
} from './Path';
import { PathType, type TypedTripleId, TripleType } from '@derzis/common';
import { type RecursivePartial } from '@derzis/common';
import { createLogger } from '@derzis/common/server';
const log = createLogger('EndpointPath');

interface Candidate {
  triple: TripleDocument;
  headUrl?: string;
  literalHead?: LiteralHead;
  distance: number;
  seedPaths: Record<string, number>;
}

export type EndpointPathSkeleton = Pick<
  EndpointPathClass,
  'processId' | 'seed' | 'head' | 'type' | 'status'
> &
  RecursivePartial<EndpointPathClass> & {
    shortestPathLength: number;
    frontier: boolean;
    seedPaths: { [seedUrl: string]: number };
  };

@index({ processId: 1 })
// For keyset pagination (cursor-based pagination)
@index({ createdAt: 1, _id: 1 })
@index({ 'seed.url': 1, 'head.url': 1 })
@index({ 'head.url': 1 }, { unique: true })
@index({ status: 1 })
@index({ 'head.url': 1, status: 1 })
@index({ 'head.status': 1, status: 1 })
@index({ type: 1, 'head.domain': 1, status: 1 })
@index({ processId: 1, 'head.url': 1 })
export class EndpointPathClass extends PathClass {
  @prop({ required: true, type: Boolean, default: false })
  public frontier!: boolean;

  @prop({ required: true, type: Number, default: 0 })
  public shortestPathLength!: number;

  @prop({ required: true, type: Object, default: {} })
  public seedPaths!: { [seedUrl: string]: number };

  public shouldCreateNewPath(
    this: EndpointPathClass,
    t: NamedNodeTripleClass | LiteralTripleDocument,
    urlHead: UrlHead
  ): boolean {
    if (t.type === TripleType.LITERAL) {
      if (t.predicate === urlHead.url) {
        return false;
      }
      return true;
    }

    if (t.subject === t.object) {
      return false;
    }

    if (t.predicate === urlHead.url) {
      return false;
    }

    return true;
  }

  public tripleIsOutOfBounds(t: NamedNodeTripleClass, process: ProcessClass): boolean {
    return this.shortestPathLength + 1 > process.currentStep.maxPathLength;
  }

  public genExistingTriplesFilter(process: ProcessClass): QueryFilter<NamedNodeTripleClass> | null {
    if (this.head.type !== HEAD_TYPE.URL) {
      return null;
    }
    const urlHead = this.head as UrlHead;
    return {
      processId: this.processId,
      nodes: urlHead.url
    };
  }

  public copy(this: EndpointPathClass): EndpointPathSkeleton {
    const copy: EndpointPathSkeleton = {
      processId: this.processId,
      type: PathType.ENDPOINT,
      seed: {
        url: this.seed.url
      },
      head: this.head as Head,
      status: this.status,
      shortestPathLength: this.shortestPathLength,
      frontier: this.frontier,
      seedPaths: { ...this.seedPaths }
    };
    return copy;
  }

  public async genExtended(
    triples: TripleDocument[],
    process: ProcessClass
  ): Promise<{ candidates: Candidate[]; procTriples: TypedTripleId[] }> {
    if (this.head.type !== HEAD_TYPE.URL) {
      return { candidates: [], procTriples: [] };
    }

    const urlHead = this.head as UrlHead;
    const candidates: Candidate[] = [];
    const procTriples: TypedTripleId[] = [];
    const processedUrlHeads = new Set<string>();
    const processedLiterals = new Set<string>();
    const predsDirMetrics = process.curPredsDirMetrics();
    const followDirection = process.currentStep.followDirection;

    const namedNodeTriples = triples
      .filter((t): t is NamedNodeTripleDocument => isNamedNode(t))
      .filter((t): t is NamedNodeTripleDocument => typeof t.object === 'string')
      .filter(
        (t) =>
          this.shouldCreateNewPath(t, urlHead) &&
          process?.whiteBlackListsAllow(t) &&
          t.directionOk(urlHead.url, followDirection, predsDirMetrics)
      );

    for (const t of namedNodeTriples) {
      log.silly('Evaluating NamedNodeTriple for extension', t);
      const newHeadUrl: string = t.subject === urlHead.url ? t.object! : t.subject;

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
      for (const [seed, dist] of Object.entries(this.seedPaths)) {
        seedPaths[seed] = dist + 1;
      }

      candidates.push({ triple: t, headUrl: newHeadUrl, distance, seedPaths });
      procTriples.push({ id: t._id.toString(), type: TripleType.NAMED_NODE });
      log.silly('Candidate URL extension', { headUrl: newHeadUrl, distance, seedPaths });
    }

    const literalTriples = triples
      .filter((t): t is LiteralTripleDocument => isLiteral(t))
      .filter((t) => this.shouldCreateNewPath(t, urlHead));

    for (const t of literalTriples) {
      log.silly('Evaluating LiteralTriple for extension', t);
      const literalKey = JSON.stringify({
        value: t.object.value,
        datatype: t.object.datatype || '',
        language: t.object.language || ''
      });

      // Dedup within batch
      if (processedLiterals.has(literalKey)) {
        procTriples.push({ id: t._id.toString(), type: TripleType.LITERAL });
        continue;
      }
      processedLiterals.add(literalKey);

      const distance = this.shortestPathLength + 1;
      const seedPaths: Record<string, number> = {};
      for (const [seed, dist] of Object.entries(this.seedPaths)) {
        seedPaths[seed] = dist + 1;
      }

      const literalHead: LiteralHead = {
        type: HEAD_TYPE.LITERAL,
        value: t.object.value,
        datatype: t.object.datatype,
        language: t.object.language
      };

      candidates.push({ triple: t, literalHead, distance, seedPaths });
      procTriples.push({ id: t._id.toString(), type: TripleType.LITERAL });
      log.silly('Candidate literal extension', { literalHead, distance, seedPaths });
    }

    log.silly('genExtended candidates', { candidates, procTriples });
    return { candidates, procTriples };
  }

  public async extendWithExistingTriples(
    process: ProcessClass
  ): Promise<{ extendedPaths: EndpointPathSkeleton[]; procTriples: TypedTripleId[] }> {
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

    const { candidates, procTriples } = await this.genExtended(triples, process);
    const extendedPaths: EndpointPathSkeleton[] = [];

    if (candidates.length === 0) {
      return { extendedPaths, procTriples };
    }

    // Separate URL and literal candidates
    const urlCandidates = candidates.filter(c => c.headUrl !== undefined);
    const literalCandidates = candidates.filter(c => c.literalHead !== undefined);

    // Query existing active EndpointPaths for URL heads
    const headUrls = urlCandidates.map(c => c.headUrl!);
    const existingMap = new Map<string, EndpointPathDocument>();

    if (headUrls.length > 0) {
      const existing = await EndpointPath.find({
        processId: this.processId,
        status: 'active',
        'head.url': { $in: headUrls }
      }).lean().exec();

      for (const ep of existing) {
        existingMap.set(ep.head.url, ep as EndpointPathDocument);
      }
    }

    // Process URL candidates: update existing or create new
    for (const candidate of urlCandidates) {
      const { headUrl, distance, seedPaths } = candidate;
      const existing = existingMap.get(headUrl);

      if (existing) {
        // Atomic $min updates
        const updateOp: Record<string, any> = { 'shortestPathLength': distance };
        for (const [seed, dist] of Object.entries(seedPaths)) {
          updateOp[`seedPaths.${seed}`] = dist;
        }
        await EndpointPath.updateOne(
          { _id: existing._id },
          { $min: updateOp }
        );
        log.silly('Updated existing endpoint path', { _id: existing._id, updateOp });
      } else {
        // Create new endpoint path
        const pathId = new Types.ObjectId();
        const domain = new URL(headUrl).origin;
        const newPath: EndpointPathSkeleton = {
          _id: pathId,
          processId: this.processId,
          seed: this.seed,
          head: {
            type: HEAD_TYPE.URL,
            url: headUrl,
            status: 'unvisited',
            domain
          },
          status: 'active',
          frontier: true,
          shortestPathLength: distance,
          seedPaths,
          extensionCounter: 0,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        extendedPaths.push(newPath);
        log.silly('Created new endpoint path', newPath);
      }
    }

    // Process literal candidates: always create new
    for (const candidate of literalCandidates) {
      const { literalHead, distance, seedPaths } = candidate;
      const pathId = new Types.ObjectId();

      // Find the seed with minimum distance for this candidate
      let minDist = Infinity;
      let shortestSeed = '';
      for (const [seed, dist] of Object.entries(seedPaths)) {
        if (dist < minDist) {
          minDist = dist;
          shortestSeed = seed;
        }
      }

      const newPath: EndpointPathSkeleton = {
        _id: pathId,
        processId: this.processId,
        seed: this.seed,
        head: literalHead,
        status: 'active',
        frontier: true,
        shortestPathLength: distance,
        seedPaths,
        extensionCounter: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      extendedPaths.push(newPath);
      log.silly('Created new literal endpoint path', newPath);
    }

    log.silly('extendWithExistingTriples result', { extendedPaths, procTriples });
    return { extendedPaths, procTriples };
  }

  public async extendWithExistingTriples(
    process: ProcessClass
  ): Promise<{ extendedPaths: EndpointPathSkeleton[]; procTriples: TypedTripleId[] }> {
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

export const EndpointPath = getDiscriminatorModelForClass(
  Path,
  EndpointPathClass,
  PathType.ENDPOINT
);

export type EndpointPathDocument = DocumentType<EndpointPathClass>;
