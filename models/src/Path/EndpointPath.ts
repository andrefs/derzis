import { Types, type FilterQuery } from 'mongoose';
import { prop, index, getDiscriminatorModelForClass, DocumentType } from '@typegoose/typegoose';
import { NamedNodeTripleClass, NamedNodeTriple, type NamedNodeTripleDocument } from '../Triple';
import { ProcessClass } from '../Process';
import { PathClass, Path } from './Path';
import { PathType, type TypedTripleId, TripleType } from '@derzis/common';
import { type RecursivePartial } from '@derzis/common';
import { createLogger } from '@derzis/common/server';
const log = createLogger('EndpointPath');

class ShortestPathInfo {
  @prop({ required: true, type: Number, default: 0 })
  public length!: number;

  @prop({ required: true, type: String })
  public seed!: string;
}

export type EndpointPathSkeleton = Pick<
  EndpointPathClass,
  'processId' | 'seed' | 'head' | 'type' | 'status'
> &
  RecursivePartial<EndpointPathClass> & {
    shortestPath: ShortestPathInfo;
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
@index({ 'head.domain.status': 1, status: 1 })
@index({ processId: 1, 'head.url': 1 })
export class EndpointPathClass extends PathClass {
  @prop({ required: true, type: Boolean, default: false })
  public frontier!: boolean;

  @prop({ required: true, type: ShortestPathInfo })
  public shortestPath!: ShortestPathInfo;

  @prop({ required: true, type: Object, default: {} })
  public seedPaths!: { [seedUrl: string]: number };


  @prop({ enum: PathType, required: true, type: String })
  public type!: PathType.ENDPOINT;

  public shouldCreateNewPath(this: EndpointPathClass, t: NamedNodeTripleClass): boolean {
    if (t.subject === t.object) {
      return false;
    }

    if (t.predicate === this.head.url) {
      return false;
    }

    return true;
  }

  public tripleIsOutOfBounds(t: NamedNodeTripleClass, process: ProcessClass): boolean {
    return this.shortestPath.length + 1 > process.currentStep.maxPathLength;
  }

  public genExistingTriplesFilter(process: ProcessClass): FilterQuery<NamedNodeTripleClass> | null {
    return {
      processId: this.processId,
      nodes: this.head.url
    };
  }



  public copy(this: EndpointPathClass): EndpointPathSkeleton {
    const copy: EndpointPathSkeleton = {
      processId: this.processId,
      type: PathType.ENDPOINT,
      seed: {
        url: this.seed.url
      },
      head: {
        url: this.head.url,
        status: this.head.status,
        domain: { origin: this.head.domain.origin, status: this.head.domain.status }
      },
      status: this.status,
      shortestPath: { length: this.shortestPath.length, seed: this.shortestPath.seed },
      frontier: this.frontier,
      seedPaths: { ...this.seedPaths }
    };
    return copy;
  }

  public async genExtended(
    triples: NamedNodeTripleDocument[],
    process: ProcessClass
  ): Promise<{ extendedPaths: EndpointPathSkeleton[]; procTriples: TypedTripleId[] }> {
    let extendedPaths: { [prop: string]: { [newHead: string]: EndpointPathSkeleton } } = {};
    let procTriples: TypedTripleId[] = [];
    const predsDirMetrics = process.curPredsDirMetrics();
    const followDirection = process!.currentStep.followDirection;

    for (const t of triples.filter(
      (t) =>
        typeof t.object === 'string' &&
        this.shouldCreateNewPath(t) &&
        process?.whiteBlackListsAllow(t) &&
        t.directionOk(this.head.url, followDirection, predsDirMetrics)
    )) {
      log.silly('Extending path with triple', t);
      const newHeadUrl: string = t.subject === this.head.url ? t.object! : t.subject;
      const prop = t.predicate;

      extendedPaths[prop] = extendedPaths[prop] || {};
      if (!extendedPaths[prop][newHeadUrl] && !this.tripleIsOutOfBounds(t, process!)) {
        const seedPaths = {
          ...this.seedPaths,
          [newHeadUrl]: (this.seedPaths[newHeadUrl] || 0) + 1
        };
        const shortestPath = Object.entries(seedPaths).reduce(
          (shortest, [seedUrl, count]) => {
            if (count > 0 && (shortest.length === 0 || count < shortest.length)) {
              return { length: count, seed: seedUrl };
            }
            return shortest;
          },
          { length: 0, seed: '' }
        );
        const ep = this.copy();
        ep.head.url = newHeadUrl;
        ep.head.status = 'unvisited';
        ep.head.domain.status = this.head.domain.status;
        ep.shortestPath = shortestPath;
        ep.seedPaths = seedPaths;
        ep.frontier = true;
        ep.status = 'active';

        procTriples.push({ id: t._id.toString(), type: TripleType.NAMED_NODE });
        log.silly('New path', ep);
        extendedPaths[prop][newHeadUrl] = ep;
      }
    }

    const eps: EndpointPathSkeleton[] = [];
    Object.values(extendedPaths).forEach((x) => Object.values(x).forEach((y) => eps.push(y)));

    log.silly('Extended paths', eps);
    return { extendedPaths: eps, procTriples };
  }

  public async extendWithExistingTriples(
    process: ProcessClass
  ): Promise<{ extendedPaths: EndpointPathSkeleton[]; procTriples: TypedTripleId[] }> {
    const triplesFilter = this.genExistingTriplesFilter(process);
    if (!triplesFilter) {
      return { extendedPaths: [], procTriples: [] };
    }
    let triples: NamedNodeTripleDocument[] = await NamedNodeTriple.find(triplesFilter);
    if (!triples.length) {
      return { extendedPaths: [], procTriples: [] };
    }
    log.silly(`Extending path ${this._id} with existing ${triples.length} triples`);
    return this.genExtended(triples, process);
  }
}

export const EndpointPath = getDiscriminatorModelForClass(Path, EndpointPathClass, PathType.ENDPOINT);

export type EndpointPathDocument = DocumentType<EndpointPathClass>;

