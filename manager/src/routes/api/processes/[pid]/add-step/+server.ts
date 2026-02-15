import { addStep } from '$lib/process-helper';
import { PredDirMetrics, Process, StepClass } from '@derzis/models';
import { json, type RequestHandler } from '@sveltejs/kit';
import { createLogger } from '@derzis/common/server';
import type { MakeOptional } from '$lib/utils';
const log = createLogger('API');

interface NewStepReqBody {
  ok: boolean;
  data: {
    newSeeds: string[];
    maxPathLength: number;
    maxPathProps: number;
    predLimit: {
      limType: 'blacklist' | 'whitelist';
      limPredicates: string[];
    };
    followDirection: boolean;
    predsDirMetrics?: PredDirMetrics[];
    resetErrors: boolean;
  };
}

export const POST: RequestHandler = async ({ request, params }) => {
  const resp = (await request.json()) as NewStepReqBody;
  if (!params.pid) {
    log.warn('No process ID provided');
    return json({ ok: false, err: { message: 'No process ID provided' } }, { status: 400 });
  }

  console.log('XXXXXXXXXXXXXXX add-step server 3', JSON.stringify(resp.data, null, 2));

  const procParams: MakeOptional<StepClass, 'seeds'> = {
    seeds: resp.data.newSeeds,
    maxPathLength: resp.data.maxPathLength,
    maxPathProps: resp.data.maxPathProps,
    predLimit: resp.data.predLimit,
    followDirection: resp.data.followDirection,
    predsDirMetrics: resp.data.predsDirMetrics,
    resetErrors: resp.data.resetErrors
  };

  const proc = await Process.findOne({ pid: params.pid });
  if (!proc) {
    log.warn(`Process ${params.pid} not found`);
    return json({ ok: false, err: { message: 'Process not found' } }, { status: 404 });
  }
  if (proc.status !== 'done') {
    log.warn(`Process ${params.pid} is still running, cannot add another step`);
    return json(
      { ok: false, err: { message: 'Process still running, cannot add another step' } },
      { status: 400 }
    );
  }

  await addStep(params!.pid!, procParams);
  log.info(`Added step to process ${params.pid}`);

  return json({ ok: true }, { status: 201 });
};
