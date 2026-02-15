import { error, json } from '@sveltejs/kit';
import { Process } from '@derzis/models';
import type { RequestEvent } from './$types';

export async function GET({ params }: RequestEvent) {
  const p = await Process.findOne({ pid: params.pid });
  if (!p) {
    throw error(404, {
      message: 'Not found'
    });
  }
  const stats = await p.getInfo();
  return json(stats);
}
