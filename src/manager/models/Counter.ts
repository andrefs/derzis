import { Schema, model, Model, Document } from "mongoose";
import { createLogger } from 'src/common';
const log = createLogger('Counter');

export interface ICounter {
  name: String,
  value: number
}

interface ICounterDocument extends ICounter, Document {};
interface ICounterModel extends Model<ICounterDocument> {
  genId: (name: String) => Promise<number>
};

interface ICounterDocument extends ICounter, Document {};

const CounterSchema: Schema<ICounterDocument> = new Schema({
  name: {
    type: String,
    required: true
  },
  value: {
    type: Number,
    required: true,
    default: 0
  }
}, {timestamps: true});

CounterSchema.index({
  name: 1,
});


CounterSchema.statics.genId = async function(name: string){
  const c = await this.findOneAndUpdate(
    {name: 'jobs'},
    {$inc: {value: 1}},
    {
      upsert: true,
      returnDocument: 'after',
      lean: true,
      projection: 'value'
    }
  );
  log.debug(`Generated job id ${c.value}`)
  return c.value;
};

export const Counter = model<ICounterDocument, ICounterModel>('Counter', CounterSchema);

