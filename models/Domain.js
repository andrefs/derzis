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
    queued: Number,
    success: Number,
    failed: Number,
    nextAllowed: Schema.Types.Date
  },
  lastAccessed: Schema.Types.Date,
}, {timestamps: true});

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
