const mongoose = require('mongoose');
require('mongoose-type-url');
const ObjectId = mongoose.Types.ObjectId;
const config = require('../config');

const pathSchema = new mongoose.Schema({
  seed: {
    url: {
      type: mongoose.SchemaTypes.Url,
      required: true
    }
  },
  predicates: {
    elems: [{
      type: mongoose.SchemaTypes.Url,
    }],
    count: Number
  },
  lastPredicate: mongoose.SchemaTypes.Url,
  nodes: {
    elems: [{
      type: mongoose.SchemaTypes.Url
    }],
    count: Number
  },
  head: {
    url: {
      type: mongoose.SchemaTypes.Url,
      required: true
    },
    domain: mongoose.SchemaTypes.Url,
    alreadyCrawled: Boolean
  },
  parentPath: {
    type: ObjectId,
    ref: 'Path'
  },
  status: {
    type: String,
    enum: ['active', 'disabled', 'finished'],
    default: 'active'
  },
}, {timestamps: true});

pathSchema.index({
    parentPath:1,
    'head.url': 1,
    lastPredicate: 1
  }, {unique: true});


pathSchema.pre('save', async function(){
  this.nodes.count = this.nodes.elems.length;
  this.predicates.count = this.predicates.elems.length;
  if(this.predicates.count){
    this.lastPredicate = this.predicates.elems[this.predicates.count-1];
  }
  this.head.domain = new URL(this.head.url).origin;
  const head = await require('./Resource').findOne({url: this.head.url});
  this.head.alreadyCrawled = head && head.status !== 'unvisited';
  this.status = head.status === 'error' ? 'disabled' :
               this.nodes.count < config.graph.maxPathLength ? 'active' :
               'finished'
});


pathSchema.statics.markHeadAsCrawled = async function(headUrl){
};

module.exports = mongoose.model('Path', pathSchema);
