const mongoose = require('mongoose');
const Resource = require('./Resource');
const Triple = require('./Triple');

const processSchema = new mongoose.Schema({
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


processSchema.pre('save', async function() {
  const today =   this.pid = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
  const count = await this.constructor.countDocuments({createdAt: {$gt: today}});
  this.pid = today.split('T')[0] + '-' +count;
  this.notification.ssePath = `/processes/${this.pid}/events`;
});

processSchema.methods.getTriples = async function*() {
  const resources = Resource.find({processIds: this.pid}).select('url').lean();
  for await(const r of resources){
    const triples = Triple.find({nodes: r.url}).select('subject predicate object').lean();
    for await(const {subject, predicate, object} of triples){
      yield {subject, predicate, object};
    }
  }
};

processSchema.methods.getTriplesJson = async function*(){
  for await (const t of this.getTriples()){
    yield JSON.stringify(t);
  }
};

module.exports = mongoose.model('Process', processSchema);
