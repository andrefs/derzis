import { Types, Document } from 'mongoose';
import { Resource } from '../Resource';
import { Triple, TripleClass } from '../Triple';
import { humanize } from 'humanize-digest';
import { TraversalPath, type TraversalPathSkeleton, type TraversalPathDocument, EndpointPath } from '../Path';
import { ProcessTriple } from '../ProcessTriple';
import { createLogger } from '@derzis/common/server';
const log = createLogger('Process');
import {
	prop,
	index,
	getModelForClass,
	pre,
	type ReturnModelType,
	PropType,
	type DocumentType
} from '@typegoose/typegoose';
import { Domain } from '../Domain';
import {
	getPathsForRobotsChecking,
	getPathsForDomainCrawl,
	hasPathsDomainRobotsChecking,
	hasPathsHeadBeingCrawled,
	extendExistingPaths,
	extendProcessPaths
} from './process-paths';
import {
	notifyStepStarted,
	notifyProcessCreated,
	notifyStepFinished,
	notifyStart
} from './process-notifications';
import { matchesOne } from './process-utils';
import {
	getTriples,
	getTriplesJson,
	getDomainsJson,
	getResourcesJson,
	getResourceCount,
	getAllResources,
	getAllDomains,
	getInfo,
	curPredsDirMetrics
} from './process-data';
import {
	BranchFactorClass,
	SeedPosRatioClass,
	NotificationClass,
	StepClass
} from './aux-classes';
import { PathType } from '@derzis/common';
import config from '@derzis/config';

@index({ status: 1 })
@index({ createdAt: 1 })
@index({ status: 1, createdAt: -1 })
@pre<ProcessClass>('save', async function () {
	const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
	const count = await Process.countDocuments({
		createdAt: { $gt: today }
	});
	if (!this.pid) {
		// YYYY-MM-DD-count
		const date = today.toISOString().split('T')[0] + '-' + count;
		// YYYY-MM-DD-HHMM
		const str =
			date + '-' + new Date().toISOString().split('T')[1].replace(/[:.]/g, '').slice(0, 4);
		const word = humanize('process' + str);
		this.pid = `${word}-${date}`;
	}
	if (!this.notification) {
		this.notification = {};
	}
	const ssePath = `/processes/${this.pid}/events`;
	this.notification.ssePath = ssePath;
})
class ProcessClass extends Document {
	createdAt?: Date;
	updatedAt?: Date;

	@prop({ index: true, unique: true, type: String })
	public pid!: string;

	@prop({ required: true, type: NotificationClass })
	public notification!: NotificationClass;

	@prop({ type: String })
	public description?: string;

	@prop({ required: true, type: StepClass })
	public currentStep!: StepClass;

	@prop({
		enum: ['endpoint', 'traversal'],
		required: true,
		type: String,
		default: 'endpoint'
	})
	public pathType!: 'endpoint' | 'traversal';

	/**
	 * All crawling steps, including the current one
	 */
	@prop({ required: true, default: [], type: [StepClass] }, PropType.ARRAY)
	public steps!: StepClass[];

	@prop({ required: true, type: Object })
	public pathHeads!: {
		required: true;
		type: { [key: string]: number };
	};

	/**
	 * Process status
	 * 'queued' - waiting to be started
	 * 'running' - currently running
	 * 'done' - finished successfully
	 * 'error' - finished with errors
	 * 'extending' - extending existing paths with existing triples
	 */
	@prop({
		enum: ['queued', 'running', 'done', 'error', 'extending'],
		default: 'queued',
		type: String
	})
	public status!: 'queued' | 'running' | 'done' | 'error' | 'extending';

	public whiteBlackListsAllow(this: ProcessClass, t: TripleClass) {
		// triple predicate allowed by white/blacklist
		if (!this.currentStep.predLimit) {
			return true;
		}
		if (this.currentStep.predLimit.limType === 'whitelist') {
			return matchesOne(t.predicate, this.currentStep.predLimit.limPredicates);
		}
		// blacklist
		return !matchesOne(t.predicate, this.currentStep.predLimit.limPredicates);
	}

	/**
	 * Check if the process is done
	 * @returns {Promise<boolean>} - Whether the process is done
	 */
	public async isDone(this: ProcessClass): Promise<boolean> {
		// process is done
		if (['done', 'error'].includes(this.status)) {
			return true;
		}

		if (this.status !== 'running') {
			log.info(`Process ${this.pid} is not running (status: ${this.status}), thus not done yet.`);
			return false;
		}

		// check for more paths to crawl or check

		const pathsToCrawl = await getPathsForDomainCrawl(this, [], 0, 1);
		const pathsToCheck = await getPathsForRobotsChecking(this, 0, 1);
		const hasPathsChecking = await hasPathsDomainRobotsChecking(this);
		const hasPathsCrawling = await hasPathsHeadBeingCrawled(this);

		// no more paths to crawl and no paths checking or crawling
		if (!pathsToCrawl.length && !pathsToCheck.length && !hasPathsChecking && !hasPathsCrawling) {
			log.warn(
				`Process ${this.pid} has no more paths for checking or crawling, and there there are no paths currently being checked or crawled. Marking process as done.`
			);
			log.silly(
				JSON.stringify({
					pathsToCrawl: pathsToCrawl.length,
					pathsToCheck: pathsToCheck.length,
					hasPathsChecking,
					hasPathsCrawling
				})
			);
			// mark as done and notify
			await this.done();
			return true;
		}

		// process is not done
		log.info(
			`Process ${this.pid} is not done yet: ` +
			JSON.stringify(
				{
					pathsToCrawl,
					pathsToCheck,
					hasPathsChecking,
					hasPathsCrawling
				},
				null,
				2
			)
		);
		return false;
	}

	/**
	 * Get triples as a stream
	 * @returns {AsyncGenerator<TripleClass>} - Triples
	 */
	public async *getTriples(this: ProcessClass) {
		return yield* getTriples(this);
	}

	/**
	 * Get triples as a stream of JSON strings
	 * @param includeCreatedAt - Whether to include createdAt timestamp
	 * @returns {AsyncGenerator<string>} - JSON strings of triples
	 */
	public async *getTriplesJson(
		this: ProcessClass,
		includeCreatedAt: boolean = false
	): AsyncGenerator<string> {
		return yield* getTriplesJson(this, includeCreatedAt);
	}

	public async *getDomainsJson(this: ProcessClass) {
		return yield* getDomainsJson(this);
	}

	public async *getResourcesJson(this: ProcessClass) {
		return yield* getResourcesJson(this);
	}

	public async getPathsForRobotsChecking(pathType: PathType, skip = 0, limit = 20) {
		return getPathsForRobotsChecking(this, pathType, skip, limit);
	}

	public async getPathsForDomainCrawl(pathType: PathType, domainBlacklist: string[] = [], skip = 0, limit = 20): Promise<TraversalPathDocument[]> {
		return getPathsForDomainCrawl(this, pathType, domainBlacklist, skip, limit);
	}

	public async hasPathsDomainRobotsChecking(): Promise<boolean> {
		return hasPathsDomainRobotsChecking(this);
	}

	public async hasPathsHeadBeingCrawled(): Promise<boolean> {
		return hasPathsHeadBeingCrawled(this);
	}

	public async extendExistingPaths() {
		log.info(`Extending existing paths for process ${this.pid}`);

		const procTripleCount = await ProcessTriple.countDocuments({ processId: this.pid });

		try {
			await extendExistingPaths(this.pid);
			const newPTC = await ProcessTriple.countDocuments({ processId: this.pid });
			log.info(
				`Extended existing paths for process ${this.pid}. ` +
				`ProcessTriples before: ${procTripleCount}, after: ${newPTC}, added: ${newPTC - procTripleCount}`
			);
		} catch (error) {
			log.error(`Error updating process ${this.pid} status to 'extending':`, error);
			throw error;
		}
	}

	public async extendProcessPaths(headUrl: string, pathType: PathType) {
		return extendProcessPaths(this, headUrl, pathType);
	}

	/**
	 * Get predicates branching factor and seed position ratio for the current step as a map
	 * @returns {Map<string, {bf: number, spr: number}> | undefined} - map of predicate URL to branching factor and seeds position ratio
	 */
	public curPredsDirMetrics(
		this: ProcessClass
	): Map<string, { bf: BranchFactorClass; spr: SeedPosRatioClass }> | undefined {
		return curPredsDirMetrics(this);
	}

	public async getResourceCount(this: ProcessClass) {
		return getResourceCount(this);
	}

	public async *getAllResources(this: ProcessClass) {
		return yield* getAllResources(this);
	}

	public async *getAllDomains(this: ProcessClass) {
		return yield* getAllDomains(this);
	}

	public async getInfo(this: DocumentType<ProcessClass>) {
		return getInfo(this);
	}


	// TODO configurable number of simultaneous processes
	public static async startNext(this: ReturnModelType<typeof ProcessClass>) {
		// if there is already a running process, do not start a new one
		const runningProcs = await this.countDocuments({ status: 'running' });
		if (runningProcs > 0) {
			log.info('There are already running processes, not starting a new one');
			return false;
		}

		log.info('No running processes, starting next queued process');
		const process = await this.findOneAndUpdate(
			{ status: 'queued' },
			{ $set: { status: 'extending' } },
			{ new: true }
		);

		// if no process found, return
		if (!process) {
			log.info('No queued processes to start');
			return false;
		}

		const pid = process.pid;

		// Before queuing, reset errored states if needed
		if (process.currentStep.resetErrors) {
			log.info(`Resetting errored states for process ${pid}`);
			const res = await process.resetErroredStates();
			log.debug(`Reset errored states for process ${pid}: ${res}`);
		}

		// Before queuing, extend existing paths according to new step limits
		await process.extendExistingPaths();

		// Set the process to queued
		await Process.updateOne(
			{ pid, status: 'extending' },
			{
				$set: {
					status: 'running'
				}
			}
		);
		log.info(`Queued process ${pid} for next step`);
		log.info(`Process ${process.pid} is starting with seeds:`, process.currentStep.seeds);
		await Resource.insertSeeds(process.currentStep.seeds, process.pid);
		await process.notifyStart();
		return true;
	}

	/**
	 * Get a running process, most recent first
	 * @param skip - number of processes to skip
	 * @memberof ProcessClass
	 */
	public static async getOneRunning(this: ReturnModelType<typeof ProcessClass>, skip = 0) {
		return this.findOne({ status: 'running' }).sort({ createdAt: -1 }).skip(skip);
	}

	/**
	 * Mark the process as done and notify
	 */
	public async done() {
		if (this.status === 'done') {
			log.warn(`Process ${this.pid} is already marked as done`);
			return;
		}
		this.status = 'done';
		// save to DB
		await this.save();

		await this.notifyStepFinished();
	}

	/**
	 * Notify that a step has started
	 */
	public async notifyStepStarted() {
		return notifyStepStarted(this);
	}

	/**
	 * Notify that the process has been created
	 */
	public async notifyProcessCreated() {
		return notifyProcessCreated(this);
	}

	/**
	 * Notify that a step has finished
	 */
	public async notifyStepFinished() {
		return notifyStepFinished(this);
	}

	/**
	 * Notify that the process has started
	 */
	public async notifyStart() {
		return notifyStart(this);
	}


	/**
		 * Reset resources, domains and paths that are stuck in an error state for this process so they can be crawled again.
		 * Processes entities in batches to avoid large in-memory sets.
		 * @param batchSize - Number of paths to process per batch (default: 1000)
		 * @return Summary of reset entities
		 */
	public async resetErroredStates(this: ProcessClass, batchSize = 1000) {
		log.warn(`Resetting errored resources, domains and paths for process ${this.pid}`);

		let summary = {
			resources: 0,
			domains: 0,
			paths: 0
		};
		let skip = 0;
		let hasMore = true;

		const PathClass = config.manager.pathType === 'traversal' ? TraversalPath : EndpointPath;
		while (hasMore) {
			// Fetch a batch of paths for this process
			const paths = config.manager.pathType === 'traversal' ?
				await TraversalPath.find({ processId: this.pid, status: 'active' })
					.skip(skip)
					.limit(batchSize)
					.select('head.url head.domain.origin')
					.lean() :
				await EndpointPath.find({ processId: this.pid, status: 'active' })
					.skip(skip)
					.limit(batchSize)
					.select('head.url head.domain.origin')
					.lean();

			if (paths.length === 0) {
				hasMore = false;
				continue;
			}

			const headUrls = new Set(paths.map(p => p.head.url));
			const origins = new Set(paths.map(p => p.head.domain.origin));

			const pathQuery = { processId: this.pid, status: 'active', 'head.status': 'error', 'head.url': { $in: Array.from(headUrls) } };
			const pathUpdate = { $set: { 'head.status': 'unvisited', 'head.domain.status': 'ready' } };
			const [resourceRes, domainRes, pathRes] = await Promise.all([
				Resource.updateMany(
					{ status: 'error', url: { $in: Array.from(headUrls) } },
					{
						$set: { status: 'unvisited' },
						$unset: { jobId: '', crawlId: '' }
					}
				),
				Domain.updateMany(
					{ status: 'error', origin: { $in: Array.from(origins) } },
					{
						$set: {
							status: 'ready',
							error: false,
							'crawl.ongoing': 0,
						},
						$unset: { workerId: '', jobId: '' }
					}
				),
				config.manager.pathType === 'traversal' ?
					TraversalPath.updateMany(pathQuery, pathUpdate) :
					EndpointPath.updateMany(pathQuery, pathUpdate)
			]);

			summary.resources += resourceRes.modifiedCount ?? resourceRes.matchedCount ?? 0;
			summary.domains += domainRes.modifiedCount ?? domainRes.matchedCount ?? 0;
			summary.paths += pathRes.modifiedCount ?? pathRes.matchedCount ?? 0;

			skip += paths.length;
			log.debug(`Reset error state in paths batch ${Math.ceil(skip / batchSize)}: ${paths.length} paths, ${skip} total`);
		}

		log.info(`Errored entities reset for process ${this.pid}`, summary);
		return summary;
	}
}


const Process = getModelForClass(ProcessClass, {
	schemaOptions: { timestamps: true, collection: 'processes' }
});

type ProcessDocument = ProcessClass & Document;

export { Process, ProcessClass, type ProcessDocument };
