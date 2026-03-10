import { json, type RequestHandler } from '@sveltejs/kit';
import { Process } from '@derzis/models';
import { createLogger } from '@derzis/common/server';

const log = createLogger('API:end-step');

export const POST: RequestHandler = async ({ params }) => {
  if (!params.pid) {
    log.warn('No process ID provided');
    return json({ ok: false, err: { message: 'No process ID provided' } }, { status: 400 });
  }

  const proc = await Process.findOne({ pid: params.pid });
  if (!proc) {
    log.warn(`Process ${params.pid} not found`);
    return json({ ok: false, err: { message: 'Process not found' } }, { status: 404 });
  }

  if (proc.status !== 'running' && proc.status !== 'extending') {
    log.warn(`Process ${params.pid} is not running (status: ${proc.status}), cannot end step`);
    return json(
      { ok: false, err: { message: 'Process is not running, cannot end step' } },
      { status: 400 }
    );
  }

  await proc.done();
  log.info(`Ended step for process ${params.pid}`);

  return json({ ok: true }, { status: 200 });
};
