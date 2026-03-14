import { newProcess } from '$lib/process-helper';
import type { RecursivePartial } from '@derzis/common';
import { Process, StepClass, type ProcessClass, type PredicateLimitationType } from '@derzis/models';
import { redirect, type Action } from '@sveltejs/kit';

export async function load() {
  const ps: ProcessClass[] = await Process.find().lean();
  const _ps = ps.map((p) => ({ ...p, createdAt: p.createdAt?.toISOString() }));

  return {
    processes: structuredClone(_ps)
  };
}

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
  newProc: async ({ request }) => {
    const data = await request.formData();
    const seeds: string[] = (data.get('seeds') as string)
      ?.split(/\s*[\n,]\s*/)
      .filter((s: string) => !s.match(/^\s*$/));
    const uniqueSeeds = [...new Set(seeds)];

    const predLimitations = parsePredLimitations(data);

    const firstStep: RecursivePartial<StepClass> = {
      maxPathLength: Number(data.get('maxPathLength')),
      maxPathProps: Number(data.get('maxPathProps')),
      predLimitations,
      seeds: uniqueSeeds
    };

    const p: RecursivePartial<ProcessClass> = {
      steps: [firstStep],
      currentStep: firstStep,
      notification: {
        email: data.get('email') as string,
        webhook: data.get('webhook') as string
      }
    };
    const proc = await newProcess(p);

    throw redirect(303, `/processes/${proc.pid}`);
  }
};
