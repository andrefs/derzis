import { createLogger } from './logger';
const log = createLogger('WebHook-API');

export async function webhookPost(uri: string, body: object) {
  log.info('Making POST request to', uri);
  const response = await fetch(uri, {
    method: 'POST',
    body: JSON.stringify({ ok: true, data: body }),
    headers: {
      'Content-Type': 'application/json'
    }
  });
  return await response.json();
}
