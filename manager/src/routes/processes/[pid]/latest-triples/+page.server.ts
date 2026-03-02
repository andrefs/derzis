import { error } from '@sveltejs/kit';
import { ProcessTriple, type LiteralTripleDocument, type NamedNodeTripleDocument } from '@derzis/models';
import { info as processInfo } from '$lib/process-helper';
import type { PageServerLoad } from './$types';
import type { Types } from 'mongoose';

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
      // After populate, triple can be a document or just an ObjectId
      // We know it's populated because we called .populate('triple'), so we cast
      const triple = procTriple.triple as NamedNodeTripleDocument | LiteralTripleDocument | undefined;
      if (!triple || !('_id' in triple)) return null;

      // Check object type directly - NamedNodeTriple has string, LiteralTriple has LiteralObject
      let objectStr: string;
      if (typeof triple.object === 'string') {
        objectStr = triple.object;
      } else {
        // LiteralObject case
        objectStr = triple.object.value ?? String(triple.object);
      }

      return {
        _id: triple._id.toString(),
        processStep: procTriple.processStep,
        sources: triple.sources ?? [],
        subject: triple.subject,
        predicate: triple.predicate,
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
