import type { BulkWriteResult } from 'mongodb';
import { createLogger } from '@derzis/common/server';
import { urlValidator, directionOk } from '@derzis/common';
import type { SimpleTriple } from '@derzis/common';
const log = createLogger('Triple');
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
import { BranchFactorClass, SeedPosRatioClass } from './Process/aux-classes';

type TripleSkeleton = Pick<TripleClass, 'subject' | 'predicate' | 'object'>;
type TripleWithSources = Pick<TripleClass, 'subject' | 'predicate' | 'object' | 'sources'>;

@index({ nodes: 1 })
@index({ subject: 1, predicate: 1, object: 1 }, { unique: true })
@index({ predicate: 1 })
@index({ predicate: 1, nodes: 1, subject: 1 })
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
   * Check if the direction of the triple is acceptable based on the position of head URL in the triple and predicate direction metrics.
   * If branch factor (bf) >= 1 the predicate converges from subject to object.
   * If seed position ratio (spr) >= 1 the seeds are mostly in the subject position.
   * @param headUrl The URL of the head resource.
   * @param followDirection Boolean indicating whether to enforce directionality.
   * @param predsDirMetrics Optional map of predicate direction metrics. Required if followDirection is true.
   * @returns True if the direction is acceptable, false otherwise.
   */
  public directionOk(
    headUrl: string,
    followDirection: boolean,
    predsDirMetrics?: Map<string, { bf: BranchFactorClass; spr: SeedPosRatioClass }>
  ): boolean {
    if (!followDirection) {
      log.silly('XXXXXXXXXXdir Not following direction because followDirection is false');
      return true;
    }

    if (!predsDirMetrics || !predsDirMetrics.size) {
      log.warn(
        'XXXXXXXXXXdir Predicate direction metrics not provided, cannot enforce directionality'
      );
      return true;
    }

    // followDirection is true, assume predsDirMetrics is defined
    // FIXME does it make sense to return true if predicate not in predsDirMetrics?
    // why would we have a triple with a predicate not in predsDirMetrics?
    if (!predsDirMetrics.has(this.predicate)) {
      log.silly(
        `XXXXXXXXXXdir Predicate ${this.predicate} not in predsDirMetrics, cannot enforce directionality`
      );
      return true;
    }

    const bf = predsDirMetrics.get(this.predicate)!.bf!;
    const bfRatio = bf.subj / bf.obj;
    const bfDir = bfRatio >= 1 ? 'subj->obj' : 'obj->subj';

    const dOk = directionOk(this, headUrl, bfRatio);
    log.silly(`XXXXXXXXXXdir Direction ${dOk ? '' : 'not '}ok for triple
\t${this.subject}
\t${this.predicate}
\t${this.object}
\tbranch factor: ${bfRatio} ${bfDir} (total ${bf.subj + bf.obj})
\theadUrl: ${headUrl}`);
    return dOk;
  }
}

const Triple = getModelForClass(TripleClass, {
  schemaOptions: { timestamps: true, collection: 'triples' }
});
type TripleDocument = TripleClass & Document;
export { Triple, TripleClass, type TripleDocument, type TripleSkeleton };
