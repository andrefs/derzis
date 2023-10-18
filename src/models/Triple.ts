import { Model, Schema, Types } from 'mongoose';
import { BulkWriteResult } from 'mongodb';
import { UrlType } from '@derzis/common';
import { ResourceClass } from './Resource';
import {
  prop,
  Severity,
  ModelOptions,
  index,
  getModelForClass,
  ReturnModelType,
} from '@typegoose/typegoose';
import { Document } from 'cheerio';

@ModelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'triples',
  },
  options: {
    allowMixed: Severity.ALLOW,
  },
})
@index({ nodes: 1 })
@index({ subject: 1, predicate: 1, object: 1 }, { unique: true })
class TripleClass {
  @prop({ required: true })
  public subject!: UrlType;

  @prop({ required: true })
  public predicate!: UrlType;

  @prop({ required: true })
  public object!: UrlType;

  @prop({ default: [] })
  public nodes?: UrlType[];

  @prop({ default: [] })
  public sources?: UrlType[];

  public static async upsertMany(
    this: ReturnModelType<typeof TripleClass>,
    source: ResourceClass,
    triples: TripleClass[]
  ): Promise<BulkWriteResult> {
    const ops = triples.map((t: TripleClass) => ({
      updateOne: {
        filter: t,
        update: {
          $setOnInsert: {
            nodes: [t.subject, t.object],
          },
          $addToSet: {
            sources: source.url,
          },
        },
        upsert: true,
      },
    }));

    return this.bulkWrite(ops, { ordered: false });
  }
}
const Triple = getModelForClass(TripleClass, {
  schemaOptions: { timestamps: true },
});
type TripleDocument = TripleClass & Document;
export { Triple, TripleClass, TripleDocument };
