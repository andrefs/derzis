import { ResourceLabel } from '@derzis/models';
import { getLabelDataForProcess } from '@derzis/models/Process/process-data';
import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from './$types';

interface LabelsRequest {
  ok: boolean;
  err?: string;
  data: {
    labels: string[];
    source: 'cardea' | 'web';
    extend: boolean;
  };
}


/**
 * GET /api/processes/[pid]/labels
 * Fetch done labels for the process
 */
export async function GET({ params }: RequestEvent) {
  const { pid } = params;

  if (!pid) {
    throw error(400, 'Missing process ID');
  }

  try {
    const labels = await getLabelDataForProcess(pid);

    return json({
      ok: true,
      labels
    });
  } catch (e) {
    return json({ ok: false, err: String(e) }, { status: 500 });
  }
}




/**
 * POST /api/processes/[pid]/labels
 * Add new labels for the process. This will upsert labels based on the URL, so if a label with the same URL already exists for the process, it will not create a duplicate.
 * The request body should be a JSON object with the following structure:
 * {
 *   "ok": true,
 *   "data": {
 *     "labels": ["http://example.com/resource1", "http://example.com/resource2"],
 *     "source": "cardea",
 *     "extend": false
 *   }
 * }
 */
export async function POST({ params, request }: RequestEvent) {
  const { pid } = params;

  if (!pid) {
    throw error(400, 'Missing process ID');
  }

  let body: LabelsRequest;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  if (!body.ok) {
    throw error(424, body.err ?? 'Unknown error');
  }

  const { labels, source, extend } = body.data;

  if (!Array.isArray(labels) || labels.length === 0) {
    return json({ ok: true, created: 0 });
  }

  try {
    const results = await Promise.all(
      labels.map(async (url) => {
        const label = await ResourceLabel.findOneAndUpdate(
          { pid, url, source },
          {
            $setOnInsert: {
              pid,
              url,
              source,
              extend,
              status: 'new'
            }
          },
          { upsert: true, new: true }
        );
        return label;
      })
    );

    const created = results.filter((r: unknown) => r).length;

    return json({ ok: true, created });
  } catch (e) {
    return json({ ok: false, err: String(e) }, { status: 500 });
  }
}
