import { Types, type FilterQuery } from 'mongoose';
import { prop, index, getDiscriminatorModelForClass, DocumentType } from '@typegoose/typegoose';
import { NamedNodeTripleClass, NamedNodeTriple, type NamedNodeTripleDocument, LiteralTriple, type LiteralTripleDocument } from '../Triple';
import { ProcessClass } from '../Process';
import { PathClass, Path, hasLiteralHead, HEAD_TYPE, UrlHead, LiteralHead, type Head } from './Path';
import { PathType, type TypedTripleId, TripleType, type LiteralObject } from '@derzis/common';
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
@index({ type: 1, 'head.domain.status': 1, status: 1 })
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

  public shouldCreateNewPath(this: EndpointPathClass, t: NamedNodeTripleClass | LiteralTripleDocument, urlHead: UrlHead): boolean {
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
    return this.shortestPath.length + 1 > process.currentStep.maxPathLength;
  }

  public genExistingTriplesFilter(process: ProcessClass): FilterQuery<NamedNodeTripleClass> | null {
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
    let headCopy: Head;
    if (this.head.type === HEAD_TYPE.LITERAL) {
      headCopy = {
        type: HEAD_TYPE.LITERAL,
        value: (this.head as LiteralHead).value,
        datatype: (this.head as LiteralHead).datatype,
        language: (this.head as LiteralHead).language
      };
    } else {
      const urlHead = this.head as UrlHead;
      headCopy = {
        type: HEAD_TYPE.URL,
        url: urlHead.url,
        status: urlHead.status,
        domain: { origin: urlHead.domain.origin, status: urlHead.domain.status }
      };
    }

    const copy: EndpointPathSkeleton = {
      processId: this.processId,
      type: PathType.ENDPOINT,
      seed: {
        url: this.seed.url
      },
      head: headCopy,
      status: this.status,
      shortestPath: { length: this.shortestPath.length, seed: this.shortestPath.seed },
      frontier: this.frontier,
      seedPaths: { ...this.seedPaths }
    };
    return copy;
  }

  public async genExtended(
    triples: (NamedNodeTripleDocument | LiteralTripleDocument)[],
    process: ProcessClass
  ): Promise<{ extendedPaths: EndpointPathSkeleton[]; procTriples: TypedTripleId[] }> {
    if (this.head.type !== HEAD_TYPE.URL) {
      return { extendedPaths: [], procTriples: [] };
    }

    const urlHead = this.head as UrlHead;
    let extendedPaths: { [prop: string]: { [newHead: string]: EndpointPathSkeleton } } = {};
    let procTriples: TypedTripleId[] = [];
    const predsDirMetrics = process.curPredsDirMetrics();
    const followDirection = process!.currentStep.followDirection;

    const namedNodeTriples = triples
      .filter((t): t is NamedNodeTripleDocument => t.type === TripleType.NAMED_NODE && typeof t.object === 'string')
      .filter(t =>
        this.shouldCreateNewPath(t, urlHead) &&
        process?.whiteBlackListsAllow(t) &&
        t.directionOk(urlHead.url, followDirection, predsDirMetrics)
      );

    for (const t of namedNodeTriples) {
      log.silly('Extending path with NamedNodeTriple', t);
      const newHeadUrl: string = t.subject === urlHead.url ? t.object! : t.subject;
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
        ep.head = {
          type: HEAD_TYPE.URL,
          url: newHeadUrl,
          status: 'unvisited',
          domain: { origin: '', status: 'unvisited' }
        };
        ep.shortestPath = shortestPath;
        ep.seedPaths = seedPaths;
        ep.frontier = true;
        ep.status = 'active';

        procTriples.push({ id: t._id.toString(), type: TripleType.NAMED_NODE });
        log.silly('New path', ep);
        extendedPaths[prop][newHeadUrl] = ep;
      }
    }

    const literalTriples = triples
      .filter((t): t is LiteralTripleDocument => t.type === TripleType.LITERAL)
      .filter(t => this.shouldCreateNewPath(t, urlHead));

    for (const t of literalTriples) {
      log.silly('Extending path with LiteralTriple', t);
      const prop = t.predicate;
      const literalKey = `literal:${t.object.value}`;

      extendedPaths[prop] = extendedPaths[prop] || {};
      if (!extendedPaths[prop][literalKey]) {
        const seedPaths = {
          ...this.seedPaths,
          [literalKey]: (this.seedPaths[literalKey] || 0) + 1
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
        ep.head = {
          type: HEAD_TYPE.LITERAL,
          value: t.object.value,
          datatype: t.object.datatype,
          language: t.object.language
        };
        ep.shortestPath = shortestPath;
        ep.seedPaths = seedPaths;
        ep.frontier = true;
        ep.status = 'active';

        procTriples.push({ id: t._id.toString(), type: TripleType.LITERAL });
        log.silly('New path with literal head', ep);
        extendedPaths[prop][literalKey] = ep;
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
    if (hasLiteralHead(this)) {
      return { extendedPaths: [], procTriples: [] };
    }

    const triplesFilter = this.genExistingTriplesFilter(process);
    if (!triplesFilter) {
      return { extendedPaths: [], procTriples: [] };
    }

    const [namedNodeTriples, literalTriples] = await Promise.all([
      NamedNodeTriple.find(triplesFilter),
      LiteralTriple.find(triplesFilter)
    ]);

    const triples = [...namedNodeTriples, ...literalTriples];
    if (!triples.length) {
      return { extendedPaths: [], procTriples: [] };
    }
    log.silly(`Extending path ${this._id} with existing ${triples.length} triples`);
    return this.genExtended(triples, process);
  }
}

export const EndpointPath = getDiscriminatorModelForClass(Path, EndpointPathClass, PathType.ENDPOINT);

export type EndpointPathDocument = DocumentType<EndpointPathClass>;

