const config = require('../config');
const mongoose = require('mongoose');
if(config.db.debug){
  mongoose.set('debug', true);
}
mongoose.set('useFindAndModify', false);
mongoose.set('useCreateIndex', true);

const connect = async () => {
  let auth = '';
  if(config.db.user){ auth += user+':'; }
  if(config.db.pass){ auth += pass+'@' }
  const uri = `mongodb://${auth}${config.db.host}:${config.db.port}/${config.db.name}`

  const conn = await mongoose.connect(uri || 'mongodb://localhost/derzis-crawler', {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
  return conn;
};


module.exports = {
  connect
}
