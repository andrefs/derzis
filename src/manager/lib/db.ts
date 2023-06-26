import config from '@derzis/config';
import mongoose from 'mongoose';
if(config.manager.db.debug){
  mongoose.set('debug', true);
}

let auth = '';
if(config.manager.db.user){ auth += config.manager.db.user+':'; }
if(config.manager.db.pass){ auth += config.manager.db.pass+'@' }

export const uri = `mongodb://${auth}${config.manager.db.host}:${config.manager.db.port}/${config.manager.db.name}`

export const connect = () => {
  const conn = mongoose.connect(uri || 'mongodb://localhost/drzs-mng');
  return conn;
};
