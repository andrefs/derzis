import { createLogger } from './logger.js';
const log = createLogger('WebHook-API');

export async function webhookPost(uri: string, body: object) {
  log.info('Making POST request to', uri);
  const response = await fetch(uri, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json'
    }
  });
  return await response.json();
}
