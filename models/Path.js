const mongoose = require('mongoose');
require('mongoose-type-url');
const ObjectId = mongoose.Types.ObjectId;

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


pathSchema.pre('save', async function(){
  this.nodes.count = this.nodes.elems.length;
  this.predicates.count = this.predicates.elems.length;
  this.head.domain = new URL(this.head.url).origin;
  const head = await require('./Resource').findOne({url: this.head.url});
  this.head.alreadyCrawled = head && head.status === 'done';
});


pathSchema.statics.markHeadAsCrawled = async function(headUrl){
  return this.updateMany({'head.url': headUrl}, {'head.alreadyCrawled': true});
};

module.exports = mongoose.model('Path', pathSchema);
