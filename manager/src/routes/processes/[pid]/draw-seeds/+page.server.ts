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

	console.log('XXXXXXXXXXXXX', p.currentStep.predsDirMetrics);

	return {
		proc: {
			pid: p.pid,
			currentStep: {
				seeds: p.currentStep.seeds,
				branchFactors: p.currentStep.predsDirMetrics.reduce((acc, metric) => {
					if (!metric.branchFactor) {
						return acc;
					}
					if (metric.branchFactor.obj === 0) {
						acc.set(metric.url, Infinity);
						return acc;
					}
					acc.set(metric.url, metric.branchFactor?.subj / metric.branchFactor?.obj);
					return acc;
				}, new Map<string, number>())
			}
		}
	};
}

