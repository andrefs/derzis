import { addStep } from '$lib/process-helper';
import { Process } from '@derzis/models';
import { json, type RequestHandler } from '@sveltejs/kit';
import { createLogger } from 'vite';
const log = createLogger();

export const POST: RequestHandler = async ({ request, params }) => {
  const data = await request.json();

  const procParams = {
    seeds: data.seeds,
    maxPathLength: data.maxPathLength,
    maxPathProps: data.maxPathProps,
    whiteList: data.whiteList,
    blackList: data.blackList
  };

  const proc = await Process.findOne({ pid: params.pid });
  if (!proc) {
    return json({ ok: false, err: { message: 'Process not found' } }, { status: 404 });
  }
  if (proc.status !== 'done') {
    return json({ ok: false, err: { message: 'Process still running, cannot add another step' } }, { status: 400 });
  }


  addStep(params!.pid!, procParams);

  return json({ ok: true }, { status: 201 });
}
