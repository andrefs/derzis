import type { BulkWriteResult } from 'mongodb';
import { urlValidator } from '@derzis/common';
import type { ResourceClass } from './Resource';
import type { Types } from 'mongoose';
import { prop, index, getModelForClass, type ReturnModelType } from '@typegoose/typegoose';
import type { Document } from 'cheerio';

type TripleSkeleton = Pick<TripleClass, 'subject' | 'predicate' | 'object'>;

@index({ nodes: 1 })
@index({ subject: 1, predicate: 1, object: 1 }, { unique: true })
class TripleClass {
	_id!: Types.ObjectId;

	createdAt!: Date;
	updatedAt!: Date;

	@prop({ required: true, validate: urlValidator, type: String })
	public subject!: string;

	@prop({ required: true, validate: urlValidator, type: String })
	public predicate!: string;

	@prop({ required: true, validate: urlValidator, type: String })
	public object!: string;

	@prop({ default: [], validate: urlValidator, type: [String] })
	public nodes?: string[];

	@prop({ default: [], validate: urlValidator, type: [String] })
	public sources?: string[];

	public static async upsertMany(
		this: ReturnModelType<typeof TripleClass>,
		source: ResourceClass,
		triples: TripleSkeleton[]
	): Promise<BulkWriteResult> {
		const ops = triples.map((t: TripleSkeleton) => ({
			updateOne: {
				filter: t,
				update: {
					$setOnInsert: {
						nodes: [t.subject, t.object]
					},
					$addToSet: {
						sources: source.url
					}
				},
				upsert: true
			}
		}));

		return this.bulkWrite(ops, { ordered: false });
	}
}
const Triple = getModelForClass(TripleClass, {
	schemaOptions: { timestamps: true, collection: 'triples' }
});
type TripleDocument = TripleClass & Document;
export { Triple, TripleClass, type TripleDocument, type TripleSkeleton };
