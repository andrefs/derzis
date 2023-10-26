import { newProcess } from '$lib/process-helper';
import { Process, type ProcessClass } from '@derzis/models';
import { json } from '@sveltejs/kit';
import type { RecursivePartial } from '@derzis/common';
import type { RequestEvent } from './$types';

export async function GET() {
	const ps: ProcessClass[] = await Process.find().lean();
	const _ps = ps.map((p) => ({ ...p, createdAt: p.createdAt?.toISOString() }));

	return json({ processes: _ps });
}

export async function POST({ request }: RequestEvent) {
	const { process }: { process: RecursivePartial<ProcessClass> } = await request.json();

	const proc = await newProcess(process);

	return json(proc);
}
