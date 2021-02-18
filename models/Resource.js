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
  console.log(docs);
  const hosts = [...new Set(docs.map(d => d.domain))];
  return Domain.insertMany(hosts.map(h => ({host: h})));
});

module.exports = mongoose.model('Resource', resourceSchema);
