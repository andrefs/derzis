const mongoose = require('mongoose');
require('mongoose-type-url');
const ObjectId = mongoose.Types.ObjectId;
const Domain = require('./Domain');
const Path = require('./Path');


const resourceSchema = new mongoose.Schema({
  url: {
    type: mongoose.SchemaTypes.Url,
    index: true,
    unique: true
  },
  domain: {
    type: mongoose.SchemaTypes.Url,
    required: true
  },
  isSeed: {
    type: Boolean,
    required: true,
    default: false
  },
  status: {
    type: String,
    enum: ['unvisited', 'done', 'crawling', 'error'],
    default: 'unvisited'
  },
  triples: [{
    type: ObjectId,
    ref: 'Triple'
  }],
  paths: [{
    type: ObjectId,
    ref: 'Path'
  }]
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


resourceSchema.statics.insertSeeds = async function(urls){
  const pathCount = await Path.count();
  if(pathCount){
    log.error(`Cannot start from the beginning, ${pathCount} paths already found`);
    return;
  }

  const seeds = urls.map(u => ({
    isSeed: true,
    url: u,
    domain: new URL(u).origin
  }));

  await this.upsertMany(seeds);

  const paths = await Path.create(seeds.map(s => ({
    seed: {
      url: s.url
    },
    head: {
      url: s.url,
      domain: s.domain
    },
    'length': 1,
    predicates: [],
    status: 'active'
  })));

  return Path.create(paths);
};

module.exports = mongoose.model('Resource', resourceSchema);
