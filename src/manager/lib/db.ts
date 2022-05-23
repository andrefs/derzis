import config from '@derzis/config';
import mongoose from 'mongoose';
if(config.db.debug){
  mongoose.set('debug', true);
}

let auth = '';
if(config.db.user){ auth += config.db.user+':'; }
if(config.db.pass){ auth += config.db.pass+'@' }

export const uri = `mongodb://${auth}${config.db.host}:${config.db.port}/${config.db.name}`

export const connect = () => {
  const conn = mongoose.connect(uri || 'mongodb://localhost/derzis-crawler');
  return conn;
};
