import { error } from '@sveltejs/kit';
import { Process } from '@derzis/models';
import {
  getPathProgress,
  getCrawlRate,
  getDistinctPathHeadsRemaining,
  getExtendingProgress
} from '@derzis/models';
import type { RequestEvent } from './$types';

const PROGRESS_INTERVAL_MS = 10000;
const MAX_CONSECUTIVE_ERRORS = 5;

export async function GET({ params }: RequestEvent) {
  const process = await Process.findOne({ pid: params.pid });

  if (!process) {
    throw error(404, { message: 'Process not found' });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let isActive = true;
      let errorsSinceLastSuccess = 0;

      const sendEvent = async () => {
        if (!isActive) {
          clearInterval(intervalId);
          return;
        }

        try {
          if (controller.desiredSize === null) {
            isActive = false;
            clearInterval(intervalId);
            return;
          }

          const latestProcess = await Process.findOne({ pid: params.pid });
          if (!latestProcess) {
            isActive = false;
            clearInterval(intervalId);
            return;
          }

          // Fix 3: emit terminal event and close when process is done/error
          if (latestProcess.status === 'done' || latestProcess.status === 'error') {
            const event = {
              type: latestProcess.status === 'done' ? 'PROCESS_DONE' : 'PROCESS_ERROR',
              status: latestProcess.status,
              step: latestProcess.steps.length,
              totalPaths: latestProcess.currentStep?.doneResourceCount ?? 0
            };
            const data = `data: ${JSON.stringify(event)}\n\n`;
            try {
              controller.enqueue(encoder.encode(data));
            } catch (_) {}
            isActive = false;
            clearInterval(intervalId);
            try {
              controller.close();
            } catch (_) {}
            return;
          }

          let event;
          if (latestProcess.status === 'extending') {
            const extendingProgress = await getExtendingProgress(latestProcess);
            // Fix 2: if no done-head paths to extend (common for endpoint),
            // show crawling-style progress instead of 0/0
            if (extendingProgress.total === 0) {
              const pathProgress = await getPathProgress(latestProcess);
              const crawlRate = await getCrawlRate(latestProcess, 5);
              const distinctHeads = await getDistinctPathHeadsRemaining(latestProcess);
              event = {
                type: 'PROGRESS',
                phase: 'crawling',
                step: latestProcess.steps.length,
                paths: {
                  remaining:
                    pathProgress.remaining.unvisited +
                    pathProgress.remaining.crawling +
                    pathProgress.remaining.checking,
                  distinctHeads,
                  eta: crawlRate > 0 ? distinctHeads / crawlRate : 0
                },
                rate: crawlRate
              };
            } else {
              event = {
                type: 'PROGRESS',
                phase: 'extending',
                step: latestProcess.steps.length,
                extending: extendingProgress
              };
            }
          } else {
            const pathProgress = await getPathProgress(latestProcess);
            const crawlRate = await getCrawlRate(latestProcess, 5);
            const distinctHeads = await getDistinctPathHeadsRemaining(latestProcess);

            event = {
              type: 'PROGRESS',
              phase: 'crawling',
              step: latestProcess.steps.length,
              paths: {
                remaining:
                  pathProgress.remaining.unvisited +
                  pathProgress.remaining.crawling +
                  pathProgress.remaining.checking,
                distinctHeads,
                eta: crawlRate > 0 ? distinctHeads / crawlRate : 0
              },
              rate: crawlRate
            };
          }

          const data = `data: ${JSON.stringify(event)}\n\n`;
          try {
            controller.enqueue(encoder.encode(data));
            errorsSinceLastSuccess = 0;
          } catch (enqueueErr) {
            if ((enqueueErr as any).code === 'ERR_INVALID_STATE') {
              isActive = false;
              clearInterval(intervalId);
              return;
            }
            throw enqueueErr;
          }
        } catch (err) {
          // Fix 1: non-fatal error recovery - keep stream alive, retry next tick
          console.error('Error sending progress event:', err);
          errorsSinceLastSuccess++;
          if (errorsSinceLastSuccess > MAX_CONSECUTIVE_ERRORS) {
            isActive = false;
            clearInterval(intervalId);
          }
        }
      };

      sendEvent();

      const intervalId = setInterval(sendEvent, PROGRESS_INTERVAL_MS);

      return () => {
        isActive = false;
        clearInterval(intervalId);
      };
    },
    cancel() {}
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    }
  });
}
