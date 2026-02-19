import type { Types, Document } from 'mongoose';
import { LiteralObject, urlValidator } from '@derzis/common';
import { TripleType } from '@derzis/common';

import { prop, index, getModelForClass, PropType } from '@typegoose/typegoose';

class WorkerTripleClass {
  @prop({ required: true, validate: urlValidator, type: String })
  public subject!: string;

  @prop({ required: true, validate: urlValidator, type: String })
  public predicate!: string;

  @prop({ required: true, enum: TripleType, type: String })
  public type!: TripleType;

  @prop({ required: true })
  public object!: string | LiteralObject;
}

@index({ url: 1 })
class ResourceCacheClass {
  createdAt!: Date;
  updatedAt!: Date;

  @prop({ required: true, validate: urlValidator, type: String })
  public url!: string;

  @prop({ default: [], type: [WorkerTripleClass] }, PropType.ARRAY)
  public triples?: Types.DocumentArray<WorkerTripleClass>;
}

const ResourceCache = getModelForClass(ResourceCacheClass, {
  schemaOptions: { timestamps: true, collection: 'resourceCaches' }
});
type ResourceCacheDocument = ResourceCacheClass & Document;

export { ResourceCache, ResourceCacheClass, type ResourceCacheDocument };
