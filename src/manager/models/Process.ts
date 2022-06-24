import mongoose, { Document, model, Model, Schema, Types } from 'mongoose';
import {Resource} from './Resource';
import {Triple, SimpleTriple} from './Triple'

export interface IProcess {
  pid: string,
  notification: {
    email: string,
    webhook: string,
    ssePath:string,
  },
  description: string,
  seeds: Types.Array<string>,
  params: {
    maxPathLength: number,
    maxPathProps: number,
  },
  status: 'queued' | 'running' | 'done' | 'error'
};

export type ProcessDocument = IProcess & Document & { updatedAt: Date, createdAt: Date };
interface IProcessMethods {
  getTriples(): AsyncIterable<SimpleTriple>,
  getTriplesJson(): AsyncIterable<string>
};

interface ProcessModel extends Model<IProcess, {}, IProcessMethods> {
  startNext(): Promise<boolean>
};

const schema = new Schema<IProcess, ProcessModel, IProcessMethods>({
  pid: {
    type: String,
    index: true,
    unique: true
  },
  notification: {
    email: String,
    webhook: String,
    ssePath: String
  },
  description: String,
  seeds: [{
    type: String
  }],
  params: {
    maxPathLength: Number,
    maxPathProps: Number
  },
  status: {
    type: String,
    enum: ['queued', 'running', 'done', 'error'],
    default: 'queued'
  },
}, {timestamps: true});


schema.pre('save', async function() {
  const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
  const count = await this.collection.countDocuments({createdAt: {$gt: today}});
  this.pid = today.toISOString().split('T')[0] + '-' +count;
  this.notification.ssePath = `/processes/${this.pid}/events`;
});

schema.method('getTriples', async function*() {
  const resources = await Resource.find({processIds: this.pid}).select('url').lean();
  const triples = Triple.find({nodes: {$in: resources.map(r => r.url)}});
  for await(const {subject, predicate, object} of triples){
    yield {subject, predicate, object};
  };

  //const resources = Resource.find({processIds: this.pid}).select('url').lean();
  //for await(const r of resources){
  //  const triples = Triple.find({nodes: r.url}).select('subject predicate object').lean();
  //  for await(const {subject, predicate, object} of triples){
  //    yield {subject, predicate, object};
  //  }
  //}
});

schema.method('getTriplesJson', async function*(){
  for await (const t of this.getTriples()){
    yield JSON.stringify(t);
  }
});

// TODO configurable number of simultaneous processes
schema.static('startNext', async function(){
  const runningProcs = await this.countDocuments({status: {$ne: 'queued'}});
  if(!runningProcs){
    const process = await this.findOneAndUpdate(
      {status:'queued'},
      {$set: {status: 'running'}},
      {new: true}
    );
    if(process){
      await Resource.insertSeeds(process.seeds, process.pid);
      return true;
    }
  }
  return false;
});


export const Process = model<IProcess, ProcessModel>('Process', schema);
