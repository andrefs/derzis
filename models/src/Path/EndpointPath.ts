import { Types, type QueryFilter } from 'mongoose';
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
import { PathType, TripleType, type TypedTripleId } from '@derzis/common';
import { type RecursivePartial } from '@derzis/common';
import { createLogger } from '@derzis/common/server';
const log = createLogger('EndpointPath');

// SeedPathEntry class for tracking seed distances
class SeedPathEntryClass {
  @prop({ type: String, required: true })
  public seed!: string;

  @prop({ type: Number, required: true, min: 1 })
  public minLength!: number;
}

interface Candidate {
  triple: TripleDocument;
  headUrl?: string;
  literalHead?: LiteralHead;
  distance: number;
  seedPaths: Record<string, number>; // temporary during extend, will convert to array
}

export type EndpointPathSkeleton = Pick<
  EndpointPathClass,
  'processId' | 'head' | 'type' | 'status'
> &
  RecursivePartial<EndpointPathClass> & {
    shortestPathLength: number;
    frontier: boolean;
    seedPaths: Array<{ seed: string; minLength: number }>;
  };

@index({ processId: 1 })
@index({ createdAt: 1, _id: 1 })
@index(
  { processId: 1, 'head.url': 1 },
  {
    unique: true,
    partialFilterExpression: { 'head.type': HEAD_TYPE.URL }
  }
)
@index({ status: 1 })
@index({ 'head.url': 1, status: 1 })
@index({ 'head.status': 1, status: 1 })
@index({ type: 1, 'head.domain': 1, status: 1 })
// Optimized index for endpoint path queries with head.domain and shortestPathLength sort
@index({
  processId: 1,
  status: 1,
  'head.type': 1,
  'head.domain': 1,
  shortestPathLength: 1,
  createdAt: 1,
  _id: 1
})
export class EndpointPathClass extends PathClass {
  @prop({ required: true, type: Boolean, default: false })
  public frontier!: boolean;

  @prop({ required: true, type: Number, default: 0 })
  public shortestPathLength!: number;

  // SeedPathEntryClass is defined above for subdocument array
  @prop({ required: true, default: [], type: [SeedPathEntryClass] })
  public seedPaths!: SeedPathEntryClass[];

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
    return this.shortestPathLength >= process.currentStep.maxPathLength;
  }

  public genExistingTriplesFilter(process: ProcessClass): QueryFilter<NamedNodeTripleClass> | null {
    if (this.head.type !== HEAD_TYPE.URL) {
      return null;
    }
    const urlHead = this.head as UrlHead;
    return {
      nodes: urlHead.url
    };
  }

  public copy(this: EndpointPathClass): EndpointPathSkeleton {
    const copy: EndpointPathSkeleton = {
      processId: this.processId,
      type: PathType.ENDPOINT,
      head: this.head as Head,
      status: this.status,
      shortestPathLength: this.shortestPathLength,
      frontier: this.frontier,
      seedPaths: this.seedPaths.map((entry) => ({ seed: entry.seed, minLength: entry.minLength }))
    };
    return copy;
  }

  public async genExtendedPaths(
    process: ProcessClass,
    triples?: TripleDocument[]
  ): Promise<{ extendedPaths: EndpointPathSkeleton[]; procTriples: TypedTripleId[] }> {
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

    const urlHead = this.head as UrlHead;
    const procTriples: TypedTripleId[] = [];
    const processedUrlHeads = new Set<string>();
    const processedLiterals = new Set<string>();
    const predsDirMetrics = process.curPredsDirMetrics();
    const followDirection = process.currentStep.followDirection;

    // Phase 1: Collect candidates
    const candidates: Array<{
      headUrl?: string;
      literalHead?: LiteralHead;
      distance: number;
      seedPaths: Record<string, number>;
    }> = [];

    // Named node triples (URL extensions)
    const namedNodeTriples = triplesToExtend
      .filter((t): t is NamedNodeTripleDocument => isNamedNode(t))
      .filter((t): t is NamedNodeTripleDocument => typeof t.object === 'string')
      .filter(
        (t) =>
          this.shouldCreateNewPath(t, urlHead) &&
          process?.whiteBlackListsAllow(t) &&
          t.directionOk(urlHead.url, followDirection, predsDirMetrics)
      );

    for (const t of namedNodeTriples) {
      const newHeadUrl: string = t.subject === urlHead.url ? t.object! : t.subject;

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

    // Literal triples
    const literalTriples = triplesToExtend
      .filter((t): t is LiteralTripleDocument => isLiteral(t))
      .filter((t) => this.shouldCreateNewPath(t, urlHead));

    for (const t of literalTriples) {
      const literalKey = JSON.stringify({
        value: t.object.value,
        datatype: t.object.datatype || '',
        language: t.object.language || ''
      });

      if (processedLiterals.has(literalKey)) {
        procTriples.push({ id: t._id.toString(), type: TripleType.LITERAL });
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
      procTriples.push({ id: t._id.toString(), type: TripleType.LITERAL });
    }

    if (candidates.length === 0) {
      return { extendedPaths: [], procTriples };
    }

    // Phase 2: Separate URL and literal candidates
    const urlCandidates = candidates.filter((c) => c.headUrl !== undefined);
    const literalCandidates = candidates.filter((c) => c.literalHead !== undefined);

    // Phase 3: Query existing endpoint paths for URL heads
    const headUrls = urlCandidates.map((c) => c.headUrl!);
    const existingMap = new Map<string, EndpointPathDocument>();

    if (headUrls.length > 0) {
      const existing = await EndpointPath.find({
        processId: this.processId,
        status: 'active',
        'head.url': { $in: headUrls }
      }).exec();

      for (const ep of existing) {
        const head = ep.head as any;
        if (head?.url) {
          existingMap.set(head.url, ep as EndpointPathDocument);
        }
      }
    }

    // Phase 4: Process candidates
    const extendedPaths: EndpointPathSkeleton[] = [];

    // URL candidates: update existing or create new
    for (const candidate of urlCandidates) {
      const { headUrl, distance, seedPaths } = candidate;
      const existing = existingMap.get(headUrl!);

      if (existing) {
        // Read-modify-write to avoid dot-notation conflicts with seed URLs containing dots
        // Fetch full document (not lean) so we can modify and save
        const existingDoc = await EndpointPath.findById(existing._id).exec();
        if (!existingDoc) {
          log.warn('Existing path document not found', { _id: existing._id });
          continue;
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
          await existingDoc.save();
          log.silly('Updated existing endpoint path (read-modify-write)', {
            _id: existing._id,
            shortestPathLength: existingDoc.shortestPathLength,
            seedPathsCount: existingDoc.seedPaths.length
          });
        } else {
          log.silly('No changes to existing endpoint path', { _id: existing._id });
        }
      } else {
        // Create new endpoint path
        const pathId = new Types.ObjectId();
        let domain: string;
        try {
          domain = new URL(headUrl!).origin;
        } catch (err) {
          log.warn('Invalid headUrl, skipping candidate', { headUrl: headUrl, error: err });
          continue;
        }
        const newPath: EndpointPathSkeleton = {
          _id: pathId,
          processId: this.processId,
          type: PathType.ENDPOINT,
          head: {
            type: HEAD_TYPE.URL,
            url: headUrl!,
            status: 'unvisited',
            domain
          } as Head,
          status: 'active',
          frontier: true,
          shortestPathLength: distance,
          seedPaths: Object.entries(seedPaths).map(([seed, minLength]) => ({ seed, minLength })),
          extensionCounter: 0,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        extendedPaths.push(newPath);
        log.silly('Created new endpoint path', newPath);
      }
    }

    // Literal candidates: always create new
    for (const candidate of literalCandidates) {
      const { literalHead, distance, seedPaths } = candidate;
      const pathId = new Types.ObjectId();

      const newPath: EndpointPathSkeleton = {
        _id: pathId,
        processId: this.processId,
        type: PathType.ENDPOINT,
        head: literalHead! as Head,
        status: 'active',
        frontier: true,
        shortestPathLength: distance,
        seedPaths: Object.entries(seedPaths).map(([seed, minLength]) => ({ seed, minLength })),
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
}

export const EndpointPath = getDiscriminatorModelForClass(
  Path,
  EndpointPathClass,
  PathType.ENDPOINT
);

export type EndpointPathDocument = DocumentType<EndpointPathClass>;
