import { TripleClass } from './Triple';
import { prop, index, getModelForClass } from '@typegoose/typegoose';

@index({ processId: 1, triple: 1 }, { unique: true })
class ProcessTripleClass {
  @prop({ required: true })
  public processId!: string;

  @prop({ required: true, ref: 'Triple' })
  public triple!: TripleClass;
}

const ProcessTriple = getModelForClass(ProcessTripleClass, {
  schemaOptions: { timestamps: true },
});

export { ProcessTriple, ProcessTripleClass };
