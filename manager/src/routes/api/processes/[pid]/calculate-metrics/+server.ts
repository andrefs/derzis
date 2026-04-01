import { error, json } from '@sveltejs/kit';
import { createLogger } from '@derzis/common/server';
import { Process } from '@derzis/models';
import { calcProcMetrics } from '@derzis/models';
import { notifyMetricsCalculated } from '@derzis/models';
import type { RequestEvent } from './$types';

const log = createLogger('api:processes:[pid]:calculate-metrics');

export const POST = async ({ params, request }: RequestEvent) => {
  const pid = params.pid;

  if (!pid) {
    throw error(400, { message: 'Process ID is required' });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    throw error(400, { message: 'Invalid JSON body' });
  }

  const bodyAny = body as Record<string, unknown>;
  const seeds: string[] = (bodyAny.seeds as string[] | undefined) ?? [];
  const noSeedCovCalc: boolean = bodyAny.noSeedCovCalc === true;

  const process = await Process.findOne({ pid });

  if (!process) {
    throw error(404, { message: 'Process not found' });
  }

  // Determine the step index: this should be the current step's index in the steps array
  // Since steps array includes all steps including current, the index is steps.length - 1
  const stepIndex = process.steps.length - 1;

  log.info(
    `Calculating metrics for process ${pid}, step ${stepIndex}, seeds: ${JSON.stringify(seeds)}, noSeedCovCalc: ${noSeedCovCalc}`
  );

  // Fire-and-forget: calculate metrics in background and notify when done
  setImmediate(async () => {
    try {
      const metrics = await calcProcMetrics(pid, seeds, noSeedCovCalc);
      await notifyMetricsCalculated(pid, metrics, stepIndex);
      log.info(`Metrics calculation completed for process ${pid}, step ${stepIndex}`);
    } catch (err) {
      log.error(`Error calculating metrics for process ${pid}: ${(err as Error).message}`);
    }
  });

  return json({ ok: true });
};
