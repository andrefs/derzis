const db = require('../lib/db');
const mongoose = require('mongoose');

process.stdout.write('Clearing db '+db.uri+' ... ');
db.connect()
  .then(() => mongoose.connection.dropDatabase())
  .then(() => mongoose.disconnect())
  .then(() => console.log('done.'));
