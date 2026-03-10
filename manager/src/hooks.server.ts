import { building } from '$app/environment';
import { db, Process, Triple } from '@derzis/models';
import ManagerPubSub from './lib/ManagerPubSub';
import type { Handle } from '@sveltejs/kit';
import { createLogger } from '@derzis/common/server';
import { createWriteStream, existsSync, mkdirSync } from 'fs';

const mps = new ManagerPubSub();
import { DERZIS_MNG_DB_NAME, MONGO_HOST, MONGO_PORT } from '$env/static/private';
import muri from 'mongodb-uri';
import config from '@derzis/config';

const dbName = DERZIS_MNG_DB_NAME || 'derzis-mng-default';
const dbPort = MONGO_PORT ? parseInt(MONGO_PORT) : 27017;
const connStr = muri.format({
  scheme: 'mongodb',
  hosts: [
    {
      host: MONGO_HOST || 'localhost',
      port: dbPort
    }
  ],
  database: dbName
});

const log = createLogger('Manager');
log.info('Connecting to MongoDB', connStr);
await db.connect(connStr);

const logDir = './logs';
if (!existsSync(logDir)) {
  mkdirSync(logDir, { recursive: true });
}
const debugLog = createWriteStream(`${logDir}/triple-queries-debug.log`, { flags: 'a' });

function logDebug(msg: string) {
  const timestamp = new Date().toISOString();
  debugLog.write(`[${timestamp}] ${msg}\n`);
}

Triple.schema.pre('find', function (this: any) {
  const filter = this.getFilter();
  if (filter._id?.$in?.length === 1) {
    const id = filter._id.$in[0];
    const stack = new Error().stack || '';
    const callerLine = stack.split('\n')[3]?.trim() || 'unknown';
    console.log(`[HOOK] SINGLE_ID_QUERY: _id=${id} Caller: ${callerLine}`);
    logDebug(`SINGLE_ID_QUERY: _id=${id}\n  Caller: ${callerLine}\n  Full stack:\n${stack}`);
  }
});


const initManager = async () => {
  console.log('Manager init');
  mps.start();
};

if (!building) {
  await initManager();
}

export const handle: Handle = async ({ event, resolve }) => {
  console.log(`[${event.request.method}] ${event.url}`);
  const response = await resolve(event);
  return response;
};
