const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;


const resourceSchema = new mongoose.Schema({
  url: {
    type: String,
    index: true,
    unique: true
  },
  projects: [{
    type: mongoose.Types.ObjectId,
    ref: 'Project',
    default: [],
    index: true
  }],
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


resourceSchema.statics.getNext = async function(projectName){
  let query = {status: 'unvisited'};
  if(projectName){
    const proj = await require('./Project').findOne({name: projectName});
    if(!proj){
      throw 'no such project';
    }
    query.projects = {_id: proj._id};
  }
  return this.findOneAndUpdate(query, {'$set': {status: 'crawling'}}, {new: true});
};

module.exports = mongoose.model('Resource', resourceSchema);
