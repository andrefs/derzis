import type { Types } from 'mongoose';
import { urlValidator, TripleType } from '@derzis/common';
import { prop, index, getModelForClass, PropType, modelOptions } from '@typegoose/typegoose';
import { TimeStamps } from '@typegoose/typegoose/lib/defaultClasses';

@modelOptions({ schemaOptions: { _id: false, discriminatorKey: 'type' } })
export class LabelTripleBase {
  @prop({ required: true, validate: urlValidator, type: String })
  public subject!: string;

  @prop({ required: true, validate: urlValidator, type: String })
  public predicate!: string;
}

export class LabelNamedNodeTriple extends LabelTripleBase {
  @prop({ required: true, enum: TripleType, type: String, default: TripleType.NAMED_NODE })
  public type!: typeof TripleType.NAMED_NODE;

  @prop({ required: true, type: String })
  public object!: string;
}

export class LabelLiteralTriple extends LabelTripleBase {
  @prop({ required: true, enum: TripleType, type: String, default: TripleType.LITERAL })
  public type!: typeof TripleType.LITERAL;

  @prop({ required: true, type: String })
  public value!: string;

  @prop({ type: String })
  public datatype?: string;

  @prop({ type: String })
  public language?: string;
}

export type LabelTriple = LabelNamedNodeTriple | LabelLiteralTriple;

@index({ pid: 1, url: 1 }, { unique: true })
@index({ createdAt: 1 })
@index({ status: 1 })
class ResourceLabelClass extends TimeStamps {
  @prop({ required: true, type: String })
  public pid!: string;

  @prop({ required: true, validate: urlValidator, type: String })
  public url!: string;

  @prop({ required: true, type: String })
  public domain!: string;

  @prop({
    default: [],
    type: LabelTripleBase,
    discriminators: () => [
      { type: LabelNamedNodeTriple, value: TripleType.NAMED_NODE },
      { type: LabelLiteralTriple, value: TripleType.LITERAL }
    ]
  }, PropType.ARRAY)
  public triples?: Types.DocumentArray<LabelTriple>;

  @prop({ required: true, enum: ['web', 'cardea'], type: String })
  public source!: 'web' | 'cardea';

  @prop({ required: true, enum: ['new', 'done', 'error'], default: 'new', type: String })
  public status!: 'new' | 'done' | 'error';

  @prop({ required: true, type: Boolean, default: false })
  public extend!: boolean;
}

const ResourceLabel = getModelForClass(ResourceLabelClass, {
  schemaOptions: { collection: 'resourceLabels' }
});

export { ResourceLabel, ResourceLabelClass };
