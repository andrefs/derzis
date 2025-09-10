import { error } from '@sveltejs/kit';
import * as processHelper from '$lib/process-helper';
import type { PageServerLoad } from './$types';
import { Process } from '@derzis/models';

export const load: PageServerLoad = async ({ params }) => {
  const p = await Process.findOne({ pid: params.pid });
  if (!p) {
    throw error(404, {
      message: 'Not found'
    });
  }

  // get all triples from async iterator
  const triples = await Array.fromAsync(p?.getTriples());

  console.log('XXXXXXXXXXXXXXXX', { triples })

  return {
    proc: structuredClone({
      pid: p.pid,
    }),
    triples
  };
};
