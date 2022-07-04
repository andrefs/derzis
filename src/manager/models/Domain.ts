import {FilterQuery} from 'mongoose';
import { Schema, model, Model, Document } from "mongoose";

const errorTypes = ['E_ROBOTS_TIMEOUT', 'E_RESOURCE_TIMEOUT', 'E_DOMAIN_NOT_FOUND', 'E_UNKNOWN'];

export interface IDomain {
  origin: string,
  status: 'unvisited' | 'checking' | 'error' | 'ready' | 'crawling',
  error: Boolean,
  lastWarnings: [{
    errType: {
      type: String,
      enum: String
    }
  }],
  warnings: {
    E_ROBOTS_TIMEOUT: number,
    E_RESOURCE_TIMEOUT: number
  },
  robots: {
    status: 'unvisited' | 'checking' | 'not_found' | 'error' | 'done'
    text: string,
    checked: Date,
    elapsedTime: number
  },
  workerId: string,
  crawl: {
    delay: number,
    queued: number,
    success: number,
    ongoing: number,
    pathHeads: number,
    failed: number,
    nextAllowed: Date
  },
  lastAccessed: Date,
  processIds: string[]
};

interface IDomainDocument extends IDomain, Document {};

interface IDomainModel extends Model<IDomainDocument> {
  upsertMany: (urls: string[], pids: string[]) => Promise<void>,
  domainsToCheck: (wId: string, limit: number) => Iterable<IDomain>,
  domainsToCrawl: (wId: string, limit: number) => Iterable<IDomain>
};

const DomainSchema: Schema<IDomainDocument> = new Schema({
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
  error: Boolean,
  lastWarnings: [{
    errType: {
      type: String,
      enum: errorTypes,
    }
  }],
  warnings: {
    E_ROBOTS_TIMEOUT: {
      type: Number,
      default: 0,
    },
    E_RESOURCE_TIMEOUT: {
      type: Number,
      default: 0,
    },
    E_DOMAIN_NOT_FOUND: {
      type: Number,
      default: 0,
    },
    E_UNKNOWN: {
      type: Number,
      default: 0,
    },
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
    ongoing: {
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

DomainSchema.index({
  status: 1,
  'crawl.pathHeads': 1,
  'crawl.nextAllowed': -1
});

DomainSchema.index({
  'crawl.nextAllowed': -1
});

DomainSchema.index({
  'robots.status': 1
});

DomainSchema.statics.upsertMany = async function(urls: string, pids: string[]){
  let domains: {[url: string]: FilterQuery<IDomain>} = {};

  for(const u of urls){
    if(!domains[u]){
      domains[u] = {
        filter: {origin: u},
        update: {
          '$inc': {'crawl.queued': 0},
          $addToSet: {
            processIds: pids
          }
        },
        upsert: true
      };
    }
    domains[u]['update']['$inc']['crawl.queued']++;
  };
  return this.bulkWrite(Object.values(domains).map(d => ({updateOne: d})));
};

DomainSchema.statics.domainsToCheck = async function*(wId, limit){
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

DomainSchema.statics.domainsToCrawl = async function*(wId, limit){
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

export const Domain = model<IDomainDocument, IDomainModel>('Domain', DomainSchema);

