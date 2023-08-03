import { Schema, model, Model, Document } from 'mongoose';
import { createLogger } from '@derzis/common';
import { SimpleTriple } from './Triple';
const log = createLogger('Counter');

export interface IProcessTriple {
  processId: String;
  triple: SimpleTriple;
}

interface IProcessTripleDocument extends IProcessTriple, Document {}

interface IProcessTripleModel extends Model<IProcessTripleDocument> {}

const ProcessTripleSchema: Schema<IProcessTripleDocument> = new Schema(
  {
    processId: {
      type: String,
      required: true,
    },
    triple: {
      type: Schema.Types.ObjectId,
      ref: 'Triple',
      required: true,
    },
  },
  { timestamps: true }
);

ProcessTripleSchema.index(
  {
    processId: 1,
    triple: 1,
  },
  { unique: true }
);

export const ProcessTriple = model<IProcessTripleDocument, IProcessTripleModel>(
  'ProcessTriple',
  ProcessTripleSchema
);
