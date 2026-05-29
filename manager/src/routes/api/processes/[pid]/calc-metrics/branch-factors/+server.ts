import { error, json } from '@sveltejs/kit';
import { createLogger } from '@derzis/common/server';
import { Process } from '@derzis/models';
import { getBranchingFactor } from '@derzis/models';
import type { RequestEvent } from './$types';
const log = createLogger('api:processes:[pid]:calc-metrics:branch-factors');

export const POST = async ({ params, request }: RequestEvent) => {
  const pid = params.pid;

  if (!pid) {
    throw error(400, { message: 'Process ID is required' });
  }

  let body;
  try {
    body = (await request.json()) as { ok: boolean; data: { hierPreds?: string[] } };
  } catch (err) {
    throw error(400, { message: 'Invalid JSON body' });
  }

  const hierPreds = body.data.hierPreds || [];

  const process = await Process.findOne({ pid });

  if (!process) {
    throw error(404, { message: 'Process not found' });
  }

  // Determine the step index: this should be the current step's index in the steps array
  // Since steps array includes all steps including current, the index is steps.length - 1
  const stepIndex = process.steps.length - 1;

  log.info(
    `Calculating branch factors for process ${pid}, step ${stepIndex}, hierPreds: ${JSON.stringify(hierPreds)}`
  );

  const results = await Promise.all(
    hierPreds.map(async (predicate) => {
      const bf = await getBranchingFactor(pid, predicate);
      const ratio = bf.obj === 0 ? null : bf.subj / bf.obj;
      return { hierPred: predicate, ...bf, ratio };
    })
  );

  log.info(`Branch factors calculation completed for process ${pid}, step ${stepIndex}`);

  return json({ ok: true, data: { results } });
};
