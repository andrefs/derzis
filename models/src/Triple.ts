import type { BulkWriteResult } from 'mongodb';
import { createLogger } from '@derzis/common';
const log = createLogger('Triple');
import { urlValidator } from '@derzis/common';
import type { ResourceClass } from './Resource';
import type { Types } from 'mongoose';
import {
	prop,
	index,
	getModelForClass,
	type ReturnModelType,
	PropType
} from '@typegoose/typegoose';
import type { Document } from 'mongoose';

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

	@prop({ default: [], validate: urlValidator, type: [String] }, PropType.ARRAY)
	public nodes?: string[];

	@prop({ default: [], validate: urlValidator, type: [String] }, PropType.ARRAY)
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


	/**
	* Check if the direction of the triple is acceptable based on the position of head URL in the triple and predicate branch factor.
	* @param headUrl The URL of the head resource.
	* @param followDirection Boolean indicating whether to enforce directionality.
	* @param predsBranchFactor Optional map of predicate branch factors. Required if followDirection is true.
	* @returns True if the direction is acceptable, false otherwise.
	*/
	public directionOk(
		headUrl: string,
		followDirection: boolean,
		predsBranchFactor?: Map<string, number>
	): boolean {
		if (!followDirection) {
			return true;
		}

		// followDirection is true, assume predsBranchFactor is defined
		// FIXME does it make sense to return true if predicate not in predsBranchFactor?
		// why would we have a triple with a predicate not in predsBranchFactor?
		if (!(this.predicate in predsBranchFactor)) {
			return true;
		}

		const bf = predsBranchFactor!.get(this.predicate)!;

		// should it return true if bf === 1 ?
		// FIXME >= or > ?
		if (headUrl === this.subject && bf >= 1) {
			return true;
		}

		// FIXME <= or < ?
		if (headUrl === this.object && bf <= 1) {
			return true;
		}

		log.silly(`Direction not ok for triple\n\t${this.subject}\n\t${this.predicate}\n\t${this.object}\n\tbranch factor: ${bf}\n\theadUrl: ${headUrl}`);
		return false;
	}
}
const Triple = getModelForClass(TripleClass, {
	schemaOptions: { timestamps: true, collection: 'triples' }
});
type TripleDocument = TripleClass & Document;
export { Triple, TripleClass, type TripleDocument, type TripleSkeleton };
