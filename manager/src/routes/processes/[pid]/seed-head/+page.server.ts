import { error } from '@sveltejs/kit';
import { Path } from '@derzis/models';
import { Triple } from '@derzis/models';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const { pid } = params;
	const seedUrl = url.searchParams.get('seedUrl') || '';
	const headUrl = url.searchParams.get('headUrl') || '';

	// Check if process exists by trying to find paths for it
	const processCheck = await Path.findOne({ processId: pid });
	if (!processCheck) {
		throw error(404, {
			message: 'Process not found'
		});
	}

	if (!seedUrl || !headUrl) {
		return {
			process: { pid },
			seedUrl: '',
			headUrl: '',
			pathData: null
		};
	}

	try {
		// Find the longest path with the given seed and head URLs
		const longestPaths = await Path.find({
			processId: pid,
			'seed.url': seedUrl,
			'head.url': headUrl,
			status: 'active'
		})
			.sort({ 'nodes.count': -1 }) // Sort by longest path first
			.limit(1)
			.lean();

		// Find the shortest path with the given seed and head URLs
		const shortestPaths = await Path.find({
			processId: pid,
			'seed.url': seedUrl,
			'head.url': headUrl,
			status: 'active'
		})
			.sort({ 'nodes.count': 1 }) // Sort by shortest path first
			.limit(1)
			.lean();

		if (longestPaths.length === 0) {
			return {
				process: { pid },
				seedUrl,
				headUrl,
				longestPathData: null,
				shortestPathData: null,
				errorMessage: 'No active paths found with the specified seed and head URLs.'
			};
		}

		const longestPath = longestPaths[0];

		// Get the actual triple documents for the longest path
		const longestTriples = await Triple.find({
			_id: { $in: longestPath.triples }
		})
			.select('subject predicate object')
			.lean();

		// Sort triples to maintain the same order as in the Path document
		const longestTriplesInOrder = longestPath.triples.map(tripleId => {
			const foundTriple = longestTriples.find(t => t._id?.toString() === tripleId.toString());
			return foundTriple ? { ...foundTriple, _id: foundTriple._id?.toString() } : null;
		}).filter(Boolean) as Array<{
			subject: string;
			predicate: string;
			object: string;
			_id?: string;
		}>;

		// Process shortest path if found
		let shortestPathData = null;
		if (shortestPaths.length > 0) {
			const shortestPath = shortestPaths[0];

			// Get the actual triple documents for the shortest path
			const shortestTriples = await Triple.find({
				_id: { $in: shortestPath.triples }
			})
				.select('subject predicate object')
				.lean();

			// Sort triples to maintain the same order as in the Path document
			const shortestTriplesInOrder = shortestPath.triples.map(tripleId => {
				const foundTriple = shortestTriples.find(t => t._id?.toString() === tripleId.toString());
				return foundTriple ? { ...foundTriple, _id: foundTriple._id?.toString() } : null;
			}).filter(Boolean) as Array<{
				subject: string;
				predicate: string;
				object: string;
				_id?: string;
			}>;

			shortestPathData = {
				nodes: shortestPath.nodes.elems,
				predicates: shortestPath.predicates.elems,
				triples: shortestTriplesInOrder
			};
		}

		return {
			process: { pid },
			seedUrl,
			headUrl,
			longestPathData: {
				nodes: longestPath.nodes.elems,
				predicates: longestPath.predicates.elems,
				triples: longestTriplesInOrder
			},
			shortestPathData
		};
	} catch (err) {
		console.error('Error loading path data:', err);
		throw error(500, {
			message: 'Error loading path data'
		});
	}
};