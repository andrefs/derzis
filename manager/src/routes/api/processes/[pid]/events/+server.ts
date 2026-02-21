import { error } from '@sveltejs/kit';
import { Process } from '@derzis/models';
import { getPathProgress, getCrawlRate } from '@derzis/models';
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
        if (!isActive || controller.desiredSize === null) {
          return;
        }

        try {
          const pathProgress = await getPathProgress(process);
          const crawlRate = await getCrawlRate(process, 5);

          const event = {
            type: 'PROGRESS',
            step: process.steps.length,
            paths: {
              done: pathProgress.done,
              remaining: pathProgress.remaining.unvisited + pathProgress.remaining.crawling + pathProgress.remaining.checking
            },
            rate: crawlRate
          };

          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch (err) {
          console.error('Error sending progress event:', err);
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
      'Connection': 'keep-alive'
    }
  });
}
