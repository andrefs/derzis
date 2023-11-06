import type { Types, Document } from 'mongoose';
import { urlValidator } from '@derzis/common';

import {
	prop,
	index,
	getModelForClass,
	PropType
} from '@typegoose/typegoose';

class TripClass {
	@prop({ required: true, type: String })
	public subject!: string;

	@prop({ required: true, type: String })
	public predicate!: string;

	@prop({ required: true, type: String })
	public object!: string;
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
