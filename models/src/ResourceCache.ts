import type { Types, Document } from 'mongoose';
import { urlValidator } from '@derzis/common';

import { prop, index, getModelForClass, PropType } from '@typegoose/typegoose';

class LiteralObject {
  @prop({ required: true, type: String })
  public value!: string;

  @prop({ required: false, type: String })
  public datatype?: string;

  @prop({ required: false, type: String })
  public language?: string;
}

class TripClass {
  @prop({ required: true, type: String })
  public subject!: string;

  @prop({ required: true, type: String })
  public predicate!: string;

  @prop({ required: true, enum: ['literal', 'namedNode'], type: String })
  public type!: 'literal' | 'namedNode';

  @prop({ required: true, type: String })
  public object!: string | LiteralObject;
}

@index({ url: 1 })
class ResourceCacheClass {
  createdAt!: Date;
  updatedAt!: Date;

  @prop({ required: true, validate: urlValidator, type: String })
  public url!: string;

  @prop({ default: [], type: [TripClass] }, PropType.ARRAY)
  public triples?: Types.DocumentArray<TripClass>;
}

const ResourceCache = getModelForClass(ResourceCacheClass, {
  schemaOptions: { timestamps: true, collection: 'resourceCaches' }
});
type ResourceCacheDocument = ResourceCacheClass & Document;

export { ResourceCache, ResourceCacheClass, type ResourceCacheDocument };
