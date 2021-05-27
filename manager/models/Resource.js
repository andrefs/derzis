const mongoose = require('mongoose');
const {urlType} = require('../../common/lib/mongoose-types');
const ObjectId = mongoose.Types.ObjectId;
const Domain = require('./Domain');
const Path = require('./Path');
const log = require('../../common/lib/logger')('Resource');
const Schema = mongoose.Schema;


const resourceSchema = new mongoose.Schema({
  url: {...urlType, index: true, unique: true},
  domain: {...urlType, required: true},
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
  }],
  headCount: {
    type: Number,
    default: 0
  },
  crawlId: {
    domainTs: Schema.Types.Date,
    counter: Number
  }
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

  if(insertedDocs.length){
    await Domain.upsertMany(insertedDocs.map(d => d.domain));
  }
  return insertedDocs;
};

resourceSchema.statics.markAsCrawled = async function(url, details, error){
  // Resource
  const oldRes = await this.findOneAndUpdate({url, status: 'unvisited'}, {
    status: error? 'error' :'done',
    paths: [],
    headCount: 0,
    crawlId: details.crawlId
  });


  // Paths
  const path = await Path.updateMany({'head.url': url}, {
    'head.alreadyCrawled': true
  });

  // Domain
  let filter = {origin: new URL(url).origin};
  let d = await Domain.findOne(filter);

  if(oldRes){
    let update = error ? {'$inc': {'crawl.failed':  1}}
                       : {'$inc': {'crawl.success': 1}};
    update['$inc']['crawl.queued'] = -1;
    update['$inc']['crawl.pathHeads'] = -oldRes.headCount;
    await d.updateOne(update);
  }

  const nextAllowed = new Date(details.ts + d.crawl.delay);
  filter['crawl.nextAllowed'] = {'$lt': nextAllowed};
  d = await Domain.updateOne(filter,{'crawl.nextAllowed': nextAllowed});

  return {
    path,
    domain: d
  };
};

resourceSchema.statics.insertSeeds = async function(urls){
  // const pathCount = await Path.estimatedDocumentCount();
  // if(pathCount){
  //   log.error(`Cannot start from the beginning, ${pathCount} paths already found`);
  //   return;
  // }

  const seeds = urls.map(u => ({
    isSeed: true,
    url: u,
    domain: new URL(u).origin
  }));

  const insResources = await this.addMany(seeds);
  if(!insResources.length){
    log.warn('Seed resources already in database', insResources);
    return;
  }

  const paths = seeds.map(s => ({
    seed: {url: s.url},
    head: {url: s.url},
    nodes: {elems: [s.url]},
    predicates: {elems: []},
    status: 'active'
  }));

  const insPaths = await Path.create(paths);
  return this.addPaths(insPaths);
};


resourceSchema.statics.addPaths = async function(paths){
  const res = await this.bulkWrite(paths.map(p => ({
    updateOne: {
      filter: {url: p.head.url},
      update: {
        '$addToSet': {paths: p._id},
        '$inc': {headCount: 1}
      }
    }
  })));
  const dom = await Domain.bulkWrite(paths.map(p => ({
    updateOne: {
      filter: {origin: p.head.domain},
      update: {'$inc': {'crawl.pathHeads': 1}}
    }
  })));
  return {res,dom};
};

resourceSchema.statics.rmPath = async function(path){
  const res = await this.updateOne({url: path.head.url, paths: ObjectId(path._id)}, {
    '$pull': {paths: ObjectId(path._id)},
    '$inc': {headCount: -1}
  });
  if(res.ok && res.nModified){
    await Domain.updateOne({origin: path.head.domain}, {'$inc': {'crawl.headCount': -1}});
  }
}

module.exports = mongoose.model('Resource', resourceSchema);
