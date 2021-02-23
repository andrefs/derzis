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


domainSchema.statics.domainsToCheck = async function(limit, wId){
  // Find $limit 'unvisited' domains
  const docs = await this.find({robots: {status: 'unvisited'}})
                          .limit(limit)
                          .select('_id');
  const ids = docs.map(x => x._id);

  // Mark found domains as 'checking'
  const query = {_id: {'$in': ids}, robots: {status: 'unvisited'}};
  const update = {'$set': {robots: {status: 'checking'}, workerId: wId}};
  const res = await this.updateMany(query, update);

  // Return marked domains
  return this.find({_id: {'$in': ids}, robots: {status: 'checking'}, workerId: wId})
             .select('host')
             .lean();
};


// domainSchema.status.domainsToCrawl


module.exports = mongoose.model('Domain', domainSchema);
