import { ResourceClass } from './Resource';
import { prop, index, getModelForClass } from '@typegoose/typegoose';

@index({ processId: 1, resource: 1 }, { unique: true })
class ProcessDoneResourceClass {
  @prop({ required: true, type: String })
  public processId!: string;

  @prop({ required: true, ref: 'ResourceClass' })
  public resource!: ResourceClass;
}

const ProcessDoneResource = getModelForClass(ProcessDoneResourceClass, {
  schemaOptions: { timestamps: true, collection: 'processDoneResources' }
});

export { ProcessDoneResource, ProcessDoneResourceClass };
