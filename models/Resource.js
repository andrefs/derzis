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


resourceSchema.statics.addMany = async function(resources){
  let insertedDocs = [];
  let existingDocs = [];
  await this.insertMany(resources, {ordered: false})
    .then(docs => insertedDocs = docs)
    .catch(err => {
      for(const e of err.writeErrors){
        if(e.err.code && e.err.code === 11000){
          existingDocs.push(resources[e.err.index]);
        }
        // TO DO handle other errors
      }
      insertedDocs = err.insertedDocs;
    });

  await Domain.upsertMany(insertedDocs.map(d => d.domain));
  return insertedDocs;
};

resourceSchema.statics.markAsCrawled = async function(url, ts){
  const res = await this.updateOne({url}, {status:'done'});
  let d = await Domain.findOne({origin: new URL(url).origin});
  d.crawl.queued--;
  d.crawl.success++;
  d.crawl.nextAllowed = new Date(ts + d.crawl.delay*1000);
  await d.save();
  return {
    resource: res,
    domain: d
  };
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

  await this.addMany(seeds);

  const paths = await Path.create(seeds.map(s => ({
    seed: {url: s.url},
    head: {url: s.url},
    nodes: {elems: [s.url]},
    predicates: {elems: []},
    status: 'active'
  })));

  return Path.create(paths);
};

module.exports = mongoose.model('Resource', resourceSchema);
