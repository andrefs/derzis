const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;
const Domain = require('./Domain');


const resourceSchema = new mongoose.Schema({
  url: {
    type: String,
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

resourceSchema.post('insertMany', function(docs){
  const domains = {};
  for(const d of docs){
    if(!domains[d.domain]){
      domains[d.domain] = {
        filter: {host: d.domain},
        update: {
          '$inc': {'crawl.queued': 0},
          '$setOnInsert': {
            'robots.status': 'unvisited',
            status: 'unvisited'
          }
        },
        upsert: true
      };
    }
    domains[d.domain]['update']['$inc']['crawl.queued']++;
  };
  return Domain.bulkWrite(Object.values(domains).map(d => ({updateOne: d})));
});

module.exports = mongoose.model('Resource', resourceSchema);
