import { error } from '@sveltejs/kit';
import { secondsToString } from '$lib/utils';
import { Process, ProcessClass, Resource, Triple, Path } from '@derzis/models';
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

		const procParams = {
			seeds: (data.get('seeds') as string)
				?.split(/\s*[\n,]\s*/)
				.filter((s: string) => !s.match(/^\s*$/)),
			maxPathLength: Number(data.get('maxPathLength')),
			maxPathProps: Number(data.get('maxPathProps')),
			whiteList: (data.get('white-list') as string)
				?.split(/\s*[\n,]\s*/)
				.filter((s: string) => !s.match(/^\s*$/)),
			blackList: (data.get('black-list') as string)
				?.split(/\s*[\n,]\s*/)
				.filter((s: string) => !s.match(/^\s*$/))
		};

		addStepHelper(params!.pid, procParams);

		throw redirect(303, `/processes/${params.pid}`);
	}
	//update: async ({ params }) => { }
};
