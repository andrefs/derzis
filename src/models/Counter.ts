import { createLogger } from '@derzis/common';
const log = createLogger('Counter');
import {
  ModelOptions,
  ReturnModelType,
  Severity,
  getModelForClass,
  index,
  prop,
} from '@typegoose/typegoose';

@index({ name: 1 })
class CounterClass {
  @prop({ required: true })
  name!: string;

  @prop({ required: true, default: 0 })
  value!: number;

  public static async genId(
    this: ReturnModelType<typeof CounterClass>,
    name: string
  ) {
    const c = await this.findOneAndUpdate(
      { name },
      { $inc: { value: 1 } },
      {
        upsert: true,
        returnDocument: 'after',
        lean: true,
        projection: 'value',
      }
    );
    log.debug(`Generated job id ${c!.value}`);
    return c!.value;
  }
}

const Counter = getModelForClass(CounterClass, {
  schemaOptions: { timestamps: true, collection: 'counters' },
});

export { Counter, CounterClass };
