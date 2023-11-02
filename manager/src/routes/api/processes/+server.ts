import { newProcess } from '$lib/process-helper';
import { NotificationClass, Process, StepClass, type ProcessClass } from '@derzis/models';
import { json } from '@sveltejs/kit';
import type { RecursivePartial } from '@derzis/common';
import type { RequestEvent } from './$types';

export async function GET() {
	const ps: ProcessClass[] = await Process.find().lean();
	const _ps = ps.map((p) => ({ ...p, createdAt: p.createdAt?.toISOString() }));

	return json({ processes: _ps });
}

interface ProcessSkel {
	notification: NotificationClass;
	step: Partial<StepClass>;
}

export async function POST({ request }: RequestEvent) {
	const { process: pskel }: { process: ProcessSkel } = await request.json();

	const process = {
		steps: [pskel.step],
		currentStep: pskel.step,
		notification: pskel.notification
	};

	const proc = await newProcess(process);

	return json(proc);
}
