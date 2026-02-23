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
    const labelData = labels.map(url => ({ pid, url, source, extend }));
    await ResourceLabel.upsertMany(labelData);

    return json({ ok: true, created: labelData.length });
  } catch (e) {
    return json({ ok: false, err: String(e) }, { status: 500 });
  }
}
