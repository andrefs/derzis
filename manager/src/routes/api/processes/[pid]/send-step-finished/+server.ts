import { json, error, type RequestHandler } from '@sveltejs/kit';
import { notifyStepFinished } from '@derzis/models/Process/process-notifications';
import { Process } from '@derzis/models';
import { createLogger } from '@derzis/common/server';

const log = createLogger('API:send-step-finished');

export const POST: RequestHandler = async ({ params }) => {
  const { pid } = params;

  if (!pid) {
    return error(400, { message: 'Missing process ID' });
  }

  const process = await Process.findOne({ pid }).select('notification').lean();
  if (!process) {
    log.warn(`Process ${pid} not found`);
    return json({ ok: false, err: { message: 'Process not found' } }, { status: 404 });
  }

  // Check if at least email or webhook is configured
  if (!process.notification.email && !process.notification.webhook) {
    return json(
      { ok: false, err: { message: 'No email or webhook configured for this process' } },
      { status: 400 }
    );
  }

  try {
    // Need to fetch the full process document (not just lean) to pass to notifyStepFinished
    const fullProcess = await Process.findOne({ pid });
    if (!fullProcess) {
      return json({ ok: false, err: { message: 'Process not found' } }, { status: 404 });
    }
    await notifyStepFinished(fullProcess);
    log.info(`Manually sent step finished notification for process ${pid}`);
    return json({ ok: true, message: 'Step finished notification sent successfully' });
  } catch (e) {
    log.error(`Error sending step finished notification for process ${pid}:`, e);
    return json(
      { ok: false, err: { message: 'Failed to send step finished notification' } },
      { status: 500 }
    );
  }
};
