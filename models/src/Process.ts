import { Types, Document } from 'mongoose';
import { Resource } from './Resource';
import { Triple, TripleClass } from './Triple';
import { humanize } from 'humanize-digest';
import { Path, type PathSkeleton, type PathDocument } from './Path';
import { ProcessTriple } from './ProcessTriple';
import { createLogger } from '@derzis/common/server';
import { webhookPost } from '@derzis/common/server';
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
import { sendEmail } from '@derzis/common/server';

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

	@prop({
		enum: ['queued', 'running', 'done', 'error'],
		default: 'queued',
		type: String
	})
	public status!: 'queued' | 'running' | 'done' | 'error';

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

		const pathsToCrawl = await this.getPathsForDomainCrawl(0, 1);
		const pathsToCheck = await this.getPathsForRobotsChecking(0, 1);
		const hasPathsChecking = await this.hasPathsDomainRobotsChecking();
		const hasPathsCrawling = await this.hasPathsHeadBeingCrawled();

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
		const paths = await Path.find({
			processId: this.pid,
			'head.domain.status': 'unvisited',
			'nodes.count': { $lt: this.currentStep.maxPathLength },
			'predicates.count': { $lte: this.currentStep.maxPathProps }
		})
			// shorter paths first
			.sort({ 'nodes.count': 1 })
			.limit(limit)
			.skip(skip)
			.select('head.domain head.url')
			.lean();
		return paths;
	}

	/**
	 * Check if process can follow path according to white/black lists
	 * @param path - path to check
	 * @returns {Promise<boolean>} - true if can follow path
	 */
	// DISABLED because it is already checked in getPathsForDomainCrawl
	//public canFollowPath(path: PathDocument): boolean {
	//  // no white/black lists
	//  if (!this.currentStep.predLimit) {
	//    return true;
	//  }
	//  // check all predicates in path againt the current step's white/black lists
	//  for (const pred of path.predicates.elems) {
	//    if (this.currentStep.predLimit.limType === 'whitelist') {
	//      if (!matchesOne(pred, this.currentStep.predLimit.limPredicates)) {
	//        log.debug(`Path ${path._id} cannot be followed because predicate ${pred} is not in whitelist`);
	//        return false;
	//      }
	//    } else {
	//      // blacklist
	//      if (matchesOne(pred, this.currentStep.predLimit.limPredicates)) {
	//        log.debug(`Path ${path._id} cannot be followed because predicate ${pred} is in blacklist`);
	//        return false;
	//      }
	//    }
	//  }
	//  // Already checked in getPathsForDomainCrawl
	//  // // check predicate count and path length
	//  // if (
	//  //   path.predicates.count > this.currentStep.maxPathProps ||
	//  //   path.nodes.count > this.currentStep.maxPathLength
	//  // ) {
	//  //   log.debug(`Path ${path._id} cannot be followed because it exceeds limits`);
	//  //   return false;
	//  // }
	//  return true;
	//}

	/**
	 * Get paths that are ready to be crawled
	 * @param skip - number of paths to skip
	 * @param limit - number of paths to return
	 * @returns {Promise<PathDocument[]>} - paths
	 * @memberof ProcessClass
	 */
	public async getPathsForDomainCrawl(domainBlacklist: string[] = [], skip = 0, limit = 20): Promise<PathDocument[]> {
		const predLimFilter =
			this.currentStep.predLimit.limType === 'whitelist'
				? { 'predicates.elems': { $in: this.currentStep.predLimit.limPredicates } }
				: { 'predicates.elems': { $nin: this.currentStep.predLimit.limPredicates } };
		const paths = await Path.find({
			processId: this.pid,
			'head.domain.status': 'ready',
			'head.domain.origin': domainBlacklist.length ? { $nin: domainBlacklist } : { $exists: true },
			'head.status': 'unvisited',
			'nodes.count': { $lt: this.currentStep.maxPathLength },
			'predicates.count': { $lte: this.currentStep.maxPathProps },
			...predLimFilter
		})
			// shorter paths first
			.sort({ 'nodes.count': 1 })
			.limit(limit)
			.skip(skip)
			.select('head.domain head.url head.status nodes.elems predicates.elems');
		return paths;
	}

	/**
	 * Check if process has paths whose head's domain is currently being robots-checked
	 * @returns {Promise<boolean>} - true if there are paths
	 * @memberof ProcessClass
	 */
	public async hasPathsDomainRobotsChecking(): Promise<boolean> {
		const paths = await Path.find({
			processId: this.pid,
			'head.domain.status': 'checking'
		});
		return !!paths.length;
	}

	/**
	 * Check if process has paths whose head's url is currently being crawled
	 * @returns {Promise<boolean>} - true if there are paths
	 * @memberof ProcessClass
	 */
	public async hasPathsHeadBeingCrawled(): Promise<boolean> {
		const paths = await Path.find({
			processId: this.pid,
			'head.status': 'crawling'
		});
		return !!paths.length;
	}

	/**
	 * Recursively extend paths with existing triples
	 * @param paths - paths to extend
	 */
	public async extendPathsWithExistingTriples(paths: PathDocument[]) {
		for (const path of paths) {
			const newPathObjs = [];
			const toDelete = new Set();
			const procTriples = new Set();

			const { newPaths: nps, procTriples: pts } = await path.extendWithExistingTriples(this);

			// if new paths were created
			if (nps.length) {
				toDelete.add(path._id);
				newPathObjs.push(...nps);
				for (const pt of pts) {
					procTriples.add(pt);
				}

				// create new paths
				const newPaths = await Path.create(newPathObjs);

				// delete old paths
				await Path.deleteMany({ _id: { $in: Array.from(toDelete) } });

				await this.extendPathsWithExistingTriples(newPaths);
			}
		}
	}

	public async extendProcessPaths(triplesByNode: { [headUrl: string]: TripleClass[] }) {
		const newHeads = Object.keys(triplesByNode);
		log.silly('New heads:', newHeads);
		const paths = await Path.find({
			processId: this.pid,
			'head.url': newHeads.length === 1 ? newHeads[0] : { $in: Object.keys(triplesByNode) }
		});
		log.silly('Paths:', paths);

		const pathsToDelete = new Set();
		const newPathObjs = [];
		const toDelete = new Set();
		const procTriples = new Set();

		for (const path of paths) {
			const { newPaths: nps, procTriples: pts } = await path.extend(
				triplesByNode[path.head.url],
				this
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
		await ProcessTriple.insertMany(
			[...procTriples].map((tId) => ({
				processId: this.pid,
				triple: tId,
				processStep: this.steps.length
			}))
		);

		// create new paths
		const newPaths = await Path.create(newPathObjs);

		// delete old paths
		await Path.deleteMany({ _id: { $in: Array.from(toDelete) } });

		// add existing heads
		await this.extendPathsWithExistingTriples(newPaths);
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

	public async updateLimits(this: ProcessClass) {
		const paths = Path.find({
			processId: this.pid,
			outOfBounds: { $exists: true }
		});

		for await (const path of paths) {
			const { newPaths, procTriples } = await path.extendWithExistingTriples(this);
			await ProcessTriple.insertMany(
				[...procTriples].map((tId) => ({
					processId: this.pid,
					triple: tId,
					processStep: this.steps.length
				}))
			);
			await Path.create(newPaths);
		}
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
		const lastPath = await Path.findOne().sort({ updatedAt: -1 });
		const last = Math.max(
			lastResource?.updatedAt.getTime() || 0,
			lastTriple?.updatedAt.getTime() || 0,
			lastPath?.updatedAt.getTime() || 0
		);

		const totalPaths = await Path.countDocuments({
			'seed.url': { $in: this.currentStep.seeds }
		}).lean();
		const avgPathLength = totalPaths
			? await Path.aggregate([
				{ $match: { 'seed.url': { $in: this.currentStep.seeds } } },
				{ $group: { _id: null, avgLength: { $avg: '$nodes.count' } } }
			]).then((res) => res[0]?.avgLength || 0)
			: 0;

		const avgPathProps = totalPaths
			? await Path.aggregate([
				{ $match: { 'seed.url': { $in: this.currentStep.seeds } } },
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
					'seed.url': { $in: this.currentStep.seeds }
				}).lean(),
				finished: await Path.countDocuments({
					'seed.url': { $in: this.currentStep.seeds },
					status: 'finished'
				}).lean(), // TODO add index
				disabled: await Path.countDocuments({
					'seed.url': { $in: this.currentStep.seeds },
					status: 'disabled'
				}).lean(), // TODO add index
				active: await Path.countDocuments({
					'seed.url': { $in: this.currentStep.seeds },
					status: 'active'
				}).lean(), // TODO add index
				avgPathLength,
				avgPathProps
			},
			// TODO remove allPaths
			allPaths: {
				total: await Path.countDocuments().lean(),
				finished: await Path.countDocuments({ status: 'finished' }).lean(), // TODO add index
				disabled: await Path.countDocuments({ status: 'disabled' }).lean(), // TODO add index
				active: await Path.countDocuments({ status: 'active' }).lean() // TODO add index
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
		const notif = {
			ok: true,
			data: {
				pid: this.pid,
				messageType: 'OK_STEP_STARTED',
				message: `Process ${this.pid} just started step #${this.steps.length}.`,
				details: this.currentStep
			} as StepStartedNotification
		};

		log.info(
			`Notifying starting next step on project ${this.pid}`,
			this.notification.email ?? '',
			this.notification.webhook ?? ''
		);

		if (this.notification.email) {
			await notifyEmail(this.notification.email, notif);
		}
		if (this.notification.webhook) {
			await notifyWebhook(this.notification.webhook, notif);
		}
	}

	public async notifyProcessCreated() {
		const notif = {
			ok: true,
			data: {
				pid: this.pid,
				messageType: 'OK_PROC_CREATED',
				message: `Process ${this.pid} has been created.`,
				details: {
					pid: this.pid,
					notification: this.notification,
					steps: this.steps,
					currentStep: this.currentStep,
					status: this.status
				}
			} as ProcCreatedNotification
		};

		log.info(
			`Notifying creation of project ${this.pid}`,
			this.notification.email ?? '',
			this.notification.webhook ?? ''
		);

		if (this.notification.email) {
			await notifyEmail(this.notification.email, notif);
		}
		if (this.notification.webhook) {
			await notifyWebhook(this.notification.webhook, notif);
		}
	}
	public async notifyStepFinished() {
		const notif = {
			ok: true,
			data: {
				pid: this.pid,
				messageType: 'OK_STEP_FINISHED',
				message: `Process ${this.pid} just finished step #${this.steps.length}.`,
				details: this.currentStep
			} as StepFinishedNotification
		};

		log.info(
			`Notifying step finished on project ${this.pid}`,
			this.notification.email ?? '',
			this.notification.webhook ?? ''
		);
		log.info('Notification details: ' + JSON.stringify(notif, null, 2));

		if (this.notification.email) {
			await notifyEmail(this.notification.email, notif);
		}
		if (this.notification.webhook) {
			await notifyWebhook(this.notification.webhook, notif);
		}
	}

	public async notifyStart() {
		const notif = {
			ok: true,
			data: {
				pid: this.pid,
				messageType: 'OK_STEP_STARTED',
				message: `Step ${this.steps.length} of ${this.pid} has started.`,
				details: this.currentStep
			} as ProcStartNotification
		};

		log.info(
			`Notifying starting project ${this.pid}`,
			this.notification.email ?? '',
			this.notification.webhook ?? ''
		);

		if (this.notification.email) {
			try {
				await notifyEmail(this.notification.email, notif);
			} catch (e) {
				log.error('Error sending email notification', e);
			}
		}
		if (this.notification.webhook) {
			await notifyWebhook(this.notification.webhook, notif);
		}
	}
}

const notifyEmail = async (email: string, notif: ProcessNotification) => {
	try {
		const res = await sendEmail({
			to: email,
			from: 'derzis@andrefs.com',
			text: notif.data.message,
			html: `<p>${notif.data.message}</p>`,
			subject: 'Derzis - Event'
		});
		return res;
	} catch (e) {
		log.error('Error sending email notification', e);
	}
};
const notifyWebhook = async (webhook: string, notif: ProcessNotification) => {
	let retries = 0;
	while (retries < 3) {
		try {
			const res = webhookPost(webhook, notif);
			return res;
		} catch (e) {
			retries++;
			if (retries === 3) {
				log.error('Error sending webhook notification', e);
			}
		}
	}
};

interface BaseProcNotification {
	pid: string;
	messageType: string;
	message: string;
	details: any;
}

type ProcCreatedNotification = BaseProcNotification & {
	messageType: 'OK_PROC_CREATED';
	message: string;
};
type ProcStartNotification = BaseProcNotification & {
	messageType: 'OK_PROC_STARTED';
	message: string;
};

type StepFinishedNotification = BaseProcNotification & {
	details: StepClass;
	messageType: 'OK_STEP_FINISHED';
};

type StepStartedNotification = BaseProcNotification & {
	details: StepClass;
	messageType: 'OK_STEP_STARTED';
};

type ProcessNotification = {
	ok: boolean;
	data:
	| StepStartedNotification
	| StepFinishedNotification
	| ProcStartNotification
	| ProcCreatedNotification;
};

const matchesOne = (str: string, patterns: string[]) => {
	let matched = false;
	for (const p of patterns) {
		// pattern is a regex
		if (/^\/(.*)\/$/.test(p)) {
			const re = new RegExp(p);
			if (re.test(str)) {
				matched = true;
				break;
			}
			continue;
		}
		// pattern is a URL prefix
		try {
			const url = new URL(p);
			if (str.startsWith(p)) {
				matched = true;
				break;
			}
		} catch (e) {
			continue;
		}
		// pattern is a string
		if (str.includes(p)) {
			matched = true;
			break;
		}
	}
	return matched;
};

async function updateNewPathHeadStatus(newPaths: PathSkeleton[]): Promise<void> {
	const headUrls = newPaths.map((p) => p.head.url);
	const resources = await Resource.find({ url: { $in: headUrls } })
		.select('url status')
		.lean();
	const resourceMap: { [url: string]: 'unvisited' | 'done' | 'crawling' | 'error' } = {};
	resources.forEach((r) => (resourceMap[r.url] = r.status));
	newPaths.forEach((p) => (p.head.status = resourceMap[p.head.url] || 'unvisited'));
}

const Process = getModelForClass(ProcessClass, {
	schemaOptions: { timestamps: true, collection: 'processes' }
});

type ProcessDocument = ProcessClass & Document;

export { Process, ProcessClass, type ProcessDocument };
