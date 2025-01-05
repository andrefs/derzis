import config from '@derzis/config';
import mongoose, { Types } from 'mongoose';
if (config.worker.db.debug) {
  console.log('Enabling mongo debug');
  mongoose.set('debug', true);
}

export const connect = (connStr: string) => {
  const conn = mongoose.connect(connStr, {
    //enableUtf8Validation: false
  });
  return conn;
};
