import { error } from '@sveltejs/kit';
import { LiteralTripleClass, NamedNodeTripleClass, ProcessTriple } from '@derzis/models';
import { info as processInfo } from '$lib/process-helper';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
  const proc = await processInfo(params.pid);
  if (!proc) {
    throw error(404, {
      message: 'Not found'
    });
  }

  const count = parseInt(url.searchParams.get('count') || '100', 10);
  if (isNaN(count) || count <= 0) {
    throw error(400, {
      message: 'Invalid count parameter'
    });
  }

  const procTriples = await ProcessTriple.find({ processId: params.pid })
    .sort({ createdAt: -1 }) // Most recent first
    .limit(count)
    .populate('triple')
    .lean();

  const latestTriples = procTriples
    .map((procTriple) => {
      const triple = procTriple.triple as NamedNodeTripleClass | LiteralTripleClass;
      return {
        _id: procTriple.triple._id.toString(),
        processStep: procTriple.processStep,
        sources: triple.sources,
        subject: triple.subject,
        predicate: triple.predicate,
        object: triple.object,
        createdAt: procTriple.createdAt?.toISOString()
      }
    });

  return {
    proc,
    triples: latestTriples,
    count
  };
};
