import { error } from '@sveltejs/kit';
import { Path, Triple, Process, ProcessTriple } from '@derzis/models';
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
		// Get the process to access step followDirection values
		const process = await Process.findOne({ pid }).lean();
		const stepFollowDirections: Record<number, boolean> = {};
		if (process?.steps) {
			process.steps.forEach((step: { followDirection?: boolean }, index: number) => {
				stepFollowDirections[index + 1] = step.followDirection || false;
			});
		}

		// Find all paths with the given seed and head URLs to count max/min
		const lpFilter = {
			processId: pid,
			'seed.url': seedUrl,
			'head.url': headUrl,
			status: 'active'
		};
		const _longestPath = await Path.find(lpFilter)
			.sort({ 'nodes.count': -1 })
			.limit(1)
			.lean();

		const spFilter = {
			processId: pid,
			'seed.url': seedUrl,
			'head.url': headUrl,
			status: 'active'
		};
		const _shortestPath = await Path.find(spFilter)
			.sort({ 'nodes.count': 1 })
			.limit(1)
			.lean();


		if (_longestPath.length === 0 || _shortestPath.length === 0) {
			return {
				process: { pid },
				seedUrl,
				headUrl,
				longestPathData: null,
				shortestPathData: null,
				errorMessage: 'No active paths found with the specified seed and head URLs.'
			};
		}


		const longestPath = _longestPath[0];
		const shortestPath = _shortestPath[0];

		const maxNodes = longestPath.nodes.count;
		const minNodes = shortestPath.nodes.count;

		const longestPathsCount = await Path.countDocuments(lpFilter).where('nodes.count').equals(maxNodes);
		const shortestPathsCount = await Path.countDocuments(spFilter).where('nodes.count').equals(minNodes);


		// Get the actual triple documents for the longest path
		const longestTriples = await Triple.find({
			_id: { $in: longestPath.triples }
		})
			.select('subject predicate object sources')
			.lean();

		// Get ProcessTriple info to find followDirection for each triple
		const longestProcTriples = await ProcessTriple.find({
			processId: pid,
			triple: { $in: longestPath.triples }
		}).lean();

		// Sort triples to maintain the same order as in the Path document
		const longestTriplesInOrder = longestPath.triples.map(tripleId => {
			const foundTriple = longestTriples.find(t => t._id?.toString() === tripleId.toString());
			const procTriple = longestProcTriples.find(pt => pt.triple?.toString() === tripleId.toString());
			const step = procTriple?.processStep || null;
			return foundTriple ? {
				...foundTriple,
				_id: foundTriple._id?.toString(),
				followDirection: step !== null ? (stepFollowDirections[step] || false) : false,
				processStep: step,
				sources: foundTriple.sources || []
			} : null;
		}).filter(Boolean) as Array<{
			subject: string;
			predicate: string;
			object: string;
			_id?: string;
			followDirection: boolean;
			processStep: number;
			sources: string[];
		}>;

		// Process shortest path if found
		let shortestPathData = null;
		if (shortestPath) {
			// Get the actual triple documents for the shortest path
			const shortestTriples = await Triple.find({
				_id: { $in: shortestPath.triples }
			})
				.select('subject predicate object sources')
				.lean();

			// Get ProcessTriple info to find followDirection for each triple
			const shortestProcTriples = await ProcessTriple.find({
				processId: pid,
				triple: { $in: shortestPath.triples }
			}).lean();

			// Sort triples to maintain the same order as in the Path document
			const shortestTriplesInOrder = shortestPath.triples.map(tripleId => {
				const foundTriple = shortestTriples.find(t => t._id?.toString() === tripleId.toString());
				const procTriple = shortestProcTriples.find(pt => pt.triple?.toString() === tripleId.toString());
				const step = procTriple?.processStep || 1;
				return foundTriple ? {
					...foundTriple,
					_id: foundTriple._id?.toString(),
					followDirection: stepFollowDirections[step] || false,
					processStep: step,
					sources: foundTriple.sources || []
				} : null;
			}).filter(Boolean) as Array<{
				subject: string;
				predicate: string;
				object: string;
				_id?: string;
				followDirection: boolean;
				processStep: number;
				sources: string[];
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
			shortestPathData,
			longestPathsCount,
			shortestPathsCount
		};
	} catch (err) {
		console.error('Error loading path data:', err);
		throw error(500, {
			message: 'Error loading path data'
		});
	}
};
