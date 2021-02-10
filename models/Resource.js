const mongoose = require('mongoose');

const resourceSchema = new mongoose.Schema({
  url: {
    type: String,
    index: true,
    unique: true
  },
  crawled: {
    type: Boolean,
    index: true,
    default: true
  },
  projects: [{
    type: mongoose.Types.ObjectId,
    ref: 'Project',
    default: [],
    index: true
  }],
  totalTriples: {
    type: Number,
    default: 0
  }
}, {timestamps: true});


module.exports = mongoose.model('Resource', resourceSchema);
