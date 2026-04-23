import { error, json } from '@sveltejs/kit';
import { createLogger } from '@derzis/common/server';
import { calcProcGlobalMetrics, notifyGlobalMetricsCalculated, Process } from '@derzis/models';
import type { RequestEvent } from './$types';

const log = createLogger('api:processes:[pid]:calc-metrics:global');

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

  log.info(
    `Received request to calculate global metrics for process ${pid} with body: ${JSON.stringify(body)}`
  );
  const process = await Process.findOne({ pid });

  if (!process) {
    throw error(404, { message: 'Process not found' });
  }

  // Determine the step index: this should be the current step's index in the steps array
  // Since steps array includes all steps including current, the index is steps.length - 1
  const stepIndex = process.steps.length - 1;

  log.info(`Calculating global metrics for process ${pid}, step ${stepIndex}`);

  // Fire-and-forget: calculate metrics in background and notify when done
  setImmediate(async () => {
    try {
      const metrics = await calcProcGlobalMetrics(pid);
      await notifyGlobalMetricsCalculated(pid, metrics, stepIndex);
      log.info(`Global metrics calculation completed for process ${pid}, step ${stepIndex}`);
    } catch (err) {
      log.error(`Error calculating global metrics for process ${pid}: ${(err as Error).message}`);
    }
  });

  return json({ ok: true });
};
