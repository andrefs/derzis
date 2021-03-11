const mongoose = require('mongoose');
require('mongoose-type-url');
const Resource = require('./Resource');


const projectSchema = new mongoose.Schema({
  name: {
    type: String,
    index: true,
    unique: true
  },
  description: String,
  seedUrls: [{type: mongoose.SchemaTypes.Url}]
}, {timestamps: true});

projectSchema.post('save', function(doc, next){
  Resource
    .upsertMany(this.seedUrls.map(u => ({
      url: u,
      depth: 0,
      domain: new URL(u).origin,
      crawled: false
    })))
    .then(() => next())
});

module.exports = mongoose.model('Project', projectSchema);
