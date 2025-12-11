import { newProcess } from '$lib/process-helper';
import { NotificationClass, Process, StepClass, type ProcessClass } from '@derzis/models';
import { error, json } from '@sveltejs/kit';
import type { RecursivePartial } from '@derzis/common';
import type { RequestEvent } from './$types';

export type BaseAPIResponse = {
	ok: boolean;
	err: string;
	data: any;
};

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
	const { ok, err, data }: BaseAPIResponse = await request.json();
	if (!ok) {
		throw error(424, err);
	}
	const pskel = data.process;
	const process = {
		prevSteps: [],
		currentStep: pskel.step,
		notification: pskel.notification,
	};

	try {
		const proc = await newProcess(process);

		return json({
			ok: true,
			process: proc
		});
	} catch (e) {
		return json({
			ok: false,
			err: e
		});
	}
}
