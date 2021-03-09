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
  source: {
    type: mongoose.SchemaTypes.Url,
    required: true
  }
}, {timestamps: true});

tripleSchema.index({subject:1, predicate:1, object:1}, {unique: true});

module.exports = mongoose.model('Triple', tripleSchema);
