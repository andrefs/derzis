import { Schema, model, Model, Document } from "mongoose";

export interface ICounter {
  name: String,
  value: number
}

interface ICounterDocument extends ICounter, Document {};
interface ICounterModel extends Model<ICounterDocument> {};


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


export const Counter = model<ICounterDocument, ICounterModel>('Counter', CounterSchema);

