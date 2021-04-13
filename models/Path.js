const mongoose = require('mongoose');
require('mongoose-type-url');
const ObjectId = mongoose.Types.ObjectId;

const pathSchema = new mongoose.Schema({
  seed: {
    type: mongoose.SchemaTypes.Url,
    required: true
  },
  predicates: [{
    type: mongoose.SchemaTypes.Url,
  }],
  length: {
    type: Number,
    required: true,
    default: 1
  },
  head: {
    type: mongoose.SchemaTypes.Url,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'disabled', 'finished'],
    default: 'active'
  },
}, {timestamps: true});

module.exports = mongoose.model('Path', pathSchema);