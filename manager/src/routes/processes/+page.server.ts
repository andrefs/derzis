import { newProcess } from '$lib/process-helper';
import type { RecursivePartial } from '@derzis/common';
import { Process, StepClass, type ProcessClass } from '@derzis/models';
import { redirect, type Action } from '@sveltejs/kit';

export async function load() {
	const ps: ProcessClass[] = await Process.find().lean();
	const _ps = ps.map((p) => ({ ...p, createdAt: p.createdAt?.toISOString() }));

	return {
		processes: structuredClone(_ps)
	};
}

/** @type {import('./$types').Actions} */
export const actions: { [name: string]: Action } = {
	newProc: async ({ request }) => {
		const data = await request.formData();
		const seeds: string[] = (data.get('seeds') as string)
			?.split(/\s*[\n,]\s*/)
			.filter((s: string) => !s.match(/^\s*$/));
		const uniqueSeeds = [...new Set(seeds)];

		const firstStep: RecursivePartial<StepClass> = {
			maxPathLength: Number(data.get('maxPathLength')),
			maxPathProps: Number(data.get('maxPathProps')),
			predLimit: {
				limType: data.get('limitation-type') as 'blacklist' | 'whitelist',

				limPredicates: (data.get('pred-list') as string)
					?.split(/\s*[\n]\s*/)
					.filter((s: string) => !s.match(/^\s*$/)),
			},
			seeds: uniqueSeeds
		};

		const p: RecursivePartial<ProcessClass> = {
			steps: [firstStep],
			currentStep: firstStep,
			notification: {
				email: data.get('email') as string,
				webhook: data.get('webhook') as string
			},
		};
		const proc = await newProcess(p);

		throw redirect(303, `/processes/${proc.pid}`);
	}
};
