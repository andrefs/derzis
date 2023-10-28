import { error } from '@sveltejs/kit';
import { secondsToString } from '$lib/utils';
import { Process, ProcessClass, Resource } from '@derzis/models';
import { addStep as addStepHelper } from '$lib/process-helper';
import { redirect, type Action } from '@sveltejs/kit';

export async function load({ params }) {
	const _p: ProcessClass | null = await Process.findOne({ pid: params.pid }).lean();
	if (!_p) {
		throw error(404, {
			message: 'Not found'
		});
	}

	const lastResource = await Resource.findOne().sort({ updatedAt: -1 });
	const timeRunning = lastResource
		? (lastResource!.updatedAt.getTime() - _p.createdAt.getTime()) / 1000
		: null;
	const p = {
		..._p,
		createdAt: _p.createdAt?.toISOString(),
		updatedAt: _p.updatedAt?.toISOString() || _p.createdAt,
		timeRunning: timeRunning ? secondsToString(timeRunning) : '',
		notification: {
			..._p.notification,
			email: _p?.notification?.email
				?.replace(/(?<=.).*?(?=.@)/, (x) => '*'.repeat(x.length))
				?.replace(/^..(?=@)/, '**')
		}
	};

	return { proc: structuredClone(p) };
}

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
				?.split(/\s*[\n]\s*/)
				.filter((s: string) => !s.match(/^\s*$/)),
			blackList: (data.get('black-list') as string)
				?.split(/\s*[\n]\s*/)
				.filter((s: string) => !s.match(/^\s*$/))
		};

		addStepHelper(params!.pid, procParams);

		throw redirect(303, `/processes/${params.pid}`);
	}
	//update: async ({ params }) => { }
};
