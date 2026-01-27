import { Types, Document } from 'mongoose';
import { Resource } from './Resource';
import { Triple, TripleClass } from './Triple';
import { humanize } from 'humanize-digest';
import { Path, type PathSkeleton, type PathDocument } from './Path';
import { ProcessTriple } from './ProcessTriple';
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
import { Domain } from './Domain';
import {
	getPathsForRobotsChecking,
	getPathsForDomainCrawl,
	hasPathsDomainRobotsChecking,
	hasPathsHeadBeingCrawled,
	extendPathsWithExistingTriples,
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

export class BranchFactorClass {
	@prop({ type: Number })
	public subj!: number;

	@prop({ type: Number })
	public obj!: number;
}

export class SeedPosRatioClass {
	@prop({ type: Number })
	public subj!: number;

	@prop({ type: Number })
	public obj!: number;
}

export class PredDirMetrics {
	@prop({ type: String })
	public url!: string;

	@prop({ type: BranchFactorClass })
	public branchFactor?: BranchFactorClass;

	@prop({ type: SeedPosRatioClass })
	public seedPosRatio?: SeedPosRatioClass;
}

export class NotificationClass {
	_id?: Types.ObjectId | string;

	@prop({ type: String })
	public email?: string;

	@prop({ type: String })
	public webhook?: string;

	@prop({ type: String })
	public ssePath?: string;
}

export class PredicateLimitationClass {
	_id?: Types.ObjectId | string;

	@prop({
		enum: ['whitelist', 'blacklist'],
		default: 'blacklist',
		required: true,
		type: String
	})
	public limType!: 'whitelist' | 'blacklist';

	@prop({ required: true, type: [String] }, PropType.ARRAY)
	public limPredicates!: string[];
}

/**
 * Class representing a crawling step in a process
 */
export class StepClass {
	_id?: Types.ObjectId | string;

	/**
	 * Seed URLs to start crawling from
	 */
	@prop({ required: true, type: String }, PropType.ARRAY)
	public seeds!: string[];

	/**
	 * Maximum path length to follow
	 */
	@prop({ default: 2, required: true, type: Number })
	public maxPathLength!: number;

	/**
	 * Maximum number of properties in a path
	 */
	@prop({ default: 1, required: true, type: Number })
	public maxPathProps!: number;

	/**
	 * Predicate limitation (whitelist/blacklist) for this step
	 */
	@prop({ required: true, type: PredicateLimitationClass })
	public predLimit!: PredicateLimitationClass;

	/**
	 * Direction metrics of last step's predicates
	 */
	@prop({ type: [PredDirMetrics] }, PropType.ARRAY)
	public predsDirMetrics?: PredDirMetrics[];

	/**
	 * Whether to crawl taking into account predicates direction metrics
	 */
	@prop({ type: Boolean, default: false, required: true })
	public followDirection: boolean = false;

	/**
	 * Whether to reset error statuses of resources, domains, and paths at the start of this step
	 */
	@prop({ type: Boolean, default: false, required: true })
	public resetErrors: boolean = false;
}

@index({ status: 1 })
@index({ createdAt: 1 })
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

	public async isDone(this: ProcessClass) {
		// process is done
		if (['done', 'error'].includes(this.status)) {
			return true;
		}

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

	public async *getTriples(this: ProcessClass) {
		const procTriples = ProcessTriple.find({
			processId: this.pid
		}).populate('triple');
		for await (const procTriple of procTriples) {
			const triple = procTriple.triple;
			yield {
				subject: triple.subject,
				predicate: triple.predicate,
				object: triple.object,
				createdAt: (procTriple as any).createdAt
			};
		}
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
		for await (const t of this.getTriples()) {
			const obj = includeCreatedAt
				? t
				: { subject: t.subject, predicate: t.predicate, object: t.object };
			yield JSON.stringify(obj);
		}
	}

	public async *getDomainsJson(this: ProcessClass) {
		for await (const d of this.getAllDomains()) {
			console.log('XXXXXXXXXXXX', d);
			yield JSON.stringify(d.origin);
		}
	}

	public async *getResourcesJson(this: ProcessClass) {
		for await (const r of this.getAllResources()) {
			yield JSON.stringify(r._id);
		}
	}

	public async getPathsForRobotsChecking(skip = 0, limit = 20) {
		return getPathsForRobotsChecking(this, skip, limit);
	}

	public async getPathsForDomainCrawl(domainBlacklist: string[] = [], skip = 0, limit = 20): Promise<PathDocument[]> {
		return getPathsForDomainCrawl(this, domainBlacklist, skip, limit);
	}

	public async hasPathsDomainRobotsChecking(): Promise<boolean> {
		return hasPathsDomainRobotsChecking(this);
	}

	public async hasPathsHeadBeingCrawled(): Promise<boolean> {
		return hasPathsHeadBeingCrawled(this);
	}

	public async extendPathsWithExistingTriples(paths: PathDocument[]) {
		return extendPathsWithExistingTriples(this, paths);
	}

	public async extendExistingPaths() {
		return extendExistingPaths(this);
	}

	public async extendProcessPaths(triplesByNode: { [headUrl: string]: TripleClass[] }) {
		return extendProcessPaths(this, triplesByNode);
	}

	/**
	 * Get predicates branching factor and seed position ratio for the current step as a map
	 * @returns {Map<string, {bf: number, spr: number}> | undefined} - map of predicate URL to branching factor and seeds position ratio
	 */
	public curPredsDirMetrics(
		this: ProcessClass
	): Map<string, { bf: BranchFactorClass; spr: SeedPosRatioClass }> | undefined {
		return this.currentStep.predsDirMetrics?.reduce((map, obj) => {
			if (!obj.branchFactor || !obj.seedPosRatio) {
				return map;
			}
			map.set(obj.url, {
				// TODO should this return decomposed metrics instead of ratio?
				bf: obj.branchFactor,
				spr: obj.seedPosRatio
			});
			return map;
		}, new Map<string, { bf: BranchFactorClass; spr: SeedPosRatioClass }>());
	}

	public async getResourceCount(this: ProcessClass) {
		const res = await ProcessTriple.aggregate(
			[
				{
					$match: {
						processId: this.pid
					}
				},
				{ $group: { _id: '$triple' } },
				{
					$lookup: {
						from: 'triples',
						localField: '_id',
						foreignField: '_id',
						as: 'ts'
					}
				},
				{
					$unwind: {
						path: '$ts',
						preserveNullAndEmptyArrays: true
					}
				},
				{ $project: { sources: '$ts.sources' } },
				{
					$unwind: {
						path: '$sources',
						preserveNullAndEmptyArrays: true
					}
				},
				{ $group: { _id: '$sources' } },
				{ $count: 'count' }
			],
			{ maxTimeMS: 60000, allowDiskUse: true }
		);
		return res.length > 0 ? res[0].count : 0;
	}

	public async *getAllResources(this: ProcessClass) {
		const res = ProcessTriple.aggregate(
			[
				// get all process triples matching this process
				{
					$match: {
						processId: this.pid
					}
				},
				// group by triple to avoid duplicates
				{ $group: { _id: '$triple' } },
				// get actual triples
				{
					$lookup: {
						from: 'triples',
						localField: '_id',
						foreignField: '_id',
						as: 'ts'
					}
				},
				// flatten array
				{
					$unwind: {
						path: '$ts',
						preserveNullAndEmptyArrays: true
					}
				},
				// get sources (resources) from triples
				{ $project: { sources: '$ts.sources' } },
				// flatten sources array
				{
					$unwind: {
						path: '$sources',
						preserveNullAndEmptyArrays: true
					}
				},
				// group by source to avoid duplicates
				{ $group: { _id: '$sources' } }
			],
			{ maxTimeMS: 60000, allowDiskUse: true }
		).cursor({ batchSize: 100 });
		for await (const r of res) {
			yield r;
		}
	}

	public async *getAllDomains(this: ProcessClass) {
		const res = ProcessTriple.aggregate(
			[
				{
					$match: {
						processId: this.pid
					}
				},
				{
					$group: {
						_id: '$triple'
					}
				},
				{
					$lookup: {
						from: 'triples',
						localField: '_id',
						foreignField: '_id',
						as: 'ts'
					}
				},
				{
					$unwind: {
						path: '$ts',
						preserveNullAndEmptyArrays: true
					}
				},
				{
					$project: {
						sources: '$ts.sources'
					}
				},
				{
					$unwind: {
						path: '$sources',
						preserveNullAndEmptyArrays: true
					}
				},
				{
					$group: {
						_id: '$sources'
					}
				},
				{
					$lookup: {
						from: 'resources',
						localField: '_id',
						foreignField: 'url',
						as: 'rs'
					}
				},
				{
					$unwind: {
						path: '$rs',
						preserveNullAndEmptyArrays: true
					}
				},
				{
					$group: {
						_id: '$rs.url',
						domain: {
							$first: '$rs.domain'
						}
					}
				},
				{
					$lookup: {
						from: 'domains',
						localField: 'domain',
						foreignField: 'origin',
						as: 'ds'
					}
				},
				{
					$unwind: {
						path: '$ds',
						preserveNullAndEmptyArrays: true
					}
				},
				{
					$group: {
						_id: '$ds._id',
						origin: {
							$first: '$ds.origin'
						}
					}
				}
			],
			{ maxTimeMS: 60000, allowDiskUse: true }
		).cursor({ batchSize: 100 });
		for await (const d of res) {
			yield d;
		}
	}

	public async getInfo(this: DocumentType<ProcessClass>) {
		const baseFilter = { processId: this.pid };
		const lastResource = await Resource.findOne().sort({ updatedAt: -1 }); // TODO these should be process specific
		const lastTriple = await Triple.findOne().sort({ updatedAt: -1 });
		const lastPath = await Path.findOne({ status: 'active' }).sort({ updatedAt: -1 });
		const last = Math.max(
			lastResource?.updatedAt.getTime() || 0,
			lastTriple?.updatedAt.getTime() || 0,
			lastPath?.updatedAt.getTime() || 0
		);

		const totalPaths = await Path.countDocuments({
			'seed.url': { $in: this.currentStep.seeds },
			status: 'active'
		}).lean();
		const avgPathLength = totalPaths
			? await Path.aggregate([
				{ $match: { 'seed.url': { $in: this.currentStep.seeds }, status: 'active' } },
				{ $group: { _id: null, avgLength: { $avg: '$nodes.count' } } }
			]).then((res) => res[0]?.avgLength || 0)
			: 0;

		const avgPathProps = totalPaths
			? await Path.aggregate([
				{ $match: { 'seed.url': { $in: this.currentStep.seeds }, status: 'active' } },
				{ $group: { _id: null, avgProps: { $avg: '$predicates.count' } } }
			]).then((res) => res[0]?.avgProps || 0)
			: 0;

		const timeToLastResource = lastResource
			? (lastResource!.updatedAt.getTime() - this.createdAt!.getTime()) / 1000
			: null;
		const timeRunning = last ? (last - this.createdAt!.getTime()) / 1000 : null;

		return {
			resources: {
				total: await this.getResourceCount(),
				done: await Resource.countDocuments({
					...baseFilter,
					status: 'done'
				}).lean(), // TODO add index
				crawling: await Resource.countDocuments({
					...baseFilter,
					status: 'crawling'
				}).lean(), // TODO add index
				error: await Resource.countDocuments({
					...baseFilter,
					status: 'error'
				}).lean() // TODO add index
				//seed: await Resource.countDocuments({
				//  ...baseFilter,
				//  isSeed: true,
				//}).lean(), // TODO add index
			},
			triples: {
				total: await ProcessTriple.countDocuments(baseFilter).lean()
			},
			domains: {
				total: (await Array.fromAsync(this.getAllDomains())).length
				//beingCrawled: (
				//  await Domain.find({ ...baseFilter, status: 'crawling' })
				//    .select('origin')
				//    .lean()
				//).map((d) => d.origin),
				//ready: await Domain.countDocuments({
				//  ...baseFilter,
				//  status: 'ready'
				//}).lean(), // TODO add index
				//crawling: await Domain.countDocuments({
				//  ...baseFilter,
				//  status: 'crawling'
				//}).lean(), // TODO add index
				//error: await Domain.countDocuments({
				//  ...baseFilter,
				//  status: 'error'
				//}).lean() // TODO add index
			},
			paths: {
				total: await Path.countDocuments({
					'seed.url': { $in: this.currentStep.seeds },
				}).lean(),
				deleted: await Path.countDocuments({
					'seed.url': { $in: this.currentStep.seeds },
					status: 'deleted'
				}).lean(), // TODO add index
				active: await Path.countDocuments({
					'seed.url': { $in: this.currentStep.seeds },
					status: 'active'
				}).lean(), // TODO add index
				avgPathLength,
				avgPathProps
			},
			createdAt: this.createdAt,
			timeToLastResource: timeToLastResource || '',
			timeRunning: timeRunning || '',
			currentStep: this.currentStep,
			steps: this.steps,
			notification: this.notification,
			status: this.status
		};
	}

	// TODO configurable number of simultaneous processes
	public static async startNext(this: ReturnModelType<typeof ProcessClass>) {
		const runningProcs = await this.countDocuments({ status: 'running' });

		if (!runningProcs) {
			log.info('No running processes, starting next queued process');
			const process = await this.findOneAndUpdate(
				{ status: 'queued' },
				{ $set: { status: 'running' } },
				{ new: true }
			);

			if (process) {
				log.info(`Process ${process.pid} is starting with seeds:`, process.currentStep.seeds);
				await Resource.insertSeeds(process.currentStep.seeds, process.pid);
				await process.notifyStart();
				return true;
			}
			log.info('No queued processes to start');
			return false;
		}
		log.info('There are already running processes, not starting a new one');
		return false;
	}

	/**
	 * Get a running process, most recent first
	 * @param skip - number of processes to skip
	 * @memberof ProcessClass
	 */
	public static async getOneRunning(this: ReturnModelType<typeof ProcessClass>, skip = 0) {
		return this.findOne({ status: 'running' }).sort({ createdAt: -1 }).skip(skip);
	}

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

	public async notifyStepStarted() {
		return notifyStepStarted(this);
	}

	public async notifyProcessCreated() {
		return notifyProcessCreated(this);
	}
	public async notifyStepFinished() {
		return notifyStepFinished(this);
	}

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

		while (hasMore) {
			// Fetch a batch of paths for this process
			const paths = await Path.find({ processId: this.pid, status: 'active' })
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
				Path.updateMany(
					{ processId: this.pid, status: 'active', 'head.status': 'error', 'head.url': { $in: Array.from(headUrls) } },
					{
						$set: {
							'head.status': 'unvisited',
							'head.domain.status': 'ready'
						}
					}
				)
			]);

			summary.resources += resourceRes.modifiedCount ?? resourceRes.matchedCount ?? 0;
			summary.domains += domainRes.modifiedCount ?? domainRes.matchedCount ?? 0;
			summary.paths += pathRes.modifiedCount ?? pathRes.matchedCount ?? 0;

			skip += paths.length;
			log.debug(`Processed batch ${Math.ceil(skip / batchSize)}: ${paths.length} paths, ${skip} total`);
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
