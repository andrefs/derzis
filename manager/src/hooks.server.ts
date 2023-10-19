import { building } from '$app/environment';
import { db } from '@derzis/models';
import ManagerPubSub from './lib/ManagerPubSub';
import type { Handle } from '@sveltejs/kit';
const mps = new ManagerPubSub();

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
