import { Types, type QueryFilter } from 'mongoose';
import { PathType, urlListValidator, urlValidator, type TypedTripleId, type LiteralObject } from '@derzis/common';
import { prop, PropType, Severity, modelOptions, getModelForClass, type DocumentType, index } from '@typegoose/typegoose';
import { TraversalPathClass, type TraversalPathSkeleton } from './TraversalPath';
import { EndpointPathClass, type EndpointPathSkeleton } from './EndpointPath';
import { TimeStamps } from '@typegoose/typegoose/lib/defaultClasses';
import { ProcessClass } from '../Process';
import { type NamedNodeTripleDocument, type LiteralTripleDocument, type TripleDocument } from '../Triple';
import { createLogger } from '@derzis/common/server';
const log = createLogger('Path');

export const HEAD_TYPE = {
  URL: 'url',
  LITERAL: 'literal'
} as const;

class DomainClass {
  @prop({
    enum: ['unvisited', 'checking', 'error', 'ready', 'crawling', 'labelFetching'],
    default: 'unvisited',
    type: String
  })
  public status!: 'unvisited' | 'checking' | 'error' | 'ready' | 'crawling' | 'labelFetching';

  @prop({ required: true, validate: urlValidator, type: String })
  public origin!: string;
}

@modelOptions({ options: { allowMixed: Severity.ERROR } })
class ResourceCount {
  @prop({ default: 0, type: Number })
  public count!: number;

  @prop({ default: [], validate: urlListValidator, type: [String] }, PropType.ARRAY)
  public elems!: string[];
}

class SeedClass {
  @prop({ required: true, validate: urlValidator, type: String })
  public url!: string;
}

@modelOptions({ schemaOptions: { _id: false, discriminatorKey: 'type' } })
export class HeadBase {
  @prop({ type: String, default: HEAD_TYPE.URL })
  public type!: typeof HEAD_TYPE.URL | typeof HEAD_TYPE.LITERAL;
}

export class UrlHead extends HeadBase {
  @prop({ required: true, validate: urlValidator, type: String })
  public url!: string;

  @prop({
    required: true,
    enum: ['unvisited', 'done', 'crawling', 'error'],
    default: 'unvisited',
    type: String
  })
  public status!: 'unvisited' | 'done' | 'crawling' | 'error';

  @prop({ type: DomainClass })
  public domain!: DomainClass;
}

export class LiteralHead extends HeadBase implements LiteralObject {
  @prop({ required: true, type: String })
  public value!: string;

  @prop({ type: String })
  public datatype?: string;

  @prop({ type: String })
  public language?: string;
}

export type Head = UrlHead | LiteralHead;

export type PathSkeleton = TraversalPathSkeleton | EndpointPathSkeleton;

export type PathSkeletonConstructor<T extends PathSkeleton> = Omit<T, '_id'> & {
  _id?: Types.ObjectId;
};

export { DomainClass, ResourceCount, SeedClass };

@modelOptions({
  schemaOptions: {
    discriminatorKey: 'type',
    timestamps: true,
    collection: 'paths'
  }
})
@index({ processId: 1, status: 1 })
@index({ type: 1 })
@index({ status: 1 })
@index({ createdAt: 1 })
export class PathClass extends TimeStamps {
  @prop({ type: Types.ObjectId, auto: true })
  public _id!: Types.ObjectId;

  @prop({ required: true, type: String })
  public processId!: string;

  @prop({ required: true, type: SeedClass })
  public seed!: SeedClass;

  @prop({
    required: true,
    type: HeadBase,
    discriminators: () => [
      { type: UrlHead, value: HEAD_TYPE.URL },
      { type: LiteralHead, value: HEAD_TYPE.LITERAL }
    ]
  })
  public head!: HeadBase;

  @prop({ enum: ['active', 'deleted'], default: 'active', type: String })
  public status!: 'active' | 'deleted';

  @prop({ default: 0, type: Number })
  public extensionCounter!: number;

  @prop({ enum: PathType, required: true, type: String })
  public type!: PathType;
}

export interface IPath {
  _id: Types.ObjectId;
  processId: string;
  seed: { url: string };
  head: Head;
  status: 'active' | 'deleted';
  type: PathType;
  extensionCounter: number;
  genExistingTriplesFilter: (process: ProcessClass) => QueryFilter<NamedNodeTripleDocument> | null;
  genExtended: (triples: TripleDocument[], process: ProcessClass) => Promise<{ extendedPaths: PathSkeleton[]; procTriples: TypedTripleId[] }>;
  extendWithExistingTriples: (process: ProcessClass) => Promise<{ extendedPaths: PathSkeleton[]; procTriples: TypedTripleId[] }>;
}

export const Path = getModelForClass(PathClass);
export type PathDocument = DocumentType<PathClass> & IPath;


export function isEndpoint(path: PathClass): path is EndpointPathClass {
  return path.type === PathType.ENDPOINT;
}

export function isTraversal(path: PathClass): path is TraversalPathClass {
  return path.type === PathType.TRAVERSAL;
}

export const isTraversalPath = isTraversal;

export function hasLiteralHead(path: PathClass): boolean {
  return path.head.type === HEAD_TYPE.LITERAL;
}

export function hasUrlHead(path: PathClass): boolean {
  return path.head.type === HEAD_TYPE.URL;
}


