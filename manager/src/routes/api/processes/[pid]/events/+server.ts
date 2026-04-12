import { error } from '@sveltejs/kit';
import { Process } from '@derzis/models';
import { getPathProgress, getCrawlRate, getDistinctPathHeadsRemaining } from '@derzis/models';
import type { RequestEvent } from './$types';

const PROGRESS_INTERVAL_MS = 10000;

export async function GET({ params }: RequestEvent) {
  const process = await Process.findOne({ pid: params.pid });

  if (!process) {
    throw error(404, { message: 'Process not found' });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let isActive = true;

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

          const pathProgress = await getPathProgress(latestProcess);
          const crawlRate = await getCrawlRate(latestProcess, 5);
          const distinctHeads = await getDistinctPathHeadsRemaining(latestProcess);

          const event = {
            type: 'PROGRESS',
            step: latestProcess.steps.length,
            paths: {
              done: pathProgress.done,
              remaining:
                pathProgress.remaining.unvisited +
                pathProgress.remaining.crawling +
                pathProgress.remaining.checking,
              distinctHeads
            },
            rate: crawlRate
          };

          const data = `data: ${JSON.stringify(event)}\n\n`;
          try {
            controller.enqueue(encoder.encode(data));
          } catch (enqueueErr) {
            if ((enqueueErr as any).code === 'ERR_INVALID_STATE') {
              isActive = false;
              clearInterval(intervalId);
              return;
            }
            throw enqueueErr;
          }
        } catch (err) {
          console.error('Error sending progress event:', err);
          isActive = false;
          clearInterval(intervalId);
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
