import { error } from '@sveltejs/kit';
import { LiteralTriple, NamedNodeTripleClass, Process } from '@derzis/models';
import { NamedNodeTriple } from '@derzis/models';
import { ProcessTriple } from '@derzis/models';
import { Resource } from '@derzis/models';
import type { PageServerLoad } from './$types';

/**
 * Load function to fetch triples related to a specific URL for a given process.
 * It checks if the process exists, retrieves triples where the URL is a source,
 * and marks which triples are associated with the process.
 *
 * @param {Object} params - The parameters from the request, including pid.
 * @param {URL} url - The URL object containing search parameters.
 * @returns {Object} An object containing process info, the URL, triples, and a resource map.
 */
export const load: PageServerLoad = async ({ params, url }) => {
  const { pid } = params;
  const urlParam = url.searchParams.get('url');

  // Check if process exists
  const process = await Process.findOne({ pid });
  if (!process) {
    throw error(404, {
      message: 'Process not found'
    });
  }

  const resourceUrl = urlParam ? decodeURIComponent(urlParam) : '';

  if (!resourceUrl) {
    return {
      process: { pid },
      url: '',
      triples: []
    };
  }

  try {
    // Find all triples where sources includes the url
    const nnTriples = await NamedNodeTriple.find({ sources: resourceUrl });
    const lTriples = await LiteralTriple.find({ sources: resourceUrl });

    // Get IDs of triples that are in ProcessTriple for this process
    const processTripleIds = await ProcessTriple.find({ processId: pid }).distinct('triple');
    const processTripleIdSet = new Set(processTripleIds.map((id) => id.toString()));

    // Get all unique URLs from subjects and objects of these triples
    const allUrls = new Set<string>();
    [...lTriples, ...nnTriples].forEach((triple) => {
      allUrls.add(triple.subject);
      if (triple.type === 'namedNode') {
        allUrls.add((triple as NamedNodeTripleClass).object);
      }
    });

    // Mark triples as found in process or not
    const triplesWithStatus = nnTriples.map((triple) => {
      const tripleObj = triple.toObject();
      return {
        subject: tripleObj.subject,
        predicate: tripleObj.predicate,
        object: tripleObj.object,
        sources: tripleObj.sources,
        nodes: tripleObj.nodes,
        inProcess: processTripleIdSet.has(triple._id.toString())
      };
    });

    const resources = await Resource.find({
      url: { $in: triplesWithStatus.flatMap((t) => t.nodes) }
    });
    const resourceMap = new Map(resources.map((r) => [r.url, true]));

    return {
      process: { pid },
      url: resourceUrl,
      triples: triplesWithStatus,
      resourceMap
    };
  } catch (err) {
    console.error('Error loading triples:', err);
    throw error(500, {
      message: 'Error loading triples'
    });
  }
};
