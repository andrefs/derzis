import { createLogger } from '@derzis/common';
const log = createLogger('Cardea-API');
const { CARDEA_HOST, CARDEA_PORT, CARDEA_API_PATH } = process.env;

async function derzisPost(path: string, body: object) {
  const uri = `http://${CARDEA_HOST}${CARDEA_PORT ? ':' + CARDEA_PORT : ''}${CARDEA_API_PATH}${path}`;
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
