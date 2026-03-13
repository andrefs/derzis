import { Process, ProcessClass } from './Process';
import { createLogger } from '@derzis/common/server';
import { sendEmail } from '@derzis/common/server';
import { webhookPost } from '@derzis/common/server';
import { type LiteralTripleDocument } from '../Triple';
import { getLabelDataForProcess, getDoneResourceCount } from './process-data';
const log = createLogger('ProcessNotifications');

/**
 * Notify Cardea that all labels for a process have been fetched and are ready to be sent.
 * This will fetch all labels with status 'done' for the given process, and send them to Cardea via the process webhook.
 * If no labels are found, it will log that and return without sending a notification.
 * If the process is not found, it will log an error and return without sending a notification.
 * If the process has no webhook, it will log that and return without sending a notification.
 * If the notification is sent successfully, it will log that.
 * @param pid The process ID for which to notify that labels have been fetched.
 */
export async function notifyLabelsFetched(pid: string) {
  const labelData = await getLabelDataForProcess(pid);

  if (!labelData || labelData.length === 0) {
    log.info(`No done labels to send for process ${pid}`);
    return;
  }

  const process = await Process.findOne({ pid });
  if (!process) {
    log.error(`Process ${pid} not found when sending labels to Cardea`);
    return;
  }

  const totalTriples = labelData.reduce((sum, item) => sum + item.triples.length, 0);

  const data: LabelsFetchedNotification = {
    pid,
    messageType: 'OK_LABELS_FETCHED' as const,
    message: `Process ${pid} has ${labelData.length} labels from ${totalTriples} triples ready to send to Cardea.`,
    details: { labels: labelData }
  };

  const notif: ProcessNotification = { ok: true, data };

  log.info(`Sending labels to Cardea for process ${pid}`, process.notification.webhook ?? '');

  if (process.notification.webhook) {
    await notifyWebhook(process.notification.webhook, notif);
  }
}

export async function notifyStepStarted(process: ProcessClass) {
  const notif = {
    ok: true,
    data: {
      pid: process.pid,
      messageType: 'OK_STEP_STARTED',
      message: `Process ${process.pid} just started step #${process.steps.length}.`,
      details: process.currentStep
    } as StepStartedNotification
  };

  log.info(
    `Notifying starting next step on project ${process.pid}`,
    process.notification.email ?? '',
    process.notification.webhook ?? ''
  );

  if (process.notification.email) {
    await notifyEmail(process.notification.email, notif);
  }
  if (process.notification.webhook) {
    await notifyWebhook(process.notification.webhook, notif);
  }
}

export async function notifyProcessCreated(process: ProcessClass) {
  const notif = {
    ok: true,
    data: {
      pid: process.pid,
      messageType: 'OK_PROC_CREATED',
      message: `Process ${process.pid} has been created.`,
      details: {
        pid: process.pid,
        notification: process.notification,
        steps: process.steps,
        currentStep: process.currentStep,
        status: process.status
      }
    } as ProcCreatedNotification
  };

  log.info(
    `Notifying creation of project ${process.pid}`,
    process.notification.email ?? '',
    process.notification.webhook ?? ''
  );

  if (process.notification.email) {
    await notifyEmail(process.notification.email, notif);
  }
  if (process.notification.webhook) {
    await notifyWebhook(process.notification.webhook, notif);
  }
}

export async function notifyStepFinished(process: ProcessClass) {
  const doneResourceCount = await getDoneResourceCount(process);
  
  const notif = {
    ok: true,
    data: {
      pid: process.pid,
      messageType: 'OK_STEP_FINISHED',
      message: `Process ${process.pid} just finished step #${process.steps.length} with ${doneResourceCount} resources completed.`,
      details: {
        ...process.currentStep,
        doneResourceCount
      }
    } as StepFinishedNotification
  };

  log.info(
    `Notifying step finished on project ${process.pid}`,
    process.notification.email ?? '',
    process.notification.webhook ?? ''
  );
  log.info('Notification details: ' + JSON.stringify(notif, null, 2));

  if (process.notification.email) {
    await notifyEmail(process.notification.email, notif);
  }
  if (process.notification.webhook) {
    await notifyWebhook(process.notification.webhook, notif);
  }
}

export async function notifyStart(process: ProcessClass) {
  const notif = {
    ok: true,
    data: {
      pid: process.pid,
      messageType: 'OK_STEP_STARTED',
      message: `Step ${process.steps.length} of ${process.pid} has started.`,
      details: process.currentStep
    } as ProcStartNotification
  };

  log.info(
    `Notifying starting project ${process.pid}`,
    process.notification.email ?? '',
    process.notification.webhook ?? ''
  );

  if (process.notification.email) {
    try {
      await notifyEmail(process.notification.email, notif);
    } catch (e) {
      log.error('Error sending email notification', e);
    }
  }
  if (process.notification.webhook) {
    await notifyWebhook(process.notification.webhook, notif);
  }
}

const notifyEmail = async (email: string, notif: ProcessNotification) => {
  try {
    const res = await sendEmail({
      to: email,
      from: 'derzis@andrefs.com',
      text: notif.data.message,
      html: `<p>${notif.data.message}</p>`,
      subject: 'Derzis - Event'
    });
    return res;
  } catch (e) {
    log.error('Error sending email notification', e);
  }
};

const notifyWebhook = async (webhook: string, notif: ProcessNotification) => {
  let retries = 0;
  while (retries < 3) {
    try {
      const res = await webhookPost(webhook, notif);
      return res;
    } catch (e) {
      retries++;
      if (retries === 3) {
        log.error('Error sending webhook notification', e);
      }
    }
  }
};

interface BaseProcNotification {
  pid: string;
  messageType: string;
  message: string;
  details: any;
}

type ProcCreatedNotification = BaseProcNotification & {
  messageType: 'OK_PROC_CREATED';
  message: string;
};

type ProcStartNotification = BaseProcNotification & {
  messageType: 'OK_PROC_STARTED';
  message: string;
};

type StepFinishedNotification = BaseProcNotification & {
  details: any;
  messageType: 'OK_STEP_FINISHED';
};

type StepStartedNotification = BaseProcNotification & {
  details: any;
  messageType: 'OK_STEP_STARTED';
};
export type LabelsFetchedNotification = BaseProcNotification & {
  details: {
    labels: Array<{
      url: string;
      triples: LiteralTripleDocument[];
    }>;
  };
  messageType: 'OK_LABELS_FETCHED';
};

type ProcessNotification = {
  ok: boolean;
  data:
    | StepStartedNotification
    | StepFinishedNotification
    | ProcStartNotification
    | ProcCreatedNotification
    | LabelsFetchedNotification;
};
