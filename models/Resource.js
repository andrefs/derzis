const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;


const resourceSchema = new mongoose.Schema({
  url: {
    type: String,
    index: true,
    unique: true
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


module.exports = mongoose.model('Resource', resourceSchema);
