import { Process, ProcessClass } from './Process';
import { createLogger } from '@derzis/common/server';
import { sendEmail } from '@derzis/common/server';
import { webhookPost } from '@derzis/common/server';
import { type LiteralTripleDocument } from '../Triple';
import { getLabelDataForProcess } from './process-data';
import { GlobalMetrics, PredicateMetrics, SeedPredicateMetrics } from './process-metrics';
import type { SimpleTriple } from '@derzis/common';
const log = createLogger('ProcessNotifications');

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
    messageType: 'OK_LABELS_FETCHED',
    message: `Process ${pid} has ${labelData.length} labels from ${totalTriples} triples ready to send to Cardea.`,
    details: { labels: labelData }
  };

  const notif: ProcessNotification = { ok: true, data };

  log.info(`Sending labels to Cardea for process ${pid}`, process.notification.webhook ?? '');

  if (process.notification.webhook) {
    await notifyWebhook(process.notification.webhook, notif);
  }
}

export async function notifySingleLabelFetched(url: string, triples: SimpleTriple[], pid: string) {
  if (!triples.length) {
    log.debug(`No triples for label ${url}, skipping notification`);
    return;
  }

  const process = await Process.findOne({ pid });
  if (!process) {
    log.error(`Process ${pid} not found when sending single label to Cardea`);
    return;
  }

  const labelData = [{ url, triples }];

  const data: LabelFetchedNotification = {
    pid,
    messageType: 'OK_LABEL_FETCHED',
    message: `Process ${pid} has fetched label for ${url} (${triples.length} triples).`,
    details: { labels: labelData }
  };

  const notif: ProcessNotification = { ok: true, data };

  log.info(
    `Sending single label to Cardea for process ${pid}: ${url}`,
    process.notification.webhook ?? ''
  );

  if (process.notification.webhook) {
    await notifyWebhook(process.notification.webhook, notif);
  }
}

export async function notifyGlobalMetricsCalculated(
  pid: string,
  metrics: GlobalMetrics,
  stepIndex: number
) {
  const process = await Process.findOne({ pid });
  if (!process) {
    log.error(`Process ${pid} not found when sending global metrics to Cardea`);
    return;
  }

  const data: GlobalMetricsCalculatedNotification = {
    pid,
    messageType: 'OK_GLOBAL_METRICS_CALCULATED',
    message: `Process ${pid} has calculated global metrics for step ${stepIndex}.`,
    details: { stepIndex, globalMetrics: metrics }
  };

  const notif: ProcessNotification = { ok: true, data };

  log.info(
    `Sending seed predicate metrics to Cardea for process ${pid}`,
    process.notification.webhook ?? ''
  );

  if (process.notification.webhook) {
    await notifyWebhook(process.notification.webhook, notif);
  }
}

export async function notifySeedPredMetricsCalculated(
  pid: string,
  metrics: SeedPredicateMetrics[],
  stepIndex: number
) {
  const process = await Process.findOne({ pid });
  if (!process) {
    log.error(`Process ${pid} not found when sending seed predicate metrics to Cardea`);
    return;
  }

  const data: SeedPredMetricsCalculatedNotification = {
    pid,
    messageType: 'OK_SEED_PRED_METRICS_CALCULATED',
    message: `Process ${pid} has calculated seed predicate metrics for step ${stepIndex}.`,
    details: { stepIndex, seedPredMetrics: metrics }
  };

  const notif: ProcessNotification = { ok: true, data };

  log.info(
    `Sending seed predicate metrics to Cardea for process ${pid}`,
    process.notification.webhook ?? ''
  );

  if (process.notification.webhook) {
    await notifyWebhook(process.notification.webhook, notif);
  }
}

export async function notifyPredMetricsCalculated(
  pid: string,
  metrics: PredicateMetrics[],
  stepIndex: number
) {
  const process = await Process.findOne({ pid });
  if (!process) {
    log.error(`Process ${pid} not found when sending metrics to Cardea`);
    return;
  }

  const data: PredMetricsCalculatedNotification = {
    pid,
    messageType: 'OK_PRED_METRICS_CALCULATED',
    message: `Process ${pid} has calculated predicate metrics for step ${stepIndex}.`,
    details: { stepIndex, metrics }
  };

  const notif: ProcessNotification = { ok: true, data };

  log.info(`Sending metrics to Cardea for process ${pid}`, process.notification.webhook ?? '');

  if (process.notification.webhook) {
    await notifyWebhook(process.notification.webhook, notif);
  }
}

export async function notifyStepStarted(process: ProcessClass) {
  const notif: ProcessNotification = {
    ok: true,
    data: {
      pid: process.pid,
      messageType: 'OK_STEP_STARTED',
      message: `Process ${process.pid} just started step #${process.steps.length}.`,
      details: process.currentStep
    }
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
  const notif: ProcessNotification = {
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
    }
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
  const doneResourceCount = process.currentStep.doneResourceCount ?? 0;
  const stepIndex = process.steps.length - 1; // 0-based index of the step that just finished

  // Build details object including stepIndex and all fields from currentStep
  const stepData = process.currentStep.toObject
    ? process.currentStep.toObject()
    : process.currentStep;
  const details = {
    // eslint-disable-next-line no-restricted-syntax
    ...(stepData as object),
    stepIndex
  };

  const notif: ProcessNotification = {
    ok: true,
    data: {
      pid: process.pid,
      messageType: 'OK_STEP_FINISHED',
      message: `Process ${process.pid} just finished step #${process.steps.length} with ${doneResourceCount} resources completed.`,
      details
    }
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
  const notif: ProcessNotification = {
    ok: true,
    data: {
      pid: process.pid,
      messageType: 'OK_STEP_STARTED',
      message: `Step ${process.steps.length} of ${process.pid} has started.`,
      details: process.currentStep
    }
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

const notifyEmail = async (email: string, notif: ProcessNotification): Promise<void> => {
  try {
    await sendEmail({
      to: email,
      from: 'derzis@andrefs.com',
      text: notif.data.message,
      html: `<p>${notif.data.message}</p>`,
      subject: 'Derzis - Event'
    });
  } catch (e) {
    log.error('Error sending email notification', e);
  }
};

const notifyWebhook = async (webhook: string, notif: ProcessNotification): Promise<void> => {
  let retries = 0;
  while (retries < 3) {
    try {
      await webhookPost(webhook, notif);
      return;
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
  details: unknown;
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
  details: unknown;
  messageType: 'OK_STEP_FINISHED';
};

type StepStartedNotification = BaseProcNotification & {
  details: unknown;
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

export type LabelFetchedNotification = BaseProcNotification & {
  details: {
    labels: Array<{
      url: string;
      triples: SimpleTriple[];
    }>;
  };
  messageType: 'OK_LABEL_FETCHED';
};

export type GlobalMetricsCalculatedNotification = BaseProcNotification & {
  details: {
    stepIndex: number;
    globalMetrics: GlobalMetrics;
  };
  messageType: 'OK_GLOBAL_METRICS_CALCULATED';
};

export type SeedPredMetricsCalculatedNotification = BaseProcNotification & {
  details: {
    stepIndex: number;
    seedPredMetrics: SeedPredicateMetrics[];
  };
  messageType: 'OK_SEED_PRED_METRICS_CALCULATED';
};

export type PredMetricsCalculatedNotification = BaseProcNotification & {
  details: {
    stepIndex: number;
    metrics: PredicateMetrics[];
  };
  messageType: 'OK_PRED_METRICS_CALCULATED';
};

type ProcessNotification = {
  ok: boolean;
  data:
    | StepStartedNotification
    | StepFinishedNotification
    | ProcStartNotification
    | ProcCreatedNotification
    | LabelsFetchedNotification
    | LabelFetchedNotification
    | GlobalMetricsCalculatedNotification
    | PredMetricsCalculatedNotification
    | SeedPredMetricsCalculatedNotification;
};
