import { error, json } from '@sveltejs/kit';
import { createLogger } from '@derzis/common/server';
import { Process } from '@derzis/models';
import { calcProcMetrics } from '@derzis/models';
import type { RequestEvent } from './$types';

const log = createLogger('api:processes:[pid]:metrics');

export const GET = async ({ params, url }: RequestEvent) => {
  const pid = params.pid;

  if (!pid) {
    throw error(400, { message: 'Process ID is required' });
  }

  const seedsParam = url.searchParams.get('seeds');
  const seeds = seedsParam ? seedsParam.split(',') : [];

  log.info(`Calculating metrics for process ${pid}, seeds count: ${seeds.length}`);

  const process = await Process.findOne({ pid });

  if (!process) {
    throw error(404, { message: 'Process not found' });
  }

  try {
    const metrics = await calcProcMetrics(pid, seeds);

    return json({ ok: true, data: metrics });
  } catch (err) {
    log.error(`Error calculating metrics for process ${pid}: ${(err as Error).message}`);
    throw error(500, { message: 'Failed to calculate metrics' });
  }
};
