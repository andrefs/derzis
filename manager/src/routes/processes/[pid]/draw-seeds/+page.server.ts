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

  if (!p.currentStep?.predsDirection) {
    throw error(400, {
      message: 'No predsDirection found for current step'
    });
  }

  return {
    proc: {
      pid: p.pid,
      currentStep: {
        seeds: p.currentStep.seeds,
        branchFactors: p.currentStep.predsDirection.reduce((acc, metric) => {
          acc.set(metric.url, metric.ratio);
          return acc;
        }, new Map<string, number>())
      }
    }
  };
};
