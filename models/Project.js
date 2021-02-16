const mongoose = require('mongoose');
const Schema= mongoose.Schema;
const Resource = require('./Resource');

const projectSchema = new mongoose.Schema({
  name: {
    type: String,
    index: true,
    unique: true
  },
  description: String,
  //crawl: {
  //  startedAt: Schema.Types.Date,
  //  finishedAt: Schema.Types.Date,
  //  resourceCount: {
  //    type: Number,
  //    default: 0
  //  },
  //  tripleCount: {
  //    type: Number,
  //    default: 0
  //  }
  //},
  seedUrls: Array
}, {timestamps: true});

projectSchema.post('save', function(doc, next){
  Resource
    .insertMany(this.seedUrls.map(u => ({url: u, crawled: false})))
    .then(() => Resource.update(
      {url: {'$in': this.seedUrls}},
      {'$addToSet': {projects: this}},
      {multi: true}))
    .then(() => next())
});

module.exports = mongoose.model('Project', projectSchema);
