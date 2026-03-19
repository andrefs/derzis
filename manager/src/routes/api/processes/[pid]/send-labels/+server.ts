import { json, error, type RequestHandler } from '@sveltejs/kit';
import { notifyLabelsFetched } from '@derzis/models/Process/process-notifications';
import { Process } from '@derzis/models';
import { createLogger } from '@derzis/common/server';
const log = createLogger('API');

export const POST: RequestHandler = async ({ params }) => {
  const { pid } = params;

  if (!pid) {
    return error(400, { message: 'Missing process ID' });
  }

  const process = await Process.findOne({ pid }).select('notification.webhook').lean();
  if (!process) {
    log.warn(`Process ${pid} not found`);
    return json({ ok: false, err: { message: 'Process not found' } }, { status: 404 });
  }

  if (!process.notification.webhook) {
    return json(
      { ok: false, err: { message: 'No webhook configured for this process' } },
      { status: 400 }
    );
  }

  try {
    await notifyLabelsFetched(pid);
    log.info(`Manually sent labels for process ${pid}`);
    return json({ ok: true, message: 'Labels sent successfully' });
  } catch (e) {
    log.error(`Error sending labels for process ${pid}:`, e);
    return json({ ok: false, err: { message: 'Failed to send labels' } }, { status: 500 });
  }
};
