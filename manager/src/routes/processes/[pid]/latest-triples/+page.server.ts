import { error } from '@sveltejs/kit';
import { LiteralTripleClass, NamedNodeTripleClass, ProcessTriple } from '@derzis/models';
import { info as processInfo } from '$lib/process-helper';
import type { PageServerLoad } from './$types';
import { Types } from 'mongoose';

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
      // Access properties directly - after populate, procTriple.triple has the actual document
      const tripleAny = procTriple.triple as unknown as { _id: Types.ObjectId; subject: string; predicate: string; object: unknown; sources?: string[]; type?: string } | undefined;
      if (!tripleAny || !('_id' in tripleAny)) return null;
      
      // Convert object to string representation
      let objectStr: string;
      if (typeof tripleAny.object === 'string') {
        objectStr = tripleAny.object;
      } else if (tripleAny.object && typeof tripleAny.object === 'object') {
        const litObj = tripleAny.object as { value?: string; datatype?: string; language?: string };
        objectStr = litObj.value ?? String(tripleAny.object);
      } else {
        objectStr = String(tripleAny.object);
      }
      
      return {
        _id: tripleAny._id.toString(),
        processStep: procTriple.processStep,
        sources: tripleAny.sources ?? [],
        subject: tripleAny.subject,
        predicate: tripleAny.predicate,
        object: objectStr,
        createdAt: procTriple.createdAt?.toISOString()
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  return {
    proc,
    triples: latestTriples,
    count
  };
};
