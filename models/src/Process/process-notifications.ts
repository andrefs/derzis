import { ProcessClass } from './Process';
import { createLogger } from '@derzis/common/server';
import { sendEmail } from '@derzis/common/server';
import { webhookPost } from '@derzis/common/server';
const log = createLogger('ProcessNotifications');

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
  const notif = {
    ok: true,
    data: {
      pid: process.pid,
      messageType: 'OK_STEP_FINISHED',
      message: `Process ${process.pid} just finished step #${process.steps.length}.`,
      details: process.currentStep
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

type ProcessNotification = {
  ok: boolean;
  data:
    | StepStartedNotification
    | StepFinishedNotification
    | ProcStartNotification
    | ProcCreatedNotification;
};
