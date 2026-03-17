import { error } from '@sveltejs/kit';
import { addStep as addStepHelper } from '$lib/process-helper';
import { redirect, type Action } from '@sveltejs/kit';
import * as processHelper from '$lib/process-helper';
import type { PageServerLoad } from './$types';
import type { PredicateLimitationType } from '@derzis/models';

export const load: PageServerLoad = async ({ params }) => {
  const p = await processHelper.info(params.pid);
  if (!p) {
    throw error(404, {
      message: 'Not found'
    });
  }

  return { proc: structuredClone(p) };
};

function parsePredLimitations(formData: FormData): { predicate: string; lims: PredicateLimitationType[] }[] {
  const predLimitations: { predicate: string; lims: PredicateLimitationType[] }[] = [];
  let index = 0;

  while (true) {
    const predicate = formData.get(`predLimitations[${index}].predicate`) as string | null;
    const past = formData.get(`predLimitations[${index}].past`) as string | null;
    const future = formData.get(`predLimitations[${index}].future`) as string | null;

    if (!predicate) break;

    const lims: PredicateLimitationType[] = [];
    if (past === 'require') lims.push('require-past');
    if (past === 'disallow') lims.push('disallow-past');
    if (future === 'require') lims.push('require-future');
    if (future === 'disallow') lims.push('disallow-future');

    if (lims.length > 0) {
      predLimitations.push({ predicate, lims });
    }

    index++;
  }

  return predLimitations;
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

    const seeds = (data.get('seeds') as string)
      ?.split(/\s*[\n,]\s*/)
      .filter((s: string) => !s.match(/^\s*$/));
    const maxPathLength = Number(data.get('maxPathLength'));
    const maxPathProps = Number(data.get('maxPathProps'));
    const followDirection = data.get('followDirection') === 'true';
    const resetErrors = data.get('resetErrors') === 'true';
    const convertToEndpointPaths = data.get('convertToEndpointPaths') === 'on';

    const predLimitations = parsePredLimitations(data);

    const procParams = {
      seeds,
      maxPathLength,
      maxPathProps,
      predLimitations,
      followDirection,
      predsDirMetrics: undefined,
      resetErrors,
      convertToEndpointPaths
    };

    await addStepHelper(params!.pid, procParams);

    throw redirect(303, `/processes/${params.pid}`);
  }
  //update: async ({ params }) => { }
};
