const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const errorTypes = ['E_ROBOTS_TIMEOUT', 'E_RESOURCE_TIMEOUT'];

const domainSchema = new mongoose.Schema({
  origin: {
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
  err: {
    last: [{
      errType: {
        type: String,
        enum: errorTypes,
      }
    }],
    count: {
      E_ROBOTS_TIMEOUT: {
        type: Number,
        default: 0,
      },
      E_RESOURCE_TIMEOUT: {
        type: Number,
        default: 0,
      }
    }
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
    pathHeads: {
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
  processIds: [String]
}, {timestamps: true});

domainSchema.index({
  status: 1,
  'crawl.pathHeads': 1,
  'crawl.nextAllowed': -1
});

domainSchema.index({
  'crawl.nextAllowed': -1
});

domainSchema.index({
  'robots.status': 1
});

domainSchema.statics.upsertMany = async function(urls, pid){
  let domains = {};

  for(const u of urls){
    if(!domains[u]){
      domains[u] = {
        filter: {origin: u},
        update: {
          '$inc': {'crawl.queued': 0},
          $addToSet: {
            processIds: pid
          }
        },
        upsert: true
      };
    }
    domains[u]['update']['$inc']['crawl.queued']++;
  };
  return this.bulkWrite(Object.values(domains).map(d => ({updateOne: d})));
};

domainSchema.statics.domainsToCheck = async function*(wId, limit){
  const query = {
    robots: {status: 'unvisited'},
    'crawl.pathHeads': {'$gt': 0},
  };
  const update = {
    '$set': {
      'robots.status': 'checking',
      workerId: wId
    }
  };
  const options = {
    new:true,
    sort:  {'crawl.pathHeads': -1},
    fields: 'origin'
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
    'crawl.pathHeads': {'$gt': 0},
    'crawl.nextAllowed': {'$lte': Date.now()}
  };
  const update = {'$set': {status: 'crawling', workerId: wId}};
  const options = {
    new:true,
    sort: {'crawl.pathHeads': -1},
    fields: 'origin crawl robots.text'
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
