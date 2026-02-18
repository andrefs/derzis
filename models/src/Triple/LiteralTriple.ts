import type { BulkWriteResult } from 'mongodb';
import { createLogger } from '@derzis/common/server';
import { SimpleLiteralTriple, type SimpleTriple } from '@derzis/common';
const log = createLogger('LiteralTriple');
import type { ResourceClass } from '../Resource';
import {
  prop,
  index,
  getModelForClass,
  type ReturnModelType
} from '@typegoose/typegoose';
import type { Document } from 'mongoose';
import { TripleClass } from './Triple';

export class LiteralValue {
  @prop({ required: true, type: String })
  public value!: string;

  @prop({ required: false, type: String })
  public datatype?: string;

  @prop({ required: false, type: String })
  public language?: string;
}

@index({
  subject: 1,
  predicate: 1,
  'object.value': 1,
  'object.language': 1,
  'object.datatype': 1
}, { unique: true })
export class LiteralTripleClass extends TripleClass {
  @prop({ required: true, type: LiteralValue })
  public object!: LiteralValue;

  /**
  * Upsert multiple LiteralTriples efficiently by grouping them and using bulkWrite.
  * @param source The ResourceClass source URL to add to the sources array.
  * @param triples An array of SimpleTriple to upsert.
  * @returns An array of BulkWriteResult objects for each batch operation.
  */
  public static async upsertMany(
    this: ReturnModelType<typeof LiteralTripleClass>,
    source: ResourceClass,
    triples: SimpleTriple[]
  ): Promise<BulkWriteResult[]> {
    const literalTriples = triples.filter(t => t.type === 'literal');

    if (literalTriples.length === 0) {
      log.debug('No Literal triples to upsert');
      return [];
    }

    //const tripleMap = new Map<string, { subject: string; predicate: string; object: { value: string; datatype?: string; language?: string }; sources: string[] }>();
    const tripleMap = new Map<string, SimpleLiteralTriple & { sources: string[] }>();

    for (const t of literalTriples) {
      const litKey = JSON.stringify(t.object);
      const key = `${t.subject}\u0000${t.predicate}\u0000${litKey}`;

      if (tripleMap.has(key)) {
        tripleMap.get(key)!.sources.push(source.url);
      } else {
        tripleMap.set(key, {
          subject: t.subject,
          predicate: t.predicate,
          object: t.object,
          type: 'literal',
          sources: [source.url]
        });
      }
    }

    log.debug(`Processing Literal triples: ${literalTriples.length} input, ${tripleMap.size} unique`);

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
            nodes: [t.subject]
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
}

export const LiteralTriple = getModelForClass(LiteralTripleClass, {
  schemaOptions: { timestamps: true, collection: 'literalTriples' }
});
export type LiteralTripleDocument = LiteralTripleClass & Document;
