import { model, Model, Schema, Types } from 'mongoose';
import { BulkWriteResult } from 'mongodb';
import {urlType} from '@derzis/common';
import { IResource } from './Resource';

export interface ITriple {
  subject: string,
  predicate: string,
  object: string,
  nodes: Types.Array<string>,
  sources:  Types.Array<string>,
  processIds: Types.Array<string>
};

export interface SimpleTriple {
  subject: string,
  predicate: string,
  object: string
};

interface TripleModel extends Model<ITriple> {
  upsertMany(source: IResource, triples: SimpleTriple[]): Promise<BulkWriteResult>
};

const schema = new Schema<ITriple, TripleModel>({
  subject:   {...urlType, required: true},
  predicate: {...urlType, required: true},
  object:    {...urlType, required: true}, // TODO allow literals
  nodes:   [urlType],
  sources: [urlType],
  processIds: [String]
}, {timestamps: true});

schema.index({nodes:1});
schema.index({subject:1, predicate:1, object:1}, {unique: true});
schema.index({processIds: 1});

schema.static('upsertMany',  async function upsertMany(source, triples){
  const ops = triples.map((t: SimpleTriple) => ({
    updateOne: {
      filter: t,
      update: {
        '$setOnInsert': {
          nodes: [t.subject, t.object],
        },
        '$addToSet': {
          sources: source.url,
          processIds: {$each: source.processIds}
        }
      },
      upsert: true
    }
  }));
  return this.bulkWrite(ops, {ordered: false});
});

export const Triple = model<ITriple, TripleModel>('Triple', schema);

