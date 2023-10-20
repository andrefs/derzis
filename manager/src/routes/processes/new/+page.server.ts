import { Process } from '@derzis/models';
import { redirect, type Action } from '@sveltejs/kit';

/** @type {import('./$types').Actions} */
export const actions: { [name: string]: Action } = {
	default: async ({ request }) => {
		const data = await request.formData();

		const seeds: string[] = (data.get('seeds') as string)
			?.split(/\s*[\n,]\s*/)
			.filter((s: string) => !s.match(/^\s*$/));
		const uniqueSeeds = [...new Set(seeds)];

		const pathHeads: Map<string, number> = new Map();
		for (const s of seeds) {
			const domain = new URL(s).origin;
			if (!pathHeads.get(domain)) {
				pathHeads.set(domain, 0);
			}
			pathHeads.set(domain, pathHeads.get(domain)! + 1);
		}

		const p = {
			params: {
				maxPathLength: data.get('maxPathLength') as string,
				maxPathProps: data.get('maxPathProps') as string,
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
			seeds: uniqueSeeds,
			pathHeads
		};

		const process = await Process.create(p);
		await Process.startNext();
		throw redirect(303, `/processes/${process.pid}`);
	}
};
