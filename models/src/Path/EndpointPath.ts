import { Types, Document, FilterQuery } from 'mongoose';
import { prop, index, getModelForClass } from '@typegoose/typegoose';
import { TripleClass, Triple, type TripleDocument } from '../Triple';
import { ProcessClass } from '../Process';
import { PathClass } from './Path';
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
@index({ type: 1 })
@index({ 'seed.url': 1, 'head.url': 1 })
@index({ 'head.url': 1 }, { unique: true })
@index({ status: 1 })
@index({ 'head.url': 1, status: 1 })
@index({ 'head.status': 1, status: 1 })
@index({ 'head.domain.status': 1, status: 1 })
@index({ processId: 1, 'head.url': 1 })
class EndpointPathClass extends PathClass {
  @prop({ required: true, type: Boolean, default: false })
  public frontier!: boolean;

  @prop({ required: true, type: ShortestPathInfo })
  public shortestPath!: ShortestPathInfo;

  @prop({ required: true, type: Object, default: {} })
  public seedPaths!: { [seedUrl: string]: number };

  // type is always 'endpoint' for this class
  @prop({ enum: ['endpoint'], required: true, type: String, default: 'endpoint' })
  public type!: 'endpoint';

  public shouldCreateNewPath(this: EndpointPathClass, t: TripleClass): boolean {
    if (t.subject === t.object) {
      return false;
    }

    if (t.predicate === this.head.url) {
      return false;
    }

    return true;
  }

  public tripleIsOutOfBounds(t: TripleClass, process: ProcessClass): boolean {
    return this.shortestPath.length + 1 > process.currentStep.maxPathLength;
  }

  public genExistingTriplesFilter(process: ProcessClass): FilterQuery<TripleClass> {

    console.log('XXXXXXXXXXXXXX EndpointPath genExistingTriplesFilter');
    return {
      processId: this.processId,
      nodes: this.head.url
    };
  }

  public async extendWithExistingTriples(
    process: ProcessClass
  ): Promise<{ extendedPaths: EndpointPathSkeleton[]; procTriples: Types.ObjectId[] }> {
    const triplesFilter = this.genExistingTriplesFilter(process);
    let triples: TripleDocument[] = await Triple.find(triplesFilter);
    if (!triples.length) {
      return { extendedPaths: [], procTriples: [] };
    }
    return this.genExtended(triples, process) as Promise<{
      extendedPaths: EndpointPathSkeleton[];
      procTriples: Types.ObjectId[];
    }>;
  }

  public copy(this: EndpointPathClass): EndpointPathSkeleton {
    const copy: EndpointPathSkeleton = {
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
      status: this.status,
      shortestPath: { length: this.shortestPath.length, seed: this.shortestPath.seed },
      frontier: this.frontier,
      seedPaths: { ...this.seedPaths }
    };
    return copy;
  }

  public async genExtended(
    triples: TripleClass[],
    process: ProcessClass
  ): Promise<{ extendedPaths: EndpointPathSkeleton[]; procTriples: Types.ObjectId[] }> {
    let extendedPaths: { [prop: string]: { [newHead: string]: EndpointPathSkeleton } } = {};
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

        procTriples.push(t._id);
        log.silly('New path', ep);
        extendedPaths[prop][newHeadUrl] = ep;
      }
    }

    const eps: EndpointPathSkeleton[] = [];
    Object.values(extendedPaths).forEach((x) => Object.values(x).forEach((y) => eps.push(y)));

    log.silly('Extended paths', eps);
    return { extendedPaths: eps, procTriples };
  }
}

const EndpointPath = getModelForClass(EndpointPathClass, {
  schemaOptions: { timestamps: true, collection: 'endpointPaths' }
});

type EndpointPathDocument = EndpointPathClass & Document;

export { EndpointPath, EndpointPathClass, type EndpointPathDocument };
