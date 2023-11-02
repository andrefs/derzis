import config from '@derzis/config';
import mongoose, { Types } from 'mongoose';
if (config.worker.db.debug) {
  console.log('Enabling mongo debug');
  mongoose.set('debug', true);
}


export const connect = (DATABASE_URI: string) => {
  const conn = mongoose.connect(`mongodb://localhost/${DATABASE_URI || 'derzis-default'}`);
  return conn;
};

