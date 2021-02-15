const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const domainSchema = new mongoose.Schema({
  host: {
    type: String,
    index: true,
    unique: true
  },
  robots: String,
  crawlDelay: Number,
  lastAccessed: Schema.Types.Date,
  nextCrawlAllowerd: Schema.Types.Date
}, {timestamps: true});

module.exports = mongoose.model('Domain', domainSchema);
