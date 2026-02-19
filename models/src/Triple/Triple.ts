import {
  prop,
  PropType,
  getModelForClass,
  type ReturnModelType,
  modelOptions,
  getDiscriminatorModelForClass,
  index,
} from '@typegoose/typegoose';
import { urlValidator, type SimpleTriple, directionOk, TripleType } from '@derzis/common';
import type { BulkWriteResult } from 'mongodb';
import { createLogger } from '@derzis/common/server';
import type { ResourceClass } from '../Resource';
import { DocumentType } from '@typegoose/typegoose/lib/types';
import { BranchFactorClass, SeedPosRatioClass } from '../Process';
import { TimeStamps } from '@typegoose/typegoose/lib/defaultClasses';

const log = createLogger('Triple');

export class LiteralObject {
  @prop({ required: true, type: String })
  public value!: string;

  @prop({ required: false, type: String })
  public datatype?: string;

  @prop({ required: false, type: String })
  public language?: string;
}

@modelOptions({
  schemaOptions: {
    discriminatorKey: 'type',
    timestamps: true,
    collection: 'triples'
  }
})
@index({ nodes: 1, createdAt: 1 })
@index({ sources: 1 })
@index({ updatedAt: -1 })
@index({ type: 1 })
export class TripleClass extends TimeStamps {
  @prop({ required: true, validate: urlValidator, type: String, index: true })
  public subject!: string;

  @prop({ required: true, validate: urlValidator, type: String })
  public predicate!: string;

  @prop({ default: [], validate: urlValidator, type: [String], index: true }, PropType.ARRAY)
  public nodes!: string[];

  @prop({ default: [], validate: urlValidator, type: [String], index: true }, PropType.ARRAY)
  public sources?: string[];


  @prop({ required: true, enum: TripleType, type: String, index: true })
  public type!: TripleType;


  public static async upsertMany(
    this: ReturnModelType<typeof TripleClass>,
    source: ResourceClass,
    triples: SimpleTriple[]
  ): Promise<BulkWriteResult[]> {
    if (!triples || !triples.length) {
      log.debug('No triples to upsert');
      return [];
    }

    const namedNodeTriples = triples.filter(t => t.type === TripleType.NAMED_NODE);
    const literalTriples = triples.filter(t => t.type === TripleType.LITERAL);

    const results: BulkWriteResult[] = [];

    if (namedNodeTriples.length > 0) {
      const namedNodeOps = buildBulkOps(namedNodeTriples, source, TripleType.NAMED_NODE);
      const namedNodeResults = await executeBulkOps(NamedNodeTriple, namedNodeOps);
      results.push(...namedNodeResults);
    }

    if (literalTriples.length > 0) {
      const literalOps = buildBulkOps(literalTriples, source, TripleType.LITERAL);
      const literalResults = await executeBulkOps(LiteralTriple, literalOps);
      results.push(...literalResults);
    }

    return results;
  }
}

function buildBulkOps(
  triples: SimpleTriple[],
  source: ResourceClass,
  type: TripleType,
): ReturnModelType<typeof TripleClass>['bulkWrite'] extends (ops: infer T) => Promise<any> ? T : never {
  const tripleMap = new Map<string, NamedNodeTripleClass | LiteralTripleClass>();

  for (const t of triples) {
    const key = t.type === TripleType.NAMED_NODE
      ? `${t.subject}\u0000${t.predicate}\u0000${t.object}`
      : `${t.subject}\u0000${t.predicate}\u0000${JSON.stringify(t.object)}`;

    if (tripleMap.has(key)) {
      tripleMap.get(key)!.sources!.push(source.url);
    } else {
      const nodes = t.type === TripleType.NAMED_NODE && typeof t.object === 'string'
        ? [t.subject, t.object]
        : [t.subject];
      const obj = {
        subject: t.subject,
        predicate: t.predicate,
        object: t.object,
        sources: [source.url],
        nodes,
        type: t.type
      };
      tripleMap.set(key, t.type === TripleType.NAMED_NODE
        ? obj as NamedNodeTripleClass
        : obj as LiteralTripleClass);
    }
  }

  log.debug(`Processing triples: ${triples.length} input, ${tripleMap.size} unique`);

  return [...tripleMap.values()].map((t) => {
    const nodes = t.type === TripleType.NAMED_NODE && typeof t.object === 'string'
      ? [t.subject, t.object]
      : [];
    return {
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
            nodes,
            type,
          },
          $addToSet: {
            sources: { $each: t.sources }
          }
        },
        upsert: true
      }
    };
  }) as any;
}

interface BulkWriteModel {
  bulkWrite(writes: any[], options?: any): Promise<BulkWriteResult>;
}

async function executeBulkOps(
  model: BulkWriteModel,
  ops: any
): Promise<BulkWriteResult[]> {
  const BATCH_SIZE = 500;
  const results: BulkWriteResult[] = [];

  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    const batchOps = ops.slice(i, i + BATCH_SIZE);
    const result = await model.bulkWrite(batchOps, { ordered: false });
    results.push(result);
  }

  return results;
}

@modelOptions({
  schemaOptions: {
    timestamps: true,
  }
})
@index({ subject: 1, predicate: 1, object: 1 }, { unique: true })
export class NamedNodeTripleClass extends TripleClass {
  @prop({ required: true, validate: urlValidator, type: String })
  public object!: string;

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

@index({ subject: 1, predicate: 1, 'object.value': 1, 'object.language': 1, 'object.datatype': 1 }, { unique: true })
export class LiteralTripleClass extends TripleClass {
  @prop({ required: true, type: LiteralObject })
  public object!: LiteralObject;
}

export const Triple = getModelForClass(TripleClass);
export type TripleDocument = DocumentType<TripleClass>;

export const LiteralTriple = getDiscriminatorModelForClass(Triple, LiteralTripleClass, TripleType.LITERAL);
export type LiteralTripleDocument = DocumentType<LiteralTripleClass>;

export const NamedNodeTriple = getDiscriminatorModelForClass(Triple, NamedNodeTripleClass, TripleType.NAMED_NODE);
export type NamedNodeTripleDocument = DocumentType<NamedNodeTripleClass>;

interface BulkWriteModel {
  bulkWrite(writes: any[], options?: any): Promise<BulkWriteResult>;
}


export function checkForClass(
  doc: TripleDocument,
  type: TripleType.LITERAL
): doc is LiteralTripleDocument;

export function checkForClass(
  doc: TripleDocument,
  type: TripleType.NAMED_NODE
): doc is NamedNodeTripleDocument;

export function checkForClass(
  doc: TripleDocument,
  type: TripleType
): boolean {
  return doc?.type === type;
}




export function isNamedNode(triple: TripleClass): triple is NamedNodeTripleClass {
  return triple.type === TripleType.NAMED_NODE;
}

export function isLiteral(triple: TripleClass): triple is LiteralTripleClass {
  return triple.type === TripleType.LITERAL;
}

