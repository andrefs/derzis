import { ResourceLabel } from '@derzis/models';
import { getLabelDataForProcess, getLabelDataForUrls } from '@derzis/models/Process/process-data';
import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from './$types';

interface LabelsRequest {
  ok: boolean;
  err?: string;
  data: {
    resources: string[];
    source: 'cardea' | 'web';
    extend: boolean;
  };
}

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
 * Receives a list of resource URLs to label for a given process. The request body should be in the format:
 * {
 *   "ok": true,
 *   "data": {
 *     "resources": ["http://example.com/resource1", "http://example.com/resource2"],
 *     "source": "cardea",
 *     "extend": false
 *   }
 * }
 *
 * The `source` field indicates where the labels are coming from (e.g., 'cardea' or 'web').
 * The `extend` field indicates whether to crawl the resources (and subsequent path expansion) or just dereference to find label triples.
 *
 * The endpoint will upsert the provided resources as labels for the specified process.
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
  const { resources, source, extend } = body.data;

  if (!Array.isArray(resources) || resources.length === 0) {
    return json({ ok: true, created: 0, labels: [] });
  }

  try {
    const resData = resources.map((url) => ({ pid, url, source, extend }));
    await ResourceLabel.upsertMany(resData);

    const existingDoneLabels = await getLabelDataForUrls(resources);

    return json({ ok: true, created: resData.length, labels: existingDoneLabels });
  } catch (e) {
    return json({ ok: false, err: String(e) }, { status: 500 });
  }
}
