import type { BulkWriteResult } from 'mongodb';
import { createLogger } from '@derzis/common/server';
import { urlValidator, directionOk } from '@derzis/common';
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

type TripleSkeleton = Pick<TripleClass, 'subject' | 'predicate' | 'object' | 'objectLiteral'>;
type TripleWithSources = Pick<TripleClass, 'subject' | 'predicate' | 'object' | 'objectLiteral' | 'sources'>;

class LiteralObject {
  @prop({ required: true, type: String })
  public value!: string;

  @prop({ required: false, type: String })
  public datatype?: string;

  @prop({ required: false, type: String })
  public language?: string;
}

@index({ nodes: 1 })
// For keyset pagination
@index({ createdAt: 1, _id: 1 })
@index({ subject: 1, predicate: 1, object: 1 }, { unique: true })
@index({ predicate: 1 })
@index({ predicate: 1, nodes: 1, subject: 1 })
@index({ 'objectLiteral.language': 1, 'objectLiteral.value': 1 })
@index({ 'objectLiteral.datatype': 1 })
class TripleClass {
  _id!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;

  @prop({ required: true, validate: urlValidator, type: String })
  public subject!: string;

  @prop({ required: true, validate: urlValidator, type: String })
  public predicate!: string;

  @prop({ required: false, validate: urlValidator, type: String })
  public object?: string;

  @prop({ required: false, type: () => ({ value: { type: String, required: true }, language: String, datatype: String }) })
  public objectLiteral?: LiteralObject;

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
      let key: string;
      let filterField: { object?: string; objectLiteral?: LiteralObject };

      if (t.object !== undefined) {
        // NamedNode triple
        key = `${t.subject}\u0000${t.predicate}\u0000${t.object}`;
        filterField = { object: t.object };
      } else if (t.objectLiteral) {
        // Literal triple - key includes hash of objectLiteral for uniqueness
        const litKey = JSON.stringify(t.objectLiteral);
        key = `${t.subject}\u0000${t.predicate}\u0000${litKey}`;
        filterField = { objectLiteral: t.objectLiteral };
      } else {
        log.warn('Triple has neither object nor objectLiteral, skipping', t);
        continue;
      }

      if (tripleMap.has(key)) {
        tripleMap.get(key)!.sources!.push(source.url);
      } else {
        tripleMap.set(key, {
          subject: t.subject,
          predicate: t.predicate,
          object: t.object,
          objectLiteral: t.objectLiteral,
          sources: [source.url]
        });
      }
    }

    const ops = [...tripleMap.values()].map((t) => {
      let nodes: string[];
      let updateSet: Record<string, unknown>;

      if (t.object !== undefined) {
        // NamedNode triple - include object in nodes array for traversal
        nodes = [t.subject, t.object];
        updateSet = {
          subject: t.subject,
          predicate: t.predicate,
          object: t.object,
          objectLiteral: null,
          nodes
        };
      } else if (t.objectLiteral) {
        // Literal triple - only subject in nodes (literals can't be traversed)
        nodes = [t.subject];
        updateSet = {
          subject: t.subject,
          predicate: t.predicate,
          object: null,
          objectLiteral: t.objectLiteral,
          nodes
        };
      } else {
        throw new Error('Invalid triple: must have either object or objectLiteral');
      }

      return {
        updateOne: {
          filter: {
            subject: t.subject,
            predicate: t.predicate,
            ...(t.object !== undefined ? { object: t.object } : { objectLiteral: t.objectLiteral })
          },
          update: {
            $setOnInsert: updateSet,
            $addToSet: {
              sources: { $each: t.sources! }
            }
          },
          upsert: true
        }
      };
    });

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
    const objectDisplay = this.object ?? this.objectLiteral?.value ?? '(none)';
    log.silly(`XXXXXXXXXXdir Direction ${dOk ? '' : 'not '}ok for triple
  ${this.subject}
  ${this.predicate}
  ${objectDisplay}
  branch factor: ${bfRatio} ${bfDir} (total ${bf.subj + bf.obj})
  headUrl: ${headUrl}`);
    return dOk;
  }
}

const Triple = getModelForClass(TripleClass, {
  schemaOptions: { timestamps: true, collection: 'triples' }
});
type TripleDocument = TripleClass & Document;
export { Triple, TripleClass, type TripleDocument, type TripleSkeleton };
