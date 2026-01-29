import { TimeStamps } from '@typegoose/typegoose/lib/defaultClasses';
import { TripleClass } from './Triple';
import { prop, index, getModelForClass } from '@typegoose/typegoose';

@index({ processId: 1, triple: 1 }, { unique: true })
class ProcessTripleClass extends TimeStamps {
	@prop({ required: true, type: String })
	public processId!: string;

	@prop({ required: true, ref: 'TripleClass' })
	public triple!: TripleClass;

	@prop({ required: true, type: Number })
	public processStep!: number;
}

const ProcessTriple = getModelForClass(ProcessTripleClass, {
	schemaOptions: { timestamps: true, collection: 'processTriples' }
});

export { ProcessTriple, ProcessTripleClass };
