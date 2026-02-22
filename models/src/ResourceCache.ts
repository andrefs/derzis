import type { Types, Document } from 'mongoose';
import { urlValidator, TripleType } from '@derzis/common';
import { LiteralObject } from './Triple';

import { prop, index, getModelForClass, PropType, modelOptions } from '@typegoose/typegoose';
import { TimeStamps } from '@typegoose/typegoose/lib/defaultClasses';

@modelOptions({ schemaOptions: { _id: false, discriminatorKey: 'type' } })
export class WorkerTripleBase {
  @prop({ required: true, validate: urlValidator, type: String })
  public subject!: string;

  @prop({ required: true, validate: urlValidator, type: String })
  public predicate!: string;
}

export class WorkerNamedNodeTriple extends WorkerTripleBase {
  @prop({ required: true, enum: TripleType, type: String, default: TripleType.NAMED_NODE })
  public type!: typeof TripleType.NAMED_NODE;

  @prop({ required: true, type: String })
  public object!: string;
}

export class WorkerLiteralTriple extends WorkerTripleBase {
  @prop({ required: true, enum: TripleType, type: String, default: TripleType.LITERAL })
  public type!: typeof TripleType.LITERAL;

  @prop({ required: true, type: LiteralObject })
  public object!: LiteralObject;
}

export type WorkerTriple = WorkerNamedNodeTriple | WorkerLiteralTriple;

@index({ url: 1 })
class ResourceCacheClass extends TimeStamps {

  @prop({ required: true, validate: urlValidator, type: String })
  public url!: string;

  @prop({
    default: [],
    type: WorkerTripleBase,
    discriminators: () => [
      { type: WorkerNamedNodeTriple, value: TripleType.NAMED_NODE },
      { type: WorkerLiteralTriple, value: TripleType.LITERAL }
    ]
  }, PropType.ARRAY)
  public triples?: Types.DocumentArray<WorkerTriple>;
}

const ResourceCache = getModelForClass(ResourceCacheClass, {
  schemaOptions: { timestamps: true, collection: 'resourceCaches' }
});
type ResourceCacheDocument = ResourceCacheClass & Document;

export { ResourceCache, ResourceCacheClass, type ResourceCacheDocument };
