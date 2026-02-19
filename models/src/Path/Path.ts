import { Types, FilterQuery } from 'mongoose';
import { PathType, urlListValidator, urlValidator, type TypedTripleId } from '@derzis/common';
import { prop, PropType, Severity, modelOptions, getModelForClass, DocumentType, index } from '@typegoose/typegoose';
import { TraversalPathClass, type TraversalPathSkeleton } from './TraversalPath';
import { EndpointPathClass, type EndpointPathSkeleton } from './EndpointPath';
import { TimeStamps } from '@typegoose/typegoose/lib/defaultClasses';
import { ProcessClass } from '../Process';
import { NamedNodeTripleDocument } from '../Triple';
import { createLogger } from '@derzis/common/server';
const log = createLogger('Path');

class DomainClass {
  @prop({
    enum: ['unvisited', 'checking', 'error', 'ready', 'crawling'],
    default: 'unvisited',
    type: String
  })
  public status!: 'unvisited' | 'checking' | 'error' | 'ready' | 'crawling';

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

class HeadClass {
  @prop({ required: true, validate: urlValidator, type: String })
  public url!: string;

  @prop({
    enum: ['unvisited', 'done', 'crawling', 'error'],
    default: 'unvisited',
    type: String
  })
  public status!: 'unvisited' | 'done' | 'crawling' | 'error';

  @prop({ type: DomainClass })
  public domain!: DomainClass;
}

export type PathSkeleton = TraversalPathSkeleton | EndpointPathSkeleton;

export type PathSkeletonConstructor<T extends PathSkeleton> = Omit<T, '_id'> & {
  _id?: Types.ObjectId;
};

export { DomainClass, ResourceCount, SeedClass, HeadClass };

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

  @prop({ required: true, type: HeadClass })
  public head!: HeadClass;

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
  head: { url: string; status: string; domain?: { origin: string; status: string } };
  status: 'active' | 'deleted';
  type: PathType;
  extensionCounter: number;
  genExistingTriplesFilter: (process: ProcessClass) => FilterQuery<NamedNodeTripleDocument> | null;
  genExtended: (triples: NamedNodeTripleDocument[], process: ProcessClass) => Promise<{ extendedPaths: PathSkeleton[]; procTriples: TypedTripleId[] }>;
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

