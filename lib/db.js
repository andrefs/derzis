const mongoose = require('mongoose');
mongoose.set('debug', true);


mongoose.connect('mongodb://localhost/derzis-crawler', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));

module.exports = db;
