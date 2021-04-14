const mongoose = require('mongoose');
require('mongoose-type-url');
const ObjectId = mongoose.Types.ObjectId;

const tripleSchema = new mongoose.Schema({
  subject: {
    type: mongoose.SchemaTypes.Url,
    required: true
  },
  predicate: {
    type: mongoose.SchemaTypes.Url,
    required: true
  },
  // TODO allow literals
  object: {
    type: mongoose.SchemaTypes.Url,
    required: true
  },
  nodes: [{
    type: mongoose.SchemaTypes.Url
  }],
  sources: [{
    type: mongoose.SchemaTypes.Url,
  }]
}, {timestamps: true});

tripleSchema.index({subject:1, predicate:1, object:1}, {unique: true});

tripleSchema.statics.upsertMany = async function(source, triples){
  const ops = triples.map(t => ({
    updateOne: {
      filter: t,
      update: {
        '$setOnInsert': {
          nodes: [t.subject, t.object],
        },
        '$addToSet': {sources: source}
      },
      upsert: true
    }
  }));
  return this.bulkWrite(ops, {ordered: false});
};


module.exports = mongoose.model('Triple', tripleSchema);
