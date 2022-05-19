const mongoose = require('mongoose');
const {urlType} = require('../../common/lib/mongoose-types');
const ObjectId = mongoose.Types.ObjectId;
const config = require('../config');

const pathSchema = new mongoose.Schema({
  seed: {
    url: {...urlType, required: true}
  },
  predicates: {
    elems: [urlType],
    count: Number
  },
  lastPredicate: urlType,
  nodes: {
    elems: [urlType],
    count: Number
  },
  head: {
    url: {...urlType, required: true},
    domain: urlType,
    alreadyCrawled: {
      type: Boolean,
      default: false
    }
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
    'seed.url': 1,
    'head.url': 1,
    'predicates.count': 1
  });

pathSchema.index({
    'head.url': 1
  });

pathSchema.index({
    'head.url': 1,
    'nodes.count': 1
  });


pathSchema.pre('save', async function(){
  const Resource = require('./Resource');
  this.nodes.count = this.nodes.elems.length;
  this.predicates.count = this.predicates.elems.length;
  if(this.predicates.count){
    this.lastPredicate = this.predicates.elems[this.predicates.count-1];
  }
  this.head.domain = new URL(this.head.url).origin;
  const head = await Resource.findOne({url: this.head.url});
  this.head.alreadyCrawled = head?.status !== 'unvisited';
  if(head?.status === 'error'){
    this.status = 'disabled';
    await Resource.rmPath(this);
    return;
  }
  if(this.nodes.count >= config.graph.maxPathLength){
    this.status = 'finished';
    await Resource.rmPath(this);
    return;
  }
  this.status = 'active';
});

pathSchema.methods.markDisabled = async function(){
  this.status = 'disabled';
  await this.save();
  const Resource = require('./Resource');
  await Resource.rmPath(this);
  return;
};

pathSchema.methods.markFinished = async function(){
  this.status = 'finished';
  await this.save();
  const Resource = require('./Resource');
  await Resource.rmPath(this);
  return;
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
