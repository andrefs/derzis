import { Types, FilterQuery } from 'mongoose';
import { PathType, urlListValidator, urlValidator } from '@derzis/common';
import { prop, PropType, Severity, modelOptions } from '@typegoose/typegoose';
import { NamedNodeTripleClass } from '../Triple';
import { ProcessClass } from '../Process';
import { type TraversalPathSkeleton } from './TraversalPath';
import { type EndpointPathSkeleton } from './EndpointPath';
import config from '@derzis/config';

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

export abstract class PathClass {
  _id!: Types.ObjectId;
  createdAt!: Date;
  updatedAt!: Date;

  @prop({ required: true, type: String })
  public processId!: string;

  @prop({
    enum: ['traversal', 'endpoint'],
    required: true,
    type: String,
    default: config.manager.pathType as PathType
  })
  public type!: 'traversal' | 'endpoint';

  @prop({ required: true, type: SeedClass })
  public seed!: SeedClass;

  @prop({ required: true, type: HeadClass })
  public head!: HeadClass;

  @prop({
    enum: ['active', 'deleted'],
    default: 'active',
    type: String
  })
  public status!: 'active' | 'deleted';

  @prop({ default: 0, type: Number })
  public extensionCounter!: number;

  public abstract shouldCreateNewPath(t: NamedNodeTripleClass): boolean;

  public abstract tripleIsOutOfBounds(t: NamedNodeTripleClass, process: ProcessClass): boolean;

  public abstract genExistingTriplesFilter(process: ProcessClass): FilterQuery<NamedNodeTripleClass> | null;

  public abstract copy(): PathSkeleton;

  public abstract genExtended(
    triples: NamedNodeTripleClass[],
    process: ProcessClass
  ): Promise<{ extendedPaths: PathSkeleton[]; procTriples: ProcTripleIdType[] }>;

  public abstract extendWithExistingTriples(
    proc: ProcessClass
  ): Promise<{ extendedPaths: PathSkeleton[]; procTriples: ProcTripleIdType[] }>;
}
export interface ProcTripleIdType {
  id: Types.ObjectId,
  type: 'literal' | 'namedNode'
}
