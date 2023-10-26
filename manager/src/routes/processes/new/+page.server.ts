import { newProcess } from '$lib/process-helper';
import { redirect, type Action } from '@sveltejs/kit';

/** @type {import('./$types').Actions} */
export const actions: { [name: string]: Action } = {
	default: async ({ request }) => {
		const data = await request.formData();

		const seeds: string[] = (data.get('seeds') as string)
			?.split(/\s*[\n,]\s*/)
			.filter((s: string) => !s.match(/^\s*$/));
		const uniqueSeeds = [...new Set(seeds)];

		const p = {
			params: {
				maxPathLength: Number(data.get('maxPathLength')),
				maxPathProps: Number(data.get('maxPathProps')),
				whiteList: (data.get('white-list') as string)
					?.split(/\s*[\n]\s*/)
					.filter((s: string) => !s.match(/^\s*$/)),
				blackList: (data.get('black-list') as string)
					?.split(/\s*[\n]\s*/)
					.filter((s: string) => !s.match(/^\s*$/))
			},
			notification: {
				email: data.get('email') as string,
				webhook: data.get('webhook') as string
			},
			seeds: uniqueSeeds
		};

		const proc = await newProcess(p);

		throw redirect(303, `/processes/${proc.pid}`);
	}
};
