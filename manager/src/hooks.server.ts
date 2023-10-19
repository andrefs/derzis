import { building } from '$app/environment';
import ManagerPubSub from './lib/ManagerPubSub';
const mps = new ManagerPubSub();

const initManager = async () => {
  console.log('Manager init');
  mps.start();
};

if (!building) {
  await initManager();
}

export const handle = async ({ event, resolve }) => {
  console.log('hook handler');
  const response = await resolve(event);
  return response;
};
