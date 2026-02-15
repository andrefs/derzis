import { building } from '$app/environment';
import { db, Process } from '@derzis/models';
import ManagerPubSub from './lib/ManagerPubSub';
import type { Handle } from '@sveltejs/kit';
import { createLogger } from '@derzis/common/server';
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

async function dbSanityCheck() {
	// check pathType
	const pathType = config.manager.pathType;
	const procPTs = await Process.find({}, { pid: 1, pathType: 1 }).lean();

	if (!procPTs || procPTs.length === 0) {
		log.info(`No processes found in DB, path type set to ${pathType}`);
		return;
	}

	if (procPTs.some(p => p.pathType !== pathType)) {
		log.error(`DB sanity check failed: found processes with different path types than the one currently set in config (${pathType})`);
		log.error(`Processes found: ${procPTs.map(p => `pid ${p.pid} with path type ${p.pathType}`).join(', ')}`);
		throw new Error('DB sanity check failed: inconsistent path types');
	}
}


const initManager = async () => {
	console.log('Manager init');
	await dbSanityCheck();
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
