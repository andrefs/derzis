const mongoose = require('mongoose');
const {urlType} = require('../../common/lib/mongoose-types');
const ObjectId = mongoose.Types.ObjectId;

const tripleSchema = new mongoose.Schema({
  subject:   {...urlType, required: true},
  predicate: {...urlType, required: true},
  object:    {...urlType, required: true}, // TODO allow literals
  nodes:   [urlType],
  sources: [urlType]
}, {timestamps: true});

tripleSchema.index({nodes:1});
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
