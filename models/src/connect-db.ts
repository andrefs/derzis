import config from '@derzis/config';
import mongoose from 'mongoose';
import { createLogger } from '@derzis/common/server';

const log = createLogger('connect-db');

if (config.worker.db.debug) {
  log.debug('Enabling mongo debug');
  mongoose.set('debug', true);
}

export const connect = (connStr: string) => {
  const conn = mongoose.connect(connStr, {
    //enableUtf8Validation: false
  });
  return conn;
};
