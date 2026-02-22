import { urlValidator } from '@derzis/common';
import { prop, index, getModelForClass } from '@typegoose/typegoose';
import { TimeStamps } from '@typegoose/typegoose/lib/defaultClasses';

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

  @prop({ type: [String], default: [] })
  public labels?: string[];

  @prop({ type: [String], default: [] })
  public comments?: string[];

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
