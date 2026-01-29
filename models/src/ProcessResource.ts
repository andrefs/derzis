import { ResourceClass } from './Resource';
import { prop, index, getModelForClass } from '@typegoose/typegoose';

@index({ processId: 1, resource: 1 }, { unique: true })
class ProcessResourceClass {
	@prop({ required: true, type: String })
	public processId!: string;

	@prop({ required: true, ref: 'ResourceClass' })
	public resource!: ResourceClass;
}

const ProcessResource = getModelForClass(ProcessResourceClass, {
	schemaOptions: { timestamps: true, collection: 'processResources' }
});

export { ProcessResource, ProcessResourceClass };
