import { Process, ProcessClass } from './Process';
import { ResourceLabel } from '../ResourceLabel';
import { createLogger } from '@derzis/common/server';
import { sendEmail } from '@derzis/common/server';
import { webhookPost } from '@derzis/common/server';
import { LiteralTriple, LiteralTripleClass, type LiteralTripleDocument } from '../Triple';
const log = createLogger('ProcessNotifications');

const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
const RDFS_COMMENT = 'http://www.w3.org/2000/01/rdf-schema#comment';

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
  // Fetch all done labels for this process
  const labels = await ResourceLabel
    .find({
      pid,
      status: 'done',
      source: 'cardea',
      extend: false
    })
    .select('url -_id')
    .lean();

  if (!labels.length) {
    log.info(`No done labels to send for process ${pid}`);
    return;
  }

  // Get process to access webhook
  const process = await Process.findOne({ pid });
  if (!process) {
    log.error(`Process ${pid} not found when sending labels to Cardea`);
    return;
  }

  const triples: LiteralTripleDocument[] = await LiteralTriple
    .find({
      subject: { $in: labels.map(l => l.url) },
      predicate: {
        $in: [RDFS_LABEL, RDFS_COMMENT]
      }
    });
  const triplesBySubj: { [url: string]: LiteralTripleDocument[] } = {};
  for (const triple of triples) {
    if (!triplesBySubj[triple.subject]) {
      triplesBySubj[triple.subject] = [];
    }
    triplesBySubj[triple.subject].push(triple);
  }
  const res: { url: string, triples: LiteralTripleDocument[] }[] = [];
  // need to cross-reference the labels with the triples to only send triples for the labels that are done and from cardea source
  for (const url of labels.map(l => l.url)) {
    if (triplesBySubj[url]) {
      res.push({
        url,
        triples: triplesBySubj[url]
      });
    }
  }

  const data: LabelsFetchedNotification = {
    pid,
    messageType: 'OK_LABELS_FETCHED' as const,
    message: `Process ${pid} has ${Object.keys(triplesBySubj).length} labels from ${triples.length} triples ready to send to Cardea.`,
    details: { labels: res }
  }

  const notif: ProcessNotification = { ok: true, data };

  log.info(
    `Sending labels to Cardea for process ${pid}`,
    process.notification.webhook ?? ''
  );

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
export type LabelsFetchedNotification = BaseProcNotification & {
  details: {
    labels: Array<{
      url: string;
      triples: LiteralTripleDocument[]
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
