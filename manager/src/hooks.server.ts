import { building } from '$app/environment';
import { db } from '@derzis/models';
import ManagerPubSub from './lib/ManagerPubSub';
import type { Handle } from '@sveltejs/kit';
import { createLogger } from '@derzis/common';
const mps = new ManagerPubSub();

const log = createLogger('Manager');
log.info('Connecting to MongoDB');
await db.connect();

const initManager = async () => {
	console.log('Manager init');
	mps.start();
};

if (!building) {
	await initManager();
}

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	return response;
};
