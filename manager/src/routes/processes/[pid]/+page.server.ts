import { error } from '@sveltejs/kit';
import { addStep as addStepHelper } from '$lib/process-helper';
import { redirect, type Action } from '@sveltejs/kit';
import * as processHelper from '$lib/process-helper';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const p = await processHelper.info(params.pid);
	if (!p) {
		throw error(404, {
			message: 'Not found'
		});
	}

	return { proc: structuredClone(p) };
};

/** @type {import('./$types').Actions} */
export const actions: { [name: string]: Action } = {
	addStep: async ({ request, params }) => {
		if (!params.pid) {
			throw error(404, {
				message: 'Not found'
			});
		}
		const data = await request.formData();

		const seeds = (data.get('seeds') as string)
			?.split(/\s*[\n,]\s*/)
			.filter((s: string) => !s.match(/^\s*$/));
		const maxPathLength = Number(data.get('maxPathLength'));
		const maxPathProps = Number(data.get('maxPathProps'));
		const predLimType = data.get('predLimType') as string;
		const predList = (data.get('predList') as string)
			?.split(/\s*[\n,]\s*/)
			.filter((s: string) => !s.match(/^\s*$/));
		const followDirection = data.get('followDirection') === 'true';


		const procParams = {
			seeds,
			maxPathLength,
			maxPathProps,
			predLimit: {
				limType: predLimType as 'whitelist' | 'blacklist',
				limPredicates: predList
			},
			followDirection,
			predsDirMetrics: undefined
		};

		await addStepHelper(params!.pid, procParams);

		throw redirect(303, `/processes/${params.pid}`);
	}
	//update: async ({ params }) => { }
};
