import type { BulkWriteResult } from 'mongodb';
import { createLogger } from '@derzis/common/server';
import { urlValidator, directionOk } from '@derzis/common';
const log = createLogger('NamedNodeTriple');
import type { ResourceClass } from '../Resource';
import {
  prop,
  index,
  getModelForClass,
  type ReturnModelType
} from '@typegoose/typegoose';
import type { Document } from 'mongoose';
import { TripleClass, type TripleSkeleton } from './Triple';
import { BranchFactorClass, SeedPosRatioClass } from '../Process/aux-classes';

@index({ nodes: 1 })
@index({ createdAt: 1, _id: 1 })
@index({ subject: 1, predicate: 1, object: 1 }, { unique: true })
@index({ predicate: 1 })
@index({ predicate: 1, nodes: 1, subject: 1 })
export class NamedNodeTripleClass extends TripleClass {
  @prop({ required: true, validate: urlValidator, type: String })
  public object!: string;


  /**
  * Upsert multiple NamedNode triples efficiently by grouping them and performing bulkWrite operations.
  * @param source The ResourceClass instance representing the source of the triples.
  * @param triples An array of TripleSkeleton objects to be upserted as NamedNode triples.
  * @returns An array of BulkWriteResult objects corresponding to each batch of operations.
  */
  public static async upsertMany(
    this: ReturnModelType<typeof NamedNodeTripleClass>,
    source: ResourceClass,
    triples: TripleSkeleton[]
  ): Promise<BulkWriteResult[]> {
    const namedNodeTriples = triples.filter(
      (t): t is TripleSkeleton & { object: string } =>
        typeof t.object === 'string' && t.object !== ''
    );

    if (namedNodeTriples.length === 0) {
      log.debug('No NamedNode triples to upsert');
      return [];
    }

    const tripleMap = new Map<string, { subject: string; predicate: string; object: string; sources: string[] }>();

    for (const t of namedNodeTriples) {
      const key = `${t.subject}\u0000${t.predicate}\u0000${t.object}`;

      if (tripleMap.has(key)) {
        tripleMap.get(key)!.sources.push(source.url);
      } else {
        tripleMap.set(key, {
          subject: t.subject,
          predicate: t.predicate,
          object: t.object,
          sources: [source.url]
        });
      }
    }

    log.debug(`Processing NamedNode triples: ${namedNodeTriples.length} input, ${tripleMap.size} unique`);

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
            sources: { $each: t.sources }
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
  * Checks if the triple's direction is consistent with the provided head URL and predicate direction metrics.
  * @param headUrl The URL of the head resource to compare against.
  * @param followDirection A boolean indicating whether to enforce directionality.
  * @param predsDirMetrics An optional map containing predicate direction metrics (branch factor and seed position ratio).
  * @returns A boolean indicating whether the triple's direction is considered valid.
  */
  public directionOk(
    headUrl: string,
    followDirection: boolean,
    predsDirMetrics?: Map<string, { bf: BranchFactorClass; spr: SeedPosRatioClass }>
  ): boolean {
    if (!followDirection) {
      return true;
    }

    if (!predsDirMetrics || !predsDirMetrics.size) {
      log.warn('Predicate direction metrics not provided, cannot enforce directionality');
      return true;
    }

    if (!predsDirMetrics.has(this.predicate)) {
      return true;
    }

    const bf = predsDirMetrics.get(this.predicate)!.bf!;
    const bfRatio = bf.subj / bf.obj;

    const dOk = directionOk(
      { subject: this.subject, predicate: this.predicate, object: this.object } as any,
      headUrl,
      bfRatio
    );

    log.silly(`Direction ${dOk ? '' : 'not '}ok for triple ${this.subject} ${this.predicate} ${this.object}`);
    return dOk;
  }
}

export const NamedNodeTriple = getModelForClass(NamedNodeTripleClass, {
  schemaOptions: { timestamps: true, collection: 'namedNodeTriples' }
});
export type NamedNodeTripleDocument = NamedNodeTripleClass & Document;
