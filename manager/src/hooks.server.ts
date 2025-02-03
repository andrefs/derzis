import { building } from '$app/environment';
import { db } from '@derzis/models';
import ManagerPubSub from './lib/ManagerPubSub';
import type { Handle } from '@sveltejs/kit';
import { createLogger } from '@derzis/common';
const mps = new ManagerPubSub();
import { DERZIS_MNG_DB_NAME, MONGO_HOST, MONGO_PORT } from '$env/static/private';
import muri from 'mongodb-uri';

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

const initManager = async () => {
	console.log('Manager init');
	mps.start();
};

if (!building) {
	await initManager();
}

export const handle: Handle = async ({ event, resolve }) => {
	//console.log(`[${event.request.method}] ${event.url}`);
	const response = await resolve(event);
	return response;
};
