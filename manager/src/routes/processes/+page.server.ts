import { newProcess } from '$lib/process-helper';
import { Process, type ProcessClass } from '@derzis/models';
import { redirect, type Action } from '@sveltejs/kit';

export async function load() {
	const ps: ProcessClass[] = await Process.find().lean();
	const _ps = ps.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() }));

	return {
		processes: _ps
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

		const p = {
			currentStep: {
				maxPathLength: Number(data.get('maxPathLength')),
				maxPathProps: Number(data.get('maxPathProps')),
				whiteList: (data.get('white-list') as string)
					?.split(/\s*[\n]\s*/)
					.filter((s: string) => !s.match(/^\s*$/)),
				blackList: (data.get('black-list') as string)
					?.split(/\s*[\n]\s*/)
					.filter((s: string) => !s.match(/^\s*$/)),
				seeds: uniqueSeeds
			},
			notification: {
				email: data.get('email') as string,
				webhook: data.get('webhook') as string
			}
		};

		const proc = await newProcess(p);

		throw redirect(303, `/processes/${proc.pid}`);
	},
	addStep: async ({ params, body }) => { },
	update: async ({ params, body }) => { }
};
