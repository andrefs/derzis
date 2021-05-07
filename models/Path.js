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
  const Resource = await require('./Resource');
  this.nodes.count = this.nodes.elems.length;
  this.predicates.count = this.predicates.elems.length;
  if(this.predicates.count){
    this.lastPredicate = this.predicates.elems[this.predicates.count-1];
  }
  this.head.domain = new URL(this.head.url).origin;
  const head = Resource.findOne({url: this.head.url});
  this.head.alreadyCrawled = head && head.status !== 'unvisited';
  //console.log('XXXXXXXXXXXXXXXXXXXXXXX', {'this': this});
  if(head.status === 'error'){
    this.status = 'disabled';
    await require('./Resource').rmPath(this);
    return;
  }
  if(this.nodes.count >= config.graph.maxPathLength){
    this.status = 'finished';
    await require('./Resource').rmPath(this);
    return;
  }
  this.status = 'active';
});

pathSchema.methods.markDisabled = async function(){
  this.status = 'disabled';
  await this.save();
  return require('./Resource').rmPath(this);
};

pathSchema.methods.markFinished = async function(){
  this.status = 'finished';
  await this.save();
  return require('./Resource').rmPath(this);
};

//pathSchema.post('save', async function(doc){
//  const resUpdate = doc.status === 'active' ?
//    {'$addToSet': {paths: doc._id}} :
//    {'$pull': {paths: doc._id}};
//
//  const domUpdate = doc.status === 'active' ?
//    {'$inc': {'crawl.pathHeads':  1}} :
//    {'$inc': {'crawl.pathHeads': -1}};
//
//  const Resource = require('./Resource');
//  await Resource.updateOne({url: doc.head.url}, resUpdate);
//  const r = await Resource.findOne({url: doc.head.url});
//  r.headCount = r.paths?.length || 0;
//  await r.save();
//
//  await require('./Domain').updateOne({origin: new URL(doc.head.url).origin}, domUpdate);
//});


module.exports = mongoose.model('Path', pathSchema);
