import { error, json } from '@sveltejs/kit';
import { createLogger } from '@derzis/common/server';
import { Process } from '@derzis/models';
import { calcPredMetrics } from '@derzis/models';
import { notifyPredMetricsCalculated } from '@derzis/models';
import type { RequestEvent } from './$types';

const log = createLogger('api:processes:[pid]:calc-metrics:other-preds');

export const POST = async ({ params, request }: RequestEvent) => {
  console.log('XXXXXXXXXXx 2.1', params);
  const pid = params.pid;

  if (!pid) {
    throw error(400, { message: 'Process ID is required' });
  }

  let body;
  try {
    body = (await request.json()) as { ok: boolean; data: { predicates?: string[] } };
  } catch (err) {
    throw error(400, { message: 'Invalid JSON body' });
  }
  console.log('XXXXXXXXXXx 2.2', body);

  const predicates: string[] = body.data.predicates || [];

  const process = await Process.findOne({ pid });

  if (!process) {
    throw error(404, { message: 'Process not found' });
  }

  const stepIndex = process.steps.length - 1;

  log.info(
    `Calculating branch factors for other predicates of process ${pid}, step ${stepIndex}, predicates: ${JSON.stringify(predicates)}`
  );

  setImmediate(async () => {
    try {
      const metrics = await calcPredMetrics(pid, predicates);
      await notifyPredMetricsCalculated(
        pid,
        metrics,
        stepIndex,
        'OK_OTHER_PRED_METRICS_CALCULATED'
      );
      log.info(`Other branch factors calculation completed for process ${pid}, step ${stepIndex}`);
    } catch (err) {
      log.error(
        `Error calculating other branch factors for process ${pid}: ${(err as Error).message}`
      );
    }
  });

  return json({ ok: true });
};
