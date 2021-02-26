const config = require('../config');
const mongoose = require('mongoose');
if(config.db.debug){
  mongoose.set('debug', true);
}
mongoose.set('useFindAndModify', false);
mongoose.set('useCreateIndex', true);


mongoose.connect('mongodb://localhost/derzis-crawler', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));

module.exports = db;
