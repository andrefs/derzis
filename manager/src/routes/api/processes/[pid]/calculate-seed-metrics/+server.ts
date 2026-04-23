import { error, json } from '@sveltejs/kit';
import { createLogger } from '@derzis/common/server';
import { calcProcSeedMetrics, notifySeedMetricsCalculated, Process } from '@derzis/models';
import type { RequestEvent } from './$types';

const log = createLogger('api:processes:[pid]:calculate-seed-metrics');

export const POST = async ({ params, request }: RequestEvent) => {
  const pid = params.pid;

  if (!pid) {
    throw error(400, { message: 'Process ID is required' });
  }

  let body;
  try {
    body = (await request.json()) as { ok: boolean; data: { seeds?: string[] } };
  } catch (err) {
    throw error(400, { message: 'Invalid JSON body' });
  }

  log.info(
    `Received request to calculate seed metrics for process ${pid} with body: ${JSON.stringify(body)}`
  );
  const seeds: string[] = body.data.seeds || [];

  if (!seeds.length) {
    log.warn(`No seeds provided for process ${pid} when calculating seed metrics`);
    throw error(400, { message: 'Seeds array is required and cannot be empty' });
  }

  const process = await Process.findOne({ pid });

  if (!process) {
    throw error(404, { message: 'Process not found' });
  }

  // Determine the step index: this should be the current step's index in the steps array
  // Since steps array includes all steps including current, the index is steps.length - 1
  const stepIndex = process.steps.length - 1;

  log.info(
    `Calculating seed metrics for process ${pid}, step ${stepIndex}, seeds: ${JSON.stringify(seeds)}`
  );

  // Fire-and-forget: calculate metrics in background and notify when done
  setImmediate(async () => {
    try {
      const metrics = await calcProcSeedMetrics(pid, seeds);
      await notifySeedMetricsCalculated(pid, metrics, stepIndex);
      log.info(`Seed metrics calculation completed for process ${pid}, step ${stepIndex}`);
    } catch (err) {
      log.error(`Error calculating seed metrics for process ${pid}: ${(err as Error).message}`);
    }
  });

  return json({ ok: true });
};
