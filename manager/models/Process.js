const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const processSchema = new mongoose.Schema({
  pid: {
    type: String,
    index: true,
    unique: true
  },
  notification: {
    email: String,
    webhook: String,
    ssePath: String
  },
  description: String,
  seeds: [{
    type: String
  }],
  params: {
    maxPathLength: Number,
    maxPathProps: Number
  },
  status: {
    type: String,
    enum: ['queued', 'running', 'done', 'error'],
    default: 'queued'
  },
}, {timestamps: true});


processSchema.pre('save', async function() {
  const today =   this.pid = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
  const count = await this.constructor.countDocuments({createdAt: {$gt: today}});
  this.pid = today.split('T')[0] + '-' +count;
  this.notification.ssePath = `/processes/${this.pid}/events`;
});

module.exports = mongoose.model('Process', processSchema);
