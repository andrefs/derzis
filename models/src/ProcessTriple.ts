import { TripleClass, Triple } from './Triple';
import { prop, index, getModelForClass, ModelOptions, Severity } from '@typegoose/typegoose';

@index({ processId: 1, triple: 1 }, { unique: true })
class ProcessTripleClass {
	@prop({ required: true, type: String })
	public processId!: string;

	@prop({ required: true, ref: 'TripleClass' })
	public triple!: TripleClass;
}

const ProcessTriple = getModelForClass(ProcessTripleClass, {
	schemaOptions: { timestamps: true, collection: 'processTriples' }
});

export { ProcessTriple, ProcessTripleClass };
