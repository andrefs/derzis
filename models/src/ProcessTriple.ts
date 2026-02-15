import { TimeStamps } from '@typegoose/typegoose/lib/defaultClasses';
import { TripleClass } from './Triple';
import { prop, index, getModelForClass, type ReturnModelType } from '@typegoose/typegoose';
import { Types } from 'mongoose';

@index({ processId: 1, triple: 1 }, { unique: true })
class ProcessTripleClass extends TimeStamps {
  @prop({ required: true, type: String })
  public processId!: string;

  @prop({ required: true, ref: 'TripleClass' })
  public triple!: TripleClass;

  @prop({ required: true, type: Number })
  public processStep!: number;

  public static async upsertMany(
    this: ReturnModelType<typeof ProcessTripleClass>,
    triples: ProcessTripleInput[]
  ) {
    const uniqueTriples = Array.from(
      new Map(
        triples.map((t) => [`${t.processId}_${(t.triple as any)._id || t.triple}`, t])
      ).values()
    );

    const bulkOps = uniqueTriples.map((t) => ({
      updateOne: {
        filter: { processId: t.processId, triple: t.triple },
        update: { $set: t },
        upsert: true
      }
    }));

    if (bulkOps.length > 0) {
      await this.bulkWrite(bulkOps);
    }
  }
}

const ProcessTriple = getModelForClass(ProcessTripleClass, {
  schemaOptions: { timestamps: true, collection: 'processTriples' }
});

interface ProcessTripleInput {
  processId: string;
  triple: TripleClass | Types.ObjectId;
  processStep: number;
}

export { ProcessTriple, ProcessTripleClass };
