import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { Process } from '@derzis/models';

export const load: PageServerLoad = async ({ params }) => {
	const p = await Process.findOne({ pid: params.pid });
	if (!p) {
		throw error(404, {
			message: 'Not found'
		});
	}

	if (!p.currentStep?.predsDirMetrics) {
		throw error(400, {
			message: 'No predsDirMetrics found for current step'
		});
	}

	return {
		proc: {
			pid: p.pid,
			currentStep: {
				seeds: p.currentStep.seeds,
				predsDirMetrics: p.currentStep.predsDirMetrics
			}
		}
	};
};
