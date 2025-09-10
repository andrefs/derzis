import { error } from '@sveltejs/kit';
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
