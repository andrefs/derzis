import { TraversalPath, type TraversalPathSkeleton, type TraversalPathDocument } from '../Path';
import { Process, ProcessClass } from './Process';
import { createLogger } from '@derzis/common/server';
import { ProcessTriple } from '../ProcessTriple';
import { Resource } from '../Resource';
const log = createLogger('ProcessPaths');
import { Types } from 'mongoose';
import { Triple } from '../Triple';

export async function getPathsForRobotsChecking(process: ProcessClass, skip = 0, limit = 20) {
	const paths = await TraversalPath.find({
		processId: process.pid,
		status: 'active',
		'head.domain.status': 'unvisited',
		'nodes.count': { $lt: process.currentStep.maxPathLength },
		'predicates.count': { $lte: process.currentStep.maxPathProps }
	})
		// shorter paths first
		.sort({ 'nodes.count': 1 })
		.limit(limit)
		.skip(skip)
		.select('head.domain head.url')
		.lean();
	return paths;
}

export async function getPathsForDomainCrawl(process: ProcessClass, domainBlacklist: string[] = [], skip = 0, limit = 20): Promise<TraversalPathDocument[]> {
	const predLimFilter =
		process.currentStep.predLimit.limType === 'whitelist'
			? { 'predicates.elems': { $in: process.currentStep.predLimit.limPredicates } }
			: { 'predicates.elems': { $nin: process.currentStep.predLimit.limPredicates } };
	const paths = await TraversalPath.find({
		processId: process.pid,
		status: 'active',
		'head.domain.status': 'ready',
		'head.domain.origin': domainBlacklist.length ? { $nin: domainBlacklist } : { $exists: true },
		'head.status': 'unvisited',
		'nodes.count': { $lt: process.currentStep.maxPathLength },
		'predicates.count': { $lte: process.currentStep.maxPathProps },
		...predLimFilter
	})
		// shorter paths first
		.sort({ 'nodes.count': 1 })
		.limit(limit)
		.skip(skip)
		.select('head.domain head.url head.status nodes.elems predicates.elems');
	return paths;
}

export async function hasPathsDomainRobotsChecking(process: ProcessClass): Promise<boolean> {
	const pathsCount = await TraversalPath.countDocuments({
		processId: process.pid,
		status: 'active',
		'head.domain.status': 'checking'
	});
	return !!pathsCount;
}

export async function hasPathsHeadBeingCrawled(process: ProcessClass): Promise<boolean> {
	const pathsCount = await TraversalPath.countDocuments({
		processId: process.pid,
		status: 'active',
		'head.status': 'crawling'
	});
	return !!pathsCount;
}

export async function extendPathsWithExistingTriples(proc: ProcessClass, paths: TraversalPathDocument[]) {
	log.silly(`Extending ${paths.length} paths for process ${proc.pid} with existing triples...`);

	for (const path of paths) {
		const newPathObjs = [];
		const toDelete = new Set();
		const procTriples: Set<Types.ObjectId> = new Set();

		const { extendedPaths: eps, procTriples: pts } = await path.extendWithExistingTriples(proc);

		// if new paths were created
		if (eps.length) {
			toDelete.add(path._id);
			newPathObjs.push(...eps);
			for (const pt of pts) {
				procTriples.add(pt);
			}

			let newPaths: TraversalPathDocument[] = [];
			if (newPathObjs.length) {
				// create new paths
				newPaths = await TraversalPath.create(newPathObjs);
			} else {
				log.silly('No new paths to create.');
			}

			if (procTriples.size) {
				// add proc-triple associations
				await ProcessTriple.upsertMany(
					[...procTriples].map((tId) => ({
						processId: proc.pid,
						triple: tId,
						processStep: proc.steps.length
					}))
				);
			} else {
				log.silly('No new process-triple associations to add.');
			}

			if (toDelete.size) {
				// mark old paths as deleted if their head status is 'done'
				await TraversalPath.updateMany(
					{
						_id: { $in: Array.from(toDelete) },
						'head.status': { $in: ['done'] }
					},
					{ $set: { status: 'deleted' } });
			} else {
				log.silly('No old paths to delete.');
			}

			if (newPaths.length) {
				// extend newly created paths recursively
				await extendPathsWithExistingTriples(proc, newPaths);
			} else {
				log.silly('No new paths to extend further.');
			}
		}
	}
}

/**
 * Extend existing active paths for a process according to its current step limits.
 * @param pid Process ID
 */
export async function extendExistingPaths(pid: string) {
	const process = await Process.findOne({ pid });
	if (!process) {
		log.warn(`Process ${pid} not found. Skipping extendExistingPaths.`);
		return;
	}
	if (process.status !== 'extending') {
		log.warn(`Process ${process.pid} is not in 'extending' status. Skipping extendExistingPaths.`);
		return;
	}

	// Process paths in batches to avoid using up too much memory
	const batchSize = 100;
	let skip = 0;
	let hasMore = true;


	const query = {
		processId: process.pid,
		status: 'active',
		'nodes.count': { $lt: process.currentStep.maxPathLength },
		'predicates.count': { $lte: process.currentStep.maxPathProps }
	};

	// Get total number of paths to process
	const initPathsCount = await TraversalPath.countDocuments(query);

	let processedPaths = 0;
	const startTime = Date.now();
	let batchCounter = 0;

	while (hasMore) {
		batchCounter++;
		const batchStartTime = Date.now();

		const curPathsCount = await TraversalPath.countDocuments(query);

		// find a batch of active paths that can be extended
		const paths = await TraversalPath.find(query)
			.sort({ 'nodes.count': 1 }) // shorter paths first
			.limit(batchSize)
			.skip(skip);

		if (paths.length === 0) {
			hasMore = false;
			break;
		}

		//const percentage = Math.round((processedPaths / initPathsCount) * 100);
		const percentage = Math.round((skip / curPathsCount) * 100);
		const elapsedTime = (Date.now() - startTime) / 1000;

		//log.info(`Extending batch of ${paths.length} existing paths for process ${process.pid} (${processedPaths}/${initPathsCount} - ${percentage}%)`);
		log.info(`Extending batch of ${paths.length} existing paths for process ${process.pid} (${skip}/${curPathsCount} - ${percentage}%)`);

		await extendPathsWithExistingTriples(process, paths);
		processedPaths += paths.length;

		const batchTime = (Date.now() - batchStartTime) / 1000;
		log.info(`Batch ${batchCounter} completed in ${batchTime.toFixed(2)}s (Total elapsed: ${elapsedTime.toFixed(2)}s)`);

		// add a 1s delay between batches to reduce DB load
		log.debug('Waiting 1s before processing the next batch...');
		await new Promise((resolve) => setTimeout(resolve, 1000));
		log.silly('Continuing to next batch...');

		skip += batchSize;
	}

	const totalTime = (Date.now() - startTime) / 1000;
	log.info(`Finished extending existing paths for process ${process.pid}. Total time: ${totalTime.toFixed(2)}s`);
}

export async function extendProcessPaths(process: ProcessClass, headUrl: string) {
	log.info(`Extending paths for process ${process.pid} with head URL: ${headUrl}`);
	const paths = await TraversalPath.find({
		processId: process.pid,
		status: 'active',
		'head.url': headUrl,
	});
	if (!paths.length) {
		log.info(`No active paths found for process ${process.pid} with head URL: ${headUrl}`);
		return;
	}

	const triples = await Triple.find({
		nodes: headUrl,
	});

	if (!triples.length) {
		log.info(`No triples found connected to head URL: ${headUrl}`);
		return;
	}

	const pathsToCreate = [];
	const pathsToDelete = new Set();
	const procTriples: Set<Types.ObjectId> = new Set();

	for (const path of paths) {
		const { extendedPaths: eps, procTriples: pts } = await path.genExtended(
			triples,
			process
		);
		log.silly('Extended paths:', eps);
		// if new paths were created gather them
		if (eps.length) {
			pathsToDelete.add(path._id);
			pathsToCreate.push(...eps);
			for (const pt of pts) {
				procTriples.add(pt);
			}
		}
	}

	if (procTriples.size) {
		// add proc-triple associations
		await ProcessTriple.upsertMany(
			[...procTriples].map((tId) => ({
				processId: process.pid,
				triple: tId,
				processStep: process.steps.length
			}))
		);
	} else {
		log.silly('No new process-triple associations to add.');
	}

	let newPaths: TraversalPathDocument[] = [];
	if (pathsToCreate.length) {
		// update head status of new paths
		await setNewPathHeadStatus(pathsToCreate);

		// create new paths
		newPaths = await TraversalPath.create(pathsToCreate);
	} else {
		log.silly('No new paths to create.');
	}


	if (pathsToDelete.size) {
		// mark old paths as deleted if their head status is 'done'
		await TraversalPath.updateMany(
			{
				_id: { $in: Array.from(pathsToDelete) },
				'head.status': 'done'
			},
			{ $set: { status: 'deleted' } }
		);
	} else {
		log.silly('No old paths to delete.');
	}

	// recursively extend newly created paths
	await extendPathsWithExistingTriples(process, newPaths);
}

/**
		* Set the head status of new paths based on existing Resource statuses.
		* @param newPaths Array of TraversalPathSkeleton objects to update.
		*/
async function setNewPathHeadStatus(newPaths: TraversalPathSkeleton[]): Promise<void> {
	const headUrls = newPaths.map((p) => p.head.url);
	const resources = await Resource.find({ url: { $in: headUrls } })
		.select('url status')
		.lean();
	const resourceMap: { [url: string]: 'unvisited' | 'done' | 'crawling' | 'error' } = {};

	for (const r of resources) {
		resourceMap[r.url] = r.status;
	}

	for (const np of newPaths) {
		np.head.status = resourceMap[np.head.url] || 'unvisited';
	}
}
