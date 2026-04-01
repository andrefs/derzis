import {
  prop,
  PropType,
  getModelForClass,
  type ReturnModelType,
  modelOptions,
  getDiscriminatorModelForClass,
  index
} from '@typegoose/typegoose';
import {
  urlValidator,
  urlOrBlankNodeValidator,
  type SimpleTriple,
  directionOk,
  TripleType,
  type BlankNodeObject
} from '@derzis/common';
import config from '@derzis/config';
import type { BulkWriteResult } from 'mongodb';
import { createLogger } from '@derzis/common/server';
import { type DocumentType } from '@typegoose/typegoose/lib/types';
import { BranchFactorClass } from '../Process';
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

export class BlankNodeObjectClass {
  @prop({ required: true, type: String })
  public id!: string;
}

@modelOptions({
  schemaOptions: {
    discriminatorKey: 'type',
    timestamps: true,
    collection: 'triples'
  }
})
@index({ type: 1, nodes: 1, createdAt: 1 })
@index({ nodes: 1, createdAt: 1 })
@index({ updatedAt: -1 })
@index({ nodes: 1, predicate: 1 })
@index({ object: 1, predicate: 1 }) // for object-origin queries
@index({ predicate: 1 }) // for metrics queries
@index({ predicate: 1, subject: 1 }) // for metrics queries with subject filter
export class TripleClass extends TimeStamps {
  @prop({ required: true, validate: urlOrBlankNodeValidator, type: String, index: true })
  public subject!: string;

  @prop({ required: true, validate: urlOrBlankNodeValidator, type: String })
  public predicate!: string;

  @prop(
    { default: [], validate: urlOrBlankNodeValidator, type: [String], index: true },
    PropType.ARRAY
  )
  public nodes!: string[];

  @prop(
    { default: [], validate: urlOrBlankNodeValidator, type: [String], index: true },
    PropType.ARRAY
  )
  public sources?: string[];

  @prop({ required: true, enum: TripleType, type: String, index: true })
  public type!: TripleType;

  public static async upsertMany(
    this: ReturnModelType<typeof TripleClass>,
    sourceUrl: string,
    triples: SimpleTriple[]
  ): Promise<BulkWriteResult[]> {
    if (!triples || !triples.length) {
      log.debug('No triples to upsert');
      return [];
    }

    const allowBlankNodes = config.allowBlankNodes ?? false;

    const allowedTriples = allowBlankNodes
      ? triples
      : triples.filter((t) => t.type !== TripleType.BLANK_NODE);

    const namedNodeTriples = allowedTriples.filter((t) => t.type === TripleType.NAMED_NODE);
    const literalTriples = allowedTriples.filter((t) => t.type === TripleType.LITERAL);
    const blankNodeTriples = allowedTriples.filter((t) => t.type === TripleType.BLANK_NODE);

    const results: BulkWriteResult[] = [];

    if (namedNodeTriples.length > 0) {
      const namedNodeOps = buildBulkOps(namedNodeTriples, sourceUrl, TripleType.NAMED_NODE);
      const namedNodeResults = await executeBulkOps(NamedNodeTriple, namedNodeOps);
      results.push(...namedNodeResults);
    }

    if (literalTriples.length > 0) {
      const literalOps = buildBulkOps(literalTriples, sourceUrl, TripleType.LITERAL);
      const literalResults = await executeBulkOps(LiteralTriple, literalOps);
      results.push(...literalResults);
    }

    if (blankNodeTriples.length > 0) {
      const blankNodeOps = buildBulkOps(blankNodeTriples, sourceUrl, TripleType.BLANK_NODE);
      const blankNodeResults = await executeBulkOps(BlankNodeTriple, blankNodeOps);
      results.push(...blankNodeResults);
    }

    return results;
  }
}

interface TripleForBulkOps {
  subject: string;
  predicate: string;
  object: string | LiteralObject | BlankNodeObject;
  sources: string[];
  nodes: string[];
  type: TripleType;
}

function buildBulkOps(
  triples: SimpleTriple[],
  sourceUrl: string,
  type: TripleType
): ReturnModelType<typeof TripleClass>['bulkWrite'] extends (
  ops: infer T
) => Promise<BulkWriteResult>
  ? T
  : never {
  const tripleMap = new Map<string, TripleForBulkOps>();

  for (const t of triples) {
    const key =
      t.type === TripleType.NAMED_NODE
        ? `${t.subject}\u0000${t.predicate}\u0000${t.object}`
        : `${t.subject}\u0000${t.predicate}\u0000${JSON.stringify(t.object)}`;

    if (tripleMap.has(key)) {
      const existing = tripleMap.get(key);
      if (existing && existing.sources) {
        existing.sources.push(sourceUrl);
      }
    } else {
      const nodes =
        t.type === TripleType.NAMED_NODE && typeof t.object === 'string'
          ? [t.subject, t.object]
          : t.type === TripleType.BLANK_NODE && typeof t.object === 'object' && 'id' in t.object
            ? [t.subject, t.object.id]
            : [t.subject];
      const obj = {
        subject: t.subject,
        predicate: t.predicate,
        object: t.object,
        sources: [sourceUrl],
        nodes,
        type: t.type
      };
      tripleMap.set(key, obj);
    }
  }

  log.debug(`Processing triples: ${triples.length} input, ${tripleMap.size} unique`);

  return [...tripleMap.values()].map((t) => {
    const nodes =
      t.type === TripleType.NAMED_NODE && typeof t.object === 'string'
        ? [t.subject, t.object]
        : t.type === TripleType.BLANK_NODE && typeof t.object === 'object' && 'id' in t.object
          ? [t.subject, t.object.id]
          : [t.subject];
    const filter = {
      subject: t.subject,
      predicate: t.predicate,
      ...(isLiteral(t)
        ? {
            'object.value': t.object.value,
            'object.language': t.object.language,
            'object.datatype': t.object.datatype
          }
        : t.type === TripleType.BLANK_NODE && typeof t.object === 'object' && 'id' in t.object
          ? { 'object.id': t.object.id }
          : { object: t.object })
    };
    return {
      updateOne: {
        filter,
        update: {
          $setOnInsert: {
            subject: t.subject,
            predicate: t.predicate,
            object: t.object,
            nodes,
            type: t.type
          },
          $addToSet: {
            sources: { $each: t.sources }
          }
        },
        upsert: true
      }
    };
  });
}

interface BulkWriteModel {
  bulkWrite(writes: unknown[], options?: unknown): Promise<BulkWriteResult>;
}

async function executeBulkOps(model: BulkWriteModel, ops: unknown): Promise<BulkWriteResult[]> {
  const BATCH_SIZE = 100;
  const results: BulkWriteResult[] = [];

  const opArray = Array.isArray(ops) ? ops : [];
  for (let i = 0; i < opArray.length; i += BATCH_SIZE) {
    const batchOps = opArray.slice(i, i + BATCH_SIZE);
    const result = await model.bulkWrite(batchOps, { ordered: false });
    results.push(result);
  }

  return results;
}

@modelOptions({
  schemaOptions: {
    timestamps: true
  }
})
@index({ subject: 1, predicate: 1, object: 1 }, { unique: true })
@index({ predicate: 1, object: 1 }) // for metrics queries with object filter
export class NamedNodeTripleClass extends TripleClass {
  @prop({ required: true, validate: urlOrBlankNodeValidator, type: String })
  public object!: string;

  public directionOk(
    headUrl: string,
    followDirection: boolean,
    predsBF?: Map<string, BranchFactorClass>
  ): boolean {
    if (!followDirection) {
      return true;
    }

    if (!predsBF || !predsBF.size) {
      log.warn('Predicate branching factor not provided, cannot enforce directionality');
      return true;
    }

    if (!predsBF.has(this.predicate)) {
      return true;
    }

    const bf = predsBF.get(this.predicate);
    if (!bf) return true;
    const bfRatio = bf.subj / bf.obj;

    const dOk = directionOk(
      {
        subject: this.subject,
        predicate: this.predicate,
        object: this.object,
        type: TripleType.NAMED_NODE as const
      },
      headUrl,
      bfRatio
    );

    log.silly(
      `Direction ${dOk ? '' : 'not '}ok for head url ${headUrl} and triple ${this.subject} ${this.predicate} ${this.object}`
    );
    return dOk;
  }
}

@index(
  { subject: 1, predicate: 1, 'object.value': 1, 'object.language': 1, 'object.datatype': 1 },
  { unique: true }
)
export class LiteralTripleClass extends TripleClass {
  @prop({ required: true, type: LiteralObject })
  public object!: LiteralObject;
}

@index({ subject: 1, predicate: 1, 'object.id': 1 }, { unique: true })
export class BlankNodeTripleClass extends TripleClass {
  @prop({ required: true, type: BlankNodeObjectClass })
  public object!: BlankNodeObjectClass;
}

export const Triple = getModelForClass(TripleClass);
export type TripleDocument = DocumentType<TripleClass>;

export const LiteralTriple = getDiscriminatorModelForClass(
  Triple,
  LiteralTripleClass,
  TripleType.LITERAL
);
export type LiteralTripleDocument = DocumentType<LiteralTripleClass>;

export const NamedNodeTriple = getDiscriminatorModelForClass(
  Triple,
  NamedNodeTripleClass,
  TripleType.NAMED_NODE
);
export type NamedNodeTripleDocument = DocumentType<NamedNodeTripleClass>;

export const BlankNodeTriple = getDiscriminatorModelForClass(
  Triple,
  BlankNodeTripleClass,
  TripleType.BLANK_NODE
);
export type BlankNodeTripleDocument = DocumentType<BlankNodeTripleClass>;

export function checkForClass(
  doc: TripleDocument,
  type: TripleType.LITERAL
): doc is LiteralTripleDocument;

export function checkForClass(
  doc: TripleDocument,
  type: TripleType.NAMED_NODE
): doc is NamedNodeTripleDocument;

export function checkForClass(doc: TripleDocument, type: TripleType): boolean {
  return doc?.type === type;
}

export function isNamedNode(
  triple: TripleClass | TripleDocument
): triple is NamedNodeTripleClass | NamedNodeTripleDocument {
  return triple.type === TripleType.NAMED_NODE;
}

export function isLiteral(
  triple: TripleClass | TripleDocument
): triple is LiteralTripleClass | LiteralTripleDocument {
  return triple.type === TripleType.LITERAL;
}

export function isBlankNode(
  triple: TripleClass | TripleDocument
): triple is BlankNodeTripleClass | BlankNodeTripleDocument {
  return triple.type === TripleType.BLANK_NODE;
}
