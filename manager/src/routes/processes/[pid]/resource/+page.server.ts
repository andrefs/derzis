import { error } from '@sveltejs/kit';
import { Process } from '@derzis/models';
import { Triple } from '@derzis/models';
import { ProcessTriple } from '@derzis/models';
import type { PageServerLoad } from './$types';

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
		const triples = await Triple.find({ sources: resourceUrl });

		// Get IDs of triples that are in ProcessTriple for this process
		const processTripleIds = await ProcessTriple.find({ processId: pid }).distinct('triple');
		const processTripleIdSet = new Set(processTripleIds.map(id => id.toString()));

		// Mark triples as found in process or not
		const triplesWithStatus = triples.map(triple => {
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

		return {
			process: { pid },
			url: resourceUrl,
			triples: triplesWithStatus
		};
	} catch (err) {
		console.error('Error loading triples:', err);
		throw error(500, {
			message: 'Error loading triples'
		});
	}
};