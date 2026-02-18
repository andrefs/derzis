import type { Types } from 'mongoose';
import {
  prop,
  PropType
} from '@typegoose/typegoose';
import { urlValidator } from '@derzis/common';


export abstract class TripleClass {
  _id!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;

  @prop({ required: true, validate: urlValidator, type: String })
  public subject!: string;

  @prop({ required: true, validate: urlValidator, type: String })
  public predicate!: string;

  @prop({ default: [], validate: urlValidator, type: [String] }, PropType.ARRAY)
  public nodes?: string[];

  @prop({ default: [], validate: urlValidator, type: [String] }, PropType.ARRAY)
  public sources?: string[];


  @prop({ enum: ['literal', 'namedNode'], required: true, type: String })
  public type!: 'literal' | 'namedNode';
}
