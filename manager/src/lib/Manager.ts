import robotsParser from 'robots-parser';
import config from '@derzis/config';
import { db } from '@derzis/models';
import {
	Domain,
	Triple,
	Path,
	Resource,
	Process,
	ResourceClass,
	TripleClass,
	PathClass
} from '@derzis/models';
import {
	createLogger,
	type JobResult,
	type RobotsCheckResult,
	type CrawlResourceResult
} from '@derzis/common';
const log = createLogger('Manager');
import RunningJobs from './RunningJobs';
import type { JobCapacity, JobRequest, ResourceCrawlJobRequest } from '@derzis/worker';
import { ObjectId } from 'bson';

export default class Manager {
	jobs: RunningJobs;
	finished: number;

	constructor() {
		this.jobs = new RunningJobs();
		this.finished = 0;
	}

	async connect() {
		log.info('Connecting to MongoDB');
		await db.connect();
	}

	async updateJobResults(jobResult: JobResult) {
		log.debug('updateJobResults', {
			finished: this.finished,
			jobs: this.jobs.toString(),
			beingSaved: this.jobs.beingSaved
		});
		this.finished = 0;
		if (!this.jobs.isJobRegistered(jobResult.origin)) {
			//log.error(`Something went wrong: cannot update job results for ${data.domain} (no such job registered)`);
			return;
		}
		if (jobResult.jobType === 'robotsCheck') {
			log.info(`Saving robots data (job #${jobResult.jobId}) for ${jobResult.origin}`);
			this.jobs.addToBeingSaved(jobResult.origin, jobResult.jobType);
			try {
				await this.saveRobots(jobResult);
			} catch (e) {
				// TODO handle errors
				log.error(`Error saving robots (job #${jobResult.jobId}) for ${jobResult.origin}`);
				log.info(jobResult);
			} finally {
				this.jobs.removeFromBeingSaved(jobResult.origin, jobResult.jobType);
				this.jobs.deregisterJob(jobResult.origin);
				log.debug(`Done saving robots data (job #${jobResult.jobId}) for ${jobResult.origin}`);
			}
		}
		if (jobResult.jobType === 'resourceCrawl') {
			log.info(
				`Saving resource crawl (job #${jobResult.jobId}) for domain ${jobResult.origin}: ${jobResult.url}`
			);
			if (this.jobs.postponeTimeout(jobResult.origin)) {
				this.jobs.addToBeingSaved(jobResult.origin, jobResult.jobType);
				try {
					await this.saveCrawl2(jobResult);
				} catch (e) {
					// TODO handle errors
					log.error(
						`Error saving resource crawl (job #${jobResult.jobId}) for ${jobResult.url}`,
						e
					);
					log.info('', jobResult);
				} finally {
					this.jobs.removeFromBeingSaved(jobResult.origin, jobResult.jobType);
					log.debug(
						`Done saving resource crawl (job #${jobResult.jobId}) for domain ${jobResult.origin}: ${jobResult.url}`
					);
					const res = await Domain.updateOne(
						{
							origin: jobResult.origin,
							jobId: jobResult.jobId,
							'crawl.ongoing': 0
						},
						{
							$set: { status: 'ready' },
							$unset: {
								workerId: '',
								jobId: ''
							}
						}
					);
					if (res.acknowledged && res.modifiedCount) {
						this.jobs.deregisterJob(jobResult.origin);
						log.debug(`Done saving domain crawl (job #${jobResult.jobId}) for ${jobResult.origin}`);
					}
				}
			}
		}
	}

	async saveCrawl2(jobResult: CrawlResourceResult) {
		if (jobResult.status === 'not_ok') {
			return await Resource.markAsCrawled(jobResult.url, jobResult.details, jobResult.err);
		}
		// mark head as crawled
		await Resource.markAsCrawled(jobResult.url, jobResult.details);

		// filter out triples which dont refer to head resource
		const triples = jobResult.details.triples
			.filter((t) => t.subject.termType === 'NamedNode')
			.filter((t) => t.object.termType === 'NamedNode')
			.filter((t) => t.object.value === jobResult.url || t.subject.value === jobResult.url)
			.map((t) => ({
				subject: t.subject.value,
				predicate: t.predicate.value,
				object: t.object.value
			}));

		if (triples.length) {
			const source = (await Resource.findOne({
				url: jobResult.url
			})) as ResourceClass;

			// add new resources
			await Resource.addFromTriples(triples);

			// add new triples
			const res = await Triple.upsertMany(source, triples);

			if (res.upsertedCount) {
				const tids = Object.values(res.upsertedIds).map((i) => new ObjectId(i));
				// filter out reflexive triples and triples not referring to head resource
				const tObjs: TripleClass[] = (await Triple.find({ _id: { $in: tids } })).filter(
					(t) => t.subject !== t.object && (t.subject == source.url || t.object == source.url)
				);

				// TODO convert to TripleDocument
				const triplesByNode: { [url: string]: TripleClass[] } = {};
				for (const t of tObjs) {
					const newHead = t.subject === source.url ? t.object : t.subject;
					if (!triplesByNode[source.url]) {
						triplesByNode[source.url] = [];
					}
					triplesByNode[source.url].push(t);
				}
				await this.updatePaths(source.url, triplesByNode);
			}
		}
	}

	async updatePaths(sourceUrl: string, triplesByNode: { [url: string]: TripleClass[] }) {
		const pids = await Path.distinct('processId', {
			'head.url': sourceUrl
		});
		for (const pid of pids) {
			const proc = await Process.findOne({ pid });
			await proc?.extendPaths(triplesByNode);
		}
	}

	shouldCreateNewPath(t: TripleClass, path: PathClass) {
		// triple is reflexive
		if (t.subject === t.object) {
			return false;
		}
		// triple is not connected to path
		if (t.subject !== path.head.url && t.object !== path.head.url) {
			return false;
		}

		const newHeadUrl: string = t.subject === path.head.url ? t.object : t.subject;
		const prop: string = t.predicate;

		// new head already contained in path
		if (path.nodes.elems.includes(newHeadUrl)) {
			return false;
		}
		// new predicate and path already has max preds
		if (
			!path.predicates.elems.includes(prop) &&
			path.predicates.count >= config.graph.maxPathProps
		) {
			return false;
		}
		// path already has max length
		if (path.nodes.count >= config.graph.maxPathLength) {
			return false;
		}
		return true;
	}

	async saveRobots(jobResult: RobotsCheckResult) {
		let crawlDelay = config.http.crawlDelay || 1;

		if (jobResult.status === 'ok') {
			const robots = robotsParser(jobResult.origin + '/robots.txt', jobResult.details.robotsText);
			crawlDelay = robots.getCrawlDelay(config.http.userAgent) || crawlDelay;
			return Domain.saveRobotsOk(jobResult, crawlDelay);
		} else {
			return Domain.saveRobotsError(jobResult, crawlDelay);
		}
	}

	async *assignJobs(
		workerId: string,
		workerAvail: JobCapacity
	): AsyncIterable<Exclude<JobRequest, ResourceCrawlJobRequest>> {
		if (this.jobs.beingSaved.count() > 2) {
			log.warn(
				`Too many jobs (${this.jobs.beingSaved.count()}) being saved, waiting for them to reduce before assigning new jobs`
			);
		}
		let assignedCheck = 0;
		let assignedCrawl = 0;
		if (workerAvail.robotsCheck.capacity) {
			log.debug(`Getting ${workerAvail.robotsCheck.capacity} robotsCheck jobs for ${workerId}`);
			for await (const check of Domain.domainsToCheck(workerId, workerAvail.robotsCheck.capacity)) {
				if (await this.jobs.registerJob(check.jobId, check.origin, 'robotsCheck')) {
					assignedCheck++;
					yield {
						type: 'robotsCheck',
						jobId: check.jobId,
						origin: check.origin
					};
				}
			}
		}
		if (workerAvail.domainCrawl) {
			log.debug(`Getting ${workerAvail.domainCrawl.capacity} domainCrawl jobs for ${workerId}`);
			//for await (const crawl of this.domainsToCrawl(
			for await (const crawl of Domain.domainsToCrawl2(
				workerId,
				workerAvail.domainCrawl.capacity,
				workerAvail.domainCrawl.resourcesPerDomain
			)) {
				if (
					crawl?.resources?.length &&
					(await this.jobs.registerJob(crawl.domain.jobId, crawl.domain.origin, 'domainCrawl'))
				) {
					assignedCrawl++;
					yield {
						type: 'domainCrawl',
						jobId: crawl.domain.jobId,
						...crawl
					};
				} else {
					log.info(`No resources to crawl from domain ${crawl.domain.origin}`);
				}
			}
		}
		if (!assignedCheck && !assignedCrawl && !this.jobs.count() && !this.jobs.beingSaved.count()) {
			log.info(
				'Could not find any domains to check or crawl and there are no outstanding jobs',
				this.jobs
			);
			this.finished++;
		}
		//FIXME
		if (this.finished > 5) {
			log.info('No current processes running, starting new process');
			await Process.startNext();
			console.log(
				'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX this should be the end!',
				this.finished,
				workerAvail,
				assignedCheck,
				assignedCrawl,
				this.jobs.toString()
			);
		}
	}
}
