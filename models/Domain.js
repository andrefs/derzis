const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const domainSchema = new mongoose.Schema({
  host: {
    type: String,
    index: true,
    required: true,
    unique: true
  },
  status: {
    type: String,
    enum: ['unvisited', 'checking', 'error', 'ready', 'crawling'],
    default: 'unvisited'
  },
  robots: {
    status: {
      type: String,
      enum: ['unvisited', 'checking', 'not_found', 'error', 'done'],
      default: 'unvisited'
    },
    text: String,
    checked: Schema.Types.Date,
    elapsedTime: Number
    // host, protocol, actual host, ...
  },
  workerId: String,
  crawl: {
    delay: Number,
    queued: {
      type: Number,
      default: 0
    },
    success: {
      type: Number,
      default: 0
    },
    failed: {
      type: Number,
      default: 0
    },
    nextAllowed: Schema.Types.Date
  },
  lastAccessed: Schema.Types.Date,
}, {timestamps: true});

domainSchema.statics.upsertMany = async function(docs){
  let domains = {};

  for(const d of docs){
    if(!domains[d]){
      domains[d] = {
        filter: {host: d},
        update: {
          '$inc': {'crawl.queued': 0},
          '$setOnInsert': {
            'robots.status': 'unvisited',
            status: 'unvisited',
            'crawl.failed': 0,
            'crawl.success': 0
          }
        },
        upsert: true
      };
    }
    domains[d]['update']['$inc']['crawl.queued']++;
  };
  return this.bulkWrite(Object.values(domains).map(d => ({updateOne: d})));
};

domainSchema.statics.domainsToCheck = async function*(wId, limit){
  const query = {robots: {status: 'unvisited'}};
  const update = {
    '$set': {
      'robots.status': 'checking',
      workerId: wId
    }
  };
  const options = {
    new:true,
    fields: 'host'
  };
  for(let i=0; i<limit; i++){
    const d = await this.findOneAndUpdate(query, update, options).lean();
    if(d){ yield d; }
    else { return; }
  }
  return;
};

domainSchema.statics.domainsToCrawl = async function*(wId, limit){
  const query = {
    status: 'ready',
    'crawl.queued': {'$gt': 0},
    'crawl.nextAllowed': {'$lte': Date.now()}
  };
  const update = {'$set': {status: 'crawling', workerId: wId}};
  const options = {
    new:true,
    fields: 'host crawl.delay robots.text'
  };
  for(let i=0; i<limit; i++){
    const d = await this.findOneAndUpdate(query, update, options).lean();
    if(d){
      if(d.robots && !Object.keys(d.robots).length){ delete d.robots; }
      yield d;
    }
    else { return; }
  }
  return;
};


// domainSchema.status.domainsToCrawl


module.exports = mongoose.model('Domain', domainSchema);
