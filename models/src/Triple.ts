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
type TripleWithSources = Pick<TripleClass, 'subject' | 'predicate' | 'object' | 'sources'>;

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



	/**
	 * Upsert many triples into the database, aggregating sources for duplicates.
	 * If a triple already exists, the source URL is added to its sources array.
	 * If there are too many triples, they are processed in batches.
	 * @param source The resource from which the triples were obtained.
	 * @param triples Array of triples to upsert.
	 * @returns Array of BulkWriteResult for each batch.
	 */
	public static async upsertMany(
		this: ReturnModelType<typeof TripleClass>,
		source: ResourceClass,
		triples: TripleSkeleton[]
	): Promise<BulkWriteResult[]> {
		// deduplicate triples and aggregate sources
		const tripleMap = new Map<string, TripleWithSources>();
		for (const t of triples) {
			const key = `${t.subject}\u0000${t.predicate}\u0000${t.object}`;
			if (tripleMap.has(key)) {
				tripleMap.get(key)!.sources!.push(source.url);
			} else {
				tripleMap.set(key, {
					...t,
					sources: [source.url]
				});
			}
		}
		const ops = [...tripleMap.values()].map((t) => ({
			updateOne: {
				filter: {
					subject: t.subject,
					predicate: t.predicate,
					object: t.object
				},
				update: {
					$setOnInsert: {
						subject: t.subject,
						predicate: t.predicate,
						object: t.object,
						nodes: [t.subject, t.object]
					},
					$addToSet: {
						sources: { $each: t.sources! }
					}
				},
				upsert: true
			}
		}));

		const BATCH_SIZE = 500;
		const results: BulkWriteResult[] = [];
		for (let i = 0; i < ops.length; i += BATCH_SIZE) {
			const batchOps = ops.slice(i, i + BATCH_SIZE);
			const result = await this.bulkWrite(batchOps, { ordered: false });
			results.push(result);
		}

		return results;
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
			log.silly('XXXXXXXXXXdir Not following direction because followDirection is false');
			return true;
		}

		if (!predsBranchFactor) {
			log.warn('XXXXXXXXXXdir Predicate branch factor not provided, cannot enforce directionality');
			return true;
		}

		// followDirection is true, assume predsBranchFactor is defined
		// FIXME does it make sense to return true if predicate not in predsBranchFactor?
		// why would we have a triple with a predicate not in predsBranchFactor?
		if (!(this.predicate in predsBranchFactor)) {
			log.silly(`XXXXXXXXXXdir Predicate ${this.predicate} not in predsBranchFactor, cannot enforce directionality`);
			return true;
		}

		const bf = predsBranchFactor!.get(this.predicate)!;

		// should it return true if bf === 1 ?
		// FIXME >= or > ?
		if (headUrl === this.subject && bf >= 1) {
			log.silly(`XXXXXXXXXXdir Direction ok for triple\n\t${this.subject}\n\t${this.predicate}\n\t${this.object}\n\tbranch factor: ${bf}\n\theadUrl: ${headUrl}`);
			return true;
		}

		// FIXME <= or < ?
		if (headUrl === this.object && bf <= 1) {
			log.silly(`XXXXXXXXXXdir Direction ok for triple\n\t${this.subject}\n\t${this.predicate}\n\t${this.object}\n\tbranch factor: ${bf}\n\theadUrl: ${headUrl}`);
			return true;
		}

		log.silly(`XXXXXXXXXXdir Direction not ok for triple\n\t${this.subject}\n\t${this.predicate}\n\t${this.object}\n\tbranch factor: ${bf}\n\theadUrl: ${headUrl}`);
		return false;
	}
}
const Triple = getModelForClass(TripleClass, {
	schemaOptions: { timestamps: true, collection: 'triples' }
});
type TripleDocument = TripleClass & Document;
export { Triple, TripleClass, type TripleDocument, type TripleSkeleton };
