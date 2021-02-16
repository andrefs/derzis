const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const domainSchema = new mongoose.Schema({
  host: {
    type: String,
    index: true,
    unique: true
  },
  status: {
    type: String,
    enum: ['unvisited', 'checking', 'error', 'ready', 'crawling'],
    default: 'unvisited'
  },
  robots: String,
  crawlDelay: Number,
  crawledResources: {
    type: Number,
    default: 0
  },
  queuedResources: {
    type: Number,
    default: 0
  },
  lastAccessed: Schema.Types.Date,
  nextCrawlAllowed: Schema.Types.Date
}, {timestamps: true});

module.exports = mongoose.model('Domain', domainSchema);
