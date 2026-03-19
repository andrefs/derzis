import { TimeStamps } from '@typegoose/typegoose/lib/defaultClasses';
import { TripleClass, Triple, NamedNodeTripleClass, LiteralTripleClass } from './Triple';
import {
  prop,
  index,
  getModelForClass,
  type ReturnModelType,
  type Ref
} from '@typegoose/typegoose';
import { Types } from 'mongoose';
import { TripleType } from '@derzis/common';

interface ProcessTripleInput {
  processId: string;
  triple: TripleClass | Types.ObjectId;
  tripleType: TripleType;
  processStep: number;
}

function isObjectId(value: unknown): value is Types.ObjectId {
  return value instanceof Types.ObjectId;
}

function hasId(value: unknown): value is { _id: unknown } {
  return typeof value === 'object' && value !== null && '_id' in value;
}

function getTripleId(triple: ProcessTripleInput['triple']): string {
  if (isObjectId(triple)) {
    return triple.toString();
  }
  if (hasId(triple)) {
    return String(triple._id);
  }
  return String(triple);
}

@index({ processId: 1, triple: 1 }, { unique: true })
class ProcessTripleClass extends TimeStamps {
  @prop({ required: true, type: String })
  public processId!: string;

  @prop({ required: true, ref: Triple })
  public triple!: Ref<TripleClass>;

  @prop({ required: true, enum: TripleType, type: String })
  public tripleType!: TripleType;

  @prop({ required: true, type: Number })
  public processStep!: number;

  public static async upsertMany(
    this: ReturnModelType<typeof ProcessTripleClass>,
    triples: ProcessTripleInput[]
  ) {
    const uniqueTriples = Array.from(
      new Map(
        triples.map((t) => [ `${t.processId}_${getTripleId(t.triple)}`, t])
      ).values()
    );

    const bulkOps = uniqueTriples.map((t) => {
      const tripleId = isObjectId(t.triple) ? t.triple : new Types.ObjectId(getTripleId(t.triple));
      return {
        updateOne: {
          filter: { processId: t.processId, triple: tripleId },
          update: { $set: { ...t, triple: tripleId } },
          upsert: true
        }
      };
    });

    if (bulkOps.length === 0) {
      return;
    }

    const BATCH_SIZE = 100;
    for (let i = 0; i < bulkOps.length; i += BATCH_SIZE) {
      const batchOps = bulkOps.slice(i, i + BATCH_SIZE);
      await this.bulkWrite(batchOps, { ordered: false });
    }
  }
}

const ProcessTriple = getModelForClass(ProcessTripleClass, {
  schemaOptions: { timestamps: true, collection: 'processTriples' }
});

export { ProcessTriple, ProcessTripleClass };
