import { error, json } from '@sveltejs/kit';
import { createLogger } from 'vite';
const log = createLogger();
import * as processHelper from '$lib/process-helper';
import type { RequestEvent } from './$types';

export const GET = async ({ params, request }: RequestEvent) => {
  log.info(`GET ${request.url}`);
  const p = await processHelper.info(params.pid);

  if (!p) {
    throw error(404, {
      message: 'Not found'
    });
  }

  return json({ ok: true, data: p });
};
