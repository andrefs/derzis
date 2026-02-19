import { Types } from 'mongoose';
import { urlListValidator, urlValidator } from '@derzis/common';
import { prop, PropType, Severity, modelOptions, getModelForClass } from '@typegoose/typegoose';
import { TraversalPathClass, type TraversalPathSkeleton } from './TraversalPath';
import { EndpointPathClass, type EndpointPathSkeleton } from './EndpointPath';
import type { Document } from 'mongoose';
import { TimeStamps } from '@typegoose/typegoose/lib/defaultClasses';

export enum PathType {
  TRAVERSAL = 'traversal',
  ENDPOINT = 'endpoint'
}

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
export class PathClass extends TimeStamps {
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

  @prop({ enum: PathType, required: true })
  public type!: PathType;
}

export const Path = getModelForClass(PathClass);
export interface PathDocument extends PathClass, Document { createdAt: Date; updatedAt: Date }

export function isTraversalPath(path: PathClass | PathDocument): path is TraversalPathClass & Document {
  return path.type === PathType.TRAVERSAL;
}

export function isEndpointPath(path: PathClass | PathDocument): path is EndpointPathClass & Document {
  return path.type === PathType.ENDPOINT;
}

export type ProcTripleIdType = Types.ObjectId;



export function isEndpoint(path: PathClass): path is EndpointPathClass {
  return path.type === PathType.ENDPOINT;
}

export function isTraversal(path: PathClass): path is TraversalPathClass {
  return path.type === PathType.TRAVERSAL;
}

