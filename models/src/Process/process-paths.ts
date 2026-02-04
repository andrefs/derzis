import { Path, type PathSkeleton, type PathDocument } from '../Path';
import { Process, ProcessClass } from './Process';
import { createLogger } from '@derzis/common/server';
import { ProcessTriple } from '../ProcessTriple';
import { Resource } from '../Resource';
const log = createLogger('ProcessPaths');
import { Types } from 'mongoose';

export async function getPathsForRobotsChecking(process: ProcessClass, skip = 0, limit = 20) {
	const paths = await Path.find({
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

export async function getPathsForDomainCrawl(process: ProcessClass, domainBlacklist: string[] = [], skip = 0, limit = 20): Promise<PathDocument[]> {
	const predLimFilter =
		process.currentStep.predLimit.limType === 'whitelist'
			? { 'predicates.elems': { $in: process.currentStep.predLimit.limPredicates } }
			: { 'predicates.elems': { $nin: process.currentStep.predLimit.limPredicates } };
	const paths = await Path.find({
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
	const paths = await Path.find({
		processId: process.pid,
		status: 'active',
		'head.domain.status': 'checking'
	});
	return !!paths.length;
}

export async function hasPathsHeadBeingCrawled(process: ProcessClass): Promise<boolean> {
	const paths = await Path.find({
		processId: process.pid,
		status: 'active',
		'head.status': 'crawling'
	});
	return !!paths.length;
}

export async function extendPathsWithExistingTriples(process: ProcessClass, paths: PathDocument[]) {
	for (const path of paths) {
		const newPathObjs = [];
		const toDelete = new Set();
		const procTriples: Set<Types.ObjectId> = new Set();

		const { newPaths: nps, procTriples: pts } = await path.extendWithExistingTriples(process);

		// if new paths were created
		if (nps.length) {
			toDelete.add(path._id);
			newPathObjs.push(...nps);
			for (const pt of pts) {
				procTriples.add(pt);
			}

			// create new paths
			const newPaths = await Path.create(newPathObjs);

			// add proc-triple associations
			await ProcessTriple.upsertMany(
				[...procTriples].map((tId) => ({
					processId: process.pid,
					triple: tId,
					processStep: process.steps.length
				}))
			);

			// mark old paths as deleted
			await Path.updateMany({ _id: { $in: Array.from(toDelete) } }, { $set: { status: 'deleted' } });

			// extend newly created paths recursively
			await extendPathsWithExistingTriples(process, newPaths);
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

	// Get total number of paths to process
	const totalPaths = await Path.countDocuments({
		processId: process.pid,
		status: 'active',
		'nodes.count': { $lt: process.currentStep.maxPathLength },
		'predicates.count': { $lte: process.currentStep.maxPathProps }
	});

	let processedPaths = 0;
	const startTime = Date.now();
	let batchCounter = 0;

	while (hasMore) {
		batchCounter++;
		const batchStartTime = Date.now();

		// find a batch of active paths that can be extended
		const paths = await Path.find({
			processId: process.pid,
			status: 'active',
			'nodes.count': { $lt: process.currentStep.maxPathLength },
			'predicates.count': { $lte: process.currentStep.maxPathProps }
		})
			.limit(batchSize)
			.skip(skip);

		if (paths.length === 0) {
			hasMore = false;
			break;
		}

		const percentage = Math.round((processedPaths / totalPaths) * 100);
		const elapsedTime = (Date.now() - startTime) / 1000;

		log.info(`Extending batch of ${paths.length} existing paths for process ${process.pid} (${processedPaths}/${totalPaths} - ${percentage}%)`);

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

export async function extendProcessPaths(process: ProcessClass, triplesByNode: { [headUrl: string]: any[] }) {
	const newHeads = Object.keys(triplesByNode);
	log.silly('New heads:', newHeads);
	const paths = await Path.find({
		processId: process.pid,
		status: 'active',
		'head.url': newHeads.length === 1 ? newHeads[0] : { $in: Object.keys(triplesByNode) }
	});
	log.silly('Paths:', paths);

	const pathsToDelete = new Set();
	const newPathObjs = [];
	const toDelete = new Set();
	const procTriples: Set<Types.ObjectId> = new Set();

	for (const path of paths) {
		const { newPaths: nps, procTriples: pts } = await path.extend(
			triplesByNode[path.head.url],
			process
		);
		log.silly('New paths:', nps);
		if (nps.length) {
			toDelete.add(path._id);
			newPathObjs.push(...nps);
			for (const pt of pts) {
				procTriples.add(pt);
			}
		}
	}

	await updateNewPathHeadStatus(newPathObjs);

	// add proc-triple associations
	await ProcessTriple.upsertMany(
		[...procTriples].map((tId) => ({
			processId: process.pid,
			triple: tId,
			processStep: process.steps.length
		}))
	);

	// create new paths
	const newPaths = await Path.create(newPathObjs);

	// mark old paths as deleted
	await Path.updateMany({ _id: { $in: Array.from(toDelete) } }, { $set: { status: 'deleted' } });

	// recursively extend newly created paths
	await extendPathsWithExistingTriples(process, newPaths);
}

/**
		* Update the head status of new paths based on existing Resource statuses.
		* @param newPaths Array of PathSkeleton objects to update.
		*/
async function updateNewPathHeadStatus(newPaths: PathSkeleton[]): Promise<void> {
	const headUrls = newPaths.map((p) => p.head.url);
	const resources = await Resource.find({ url: { $in: headUrls } })
		.select('url status')
		.lean();
	const resourceMap: { [url: string]: 'unvisited' | 'done' | 'crawling' | 'error' } = {};
	resources.forEach((r) => (resourceMap[r.url] = r.status));
	newPaths.forEach((p) => (p.head.status = resourceMap[p.head.url] || 'unvisited'));
}
