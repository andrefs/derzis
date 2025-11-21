import { addStep } from '$lib/process-helper';
import { Process } from '@derzis/models';
import { json, type RequestHandler } from '@sveltejs/kit';
import { createLogger } from '@derzis/common';
const log = createLogger('API');

interface NewStepReqBody {
  ok: boolean;
  data: {
    newSeeds: string[];
    maxPathLength: number;
    maxPathProps: number;
    predLimit: {
      type: 'blacklist' | 'whitelist';
      predicates: string[];
    }
  };
}

export const POST: RequestHandler = async ({ request, params }) => {
  const resp = await request.json() as NewStepReqBody;
  if (!params.pid) {
    log.warn('No process ID provided');
    return json({ ok: false, err: { message: 'No process ID provided' } }, { status: 400 });
  }

  const procParams = {
    seeds: resp.data.newSeeds,
    maxPathLength: resp.data.maxPathLength,
    maxPathProps: resp.data.maxPathProps,

    predLimit: resp.data.predLimit,
  };

  const proc = await Process.findOne({ pid: params.pid });
  if (!proc) {
    log.warn(`Process ${params.pid} not found`);
    return json({ ok: false, err: { message: 'Process not found' } }, { status: 404 });
  }
  if (proc.status !== 'done') {
    log.warn(`Process ${params.pid} is still running, cannot add another step`);
    return json({ ok: false, err: { message: 'Process still running, cannot add another step' } }, { status: 400 });
  }


  await addStep(params!.pid!, procParams);
  log.info(`Added step to process ${params.pid}`);

  return json({ ok: true }, { status: 201 });
}
