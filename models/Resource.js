const mongoose = require('mongoose');
require('mongoose-type-url');
const ObjectId = mongoose.Types.ObjectId;
const Domain = require('./Domain');


const resourceSchema = new mongoose.Schema({
  url: {
    type: mongoose.SchemaTypes.Url,
    index: true,
    unique: true
  },
  domain: {
    type: String,
    required: true
  },
  source: {
    project: {
      type: mongoose.Types.ObjectId,
      ref: 'Project'
    },
    distance: Number,
    resource: {
      type: mongoose.Types.ObjectId,
      ref: 'Resource'
    }
  },
  status: {
    type: String,
    enum: ['unvisited', 'done', 'crawling', 'error'],
    default: 'unvisited'
  },
  priority: {
    type: Number,
    default: 5
  },
  totalTriples: Number
}, {timestamps: true});

resourceSchema.statics.upsertMany = async function(resources){
  let insertedDocs = [];
  let existingDocs = [];
  await this.insertMany(resources, {ordered: false})
    .then(docs => insertedDocs = docs)
    .catch(err => {
      for(const e of err.writeErrors){
        if(e.err.code && e.err.code === 11000){
          existingDocs.push(resources[e.err.index]);
          // TO DO update existing resources
        }
        // TO DO handle other errors
      }
      insertedDocs = err.insertedDocs;
    });

  return Domain.upsertMany(insertedDocs.map(d => d.domain));
};

resourceSchema.statics.resourcesToCrawl = async function(domain, workerId, limit){
  const query = {status: 'unvisited', domain};
  return this.find(query).select('url domain').limit(limit).lean();
};

module.exports = mongoose.model('Resource', resourceSchema);
