import type { Types, Document, UpdateQuery } from 'mongoose';
import { urlValidator, WorkerError } from '@derzis/common';
import { Domain, DomainClass } from './Domain';
import { TraversalPath, EndpointPath, type TraversalPathDocument, type EndpointPathDocument } from './Path';
import { Triple, type TripleClass, type TripleSkeleton } from './Triple';
import type { CrawlResourceResultDetails } from '@derzis/common';
import config from '@derzis/config';

import {
	prop,
	index,
	type ReturnModelType,
	getModelForClass,
	PropType
} from '@typegoose/typegoose';

class CrawlId {
	@prop({ type: Date })
	public domainTs!: Date;

	@prop({ type: Number })
	public counter!: number;
}

@index({ url: 1, status: 1 })
@index({ domain: 1, status: 1 })
@index({ url: 1 }, { unique: true })
@index({ status: 1 })
@index({ domain: 1 })
@index({ domain: 1, status: 1, url: 1 })
class ResourceClass {
	createdAt!: Date;
	updatedAt!: Date;

	@prop({ required: true, index: true, unique: true, validate: urlValidator, type: String })
	public url!: string;

	@prop({ required: true, validate: urlValidator, type: String })
	public domain!: string;

	@prop({
		enum: ['unvisited', 'done', 'crawling', 'error'],
		default: 'unvisited',
		type: String
	})
	public status!: 'unvisited' | 'done' | 'crawling' | 'error';

	@prop({ ref: 'TripleClass', default: [], Type: [Triple] }, PropType.ARRAY)
	public triples?: Types.DocumentArray<TripleClass>;

	@prop({ type: Number })
	public jobId?: number;

	@prop({ type: CrawlId })
	public crawlId?: CrawlId;

	public static async addMany(
		this: ReturnModelType<typeof ResourceClass>,
		resources: { url: string; domain: string }[]
	) {
		let insertedDocs: ResourceClass[] = [];
		const existingDocs: Partial<ResourceClass>[] = [];

		await this.insertMany(resources, { ordered: false })
			.then((docs) => (insertedDocs = docs.map((d) => d.toObject())))
			.catch((err) => {
				for (const e of err.writeErrors) {
					if (e.err.code && e.err.code === 11000) {
						existingDocs.push(resources[e.err.index]);
					}
					// TO DO handle other errors
				}
				insertedDocs = err.insertedDocs;
			});

		if (insertedDocs.length) {
			const domainsSet = new Set<string>(resources.map((r) => r.domain));
			await Domain.upsertMany(Array.from(domainsSet));
		}

		return insertedDocs;
	}

	/**
	 * Adds resources from an array of triples by extracting unique subjects and objects.
	 * @param triples - An array of TripleSkeleton objects containing subject and object URLs.
	 * @returns A promise that resolves to the added resources.
	 */
	public static async addFromTriples(
		this: ReturnModelType<typeof ResourceClass>,
		triples: TripleSkeleton[]
	) {
		const resources: { [pos: string]: boolean } = {};
		for (const t of triples) {
			resources[t.subject] = true;
			resources[t.object] = true;
		}

		return await this.addMany(
			Object.keys(resources).map((u) => ({
				url: u,
				domain: new URL(u).origin
			}))
		);
	}

	/**
	* Marks a resource as crawled, updating its status and related domain/path stats.
	* @param url - The URL of the resource to mark as crawled.
	* @param details - Details about the crawl result.
	* @param error - Optional error information if the crawl failed.
	* @returns An object containing updated domain crawl information.
	*/
	public static async markAsCrawled(
		this: ReturnModelType<typeof ResourceClass>,
		url: string,
		details: CrawlResourceResultDetails,
		error?: WorkerError
	) {
		// Resource
		const oldRes = await this.findOneAndUpdate(
			{ url, status: 'crawling' },
			{
				status: error ? 'error' : 'done',
				crawlId: details.crawlId
			},
			{ returnDocument: 'before' }
		);

		// TraversalPath
		await TraversalPath.updateMany(
			{ 'head.url': url, status: 'active' },
			{
				$set: {
					'head.status': error ? 'error' : 'done'
				}
			}
		);

		// Domain
		const baseFilter = { origin: new URL(url).origin };

		let update: UpdateQuery<DomainClass> = {};
		if (oldRes) {
			update['$inc'] = {
				'crawl.queued': -1,
				'crawl.ongoing': -1
			}
		};

		if (error) {
			update['$inc'] = update['$inc'] || {};
			update['$inc']['crawl.failed'] = 1

			if (error.errorType === 'request_timeout') {
				update['$inc']['warnings.E_RESOURCE_TIMEOUT'] = 1;
				update['$push'] = update['$push'] || {};
				update['$push'].lastWarnings = {
					$each: [{ errType: 'E_RESOURCE_TIMEOUT' }],
					$slice: -10
				};
			} else if (error.errorType === 'host_not_found') {
				update['$inc']['warnings.E_DOMAIN_NOT_FOUND'] = 1;
				update['$push'] = update['$push'] || {};
				update['$push'].lastWarnings = {
					$each: [{ errType: 'E_DOMAIN_NOT_FOUND' }],
					$slice: -10
				};
			} else if (error.errorType === 'connection_reset' || error.errorType === 'too_many_redirects' || error.errorType === 'unsupported_mime_type') {
				update['$inc']['warnings.E_RESOURCE_ISSUE'] = 1;
				update['$push'] = update['$push'] || {};
				update['$push'].lastWarnings = {
					$each: [{ errType: 'E_RESOURCE_ISSUE' }],
					$slice: -10
				};
			} else {
				update['$inc']['warnings.E_UNKNOWN'] = 1;
				update['$push'] = update['$push'] || {};
				update['$push'].lastWarnings = {
					$each: [{ errType: 'E_UNKNOWN' }],
					$slice: -10
				};
			}
		} else {
			update['$inc'] = update['$inc'] || {};
			update['$inc']['crawl.success'] = 1
		};

		const d = await Domain.findOneAndUpdate(baseFilter, update, { returnDocument: 'after' })!;
		return {
			domain: await Domain.setNextCrawlAllowed(url, details.ts, d!.crawl.delay),
		};
	}

	public static async insertSeeds(
		this: ReturnModelType<typeof ResourceClass>,
		urls: string[],
		pid: string
	) {
		const upserts = urls.map((u: string) => ({
			updateOne: {
				filter: { url: u },
				update: {
					$setOnInsert: {
						url: u,
						domain: new URL(u).origin
					}
				},
				upsert: true,
				setDefaultsOnInsert: true
			}
		}));

		const res = await this.bulkWrite(upserts);
		const domains = new Set<string>(urls.map((u: string) => new URL(u).origin));
		await Domain.upsertMany(Array.from(domains));
		const seedResources = await this.find({ url: { $in: urls } })
			.select('url domain status')
			.lean();

		return this.insertSeedPaths(pid, seedResources);
	}

	/**
	 * Inserts seed paths for a given process ID and an array of seed resources, creating either traversal or endpoint paths based on the configuration.
	 * @param pid - The process ID to associate with the seed paths.
	 * @param seeds - An array of ResourceDocument objects representing the seed resources.
	 * @returns An object containing the results of the path insertions and related updates.
	 */
	public static async insertSeedPaths(
		this: ReturnModelType<typeof ResourceClass>,
		pid: string,
		seeds: ResourceDocument[]
	) {

		// Traversal paths
		if (config.manager.pathType === 'traversal') {
			const paths = seeds.map((s) => ({
				processId: pid,
				seed: { url: s.url },
				head: { url: s.url, status: s.status },
				nodes: { elems: [s.url] },
				predicates: { elems: [] },
				triples: [],
				status: 'active'
			}));

			const insPaths = await TraversalPath.create(paths);
			return this.addTvPaths(insPaths);
		}
		// Endpoint paths
		else {
			const paths = seeds.map((s) => ({
				processId: pid,
				seed: { url: s.url },
				head: { url: s.url, status: s.status, domain: { origin: s.domain, status: 'active' } },
				status: 'active',
				frontier: true,
				minPath: {
					length: 1,
					seeds: [s.url]
				},
				seedPaths: {
					[s.url]: 1
				}
			}));

			const insPaths = await EndpointPath.create(paths);
			return this.addEpPaths(insPaths);
		}
	}

	/**
	 * Adds endpoint paths to the related domains, updating their crawl statistics.
	 * @param paths - An array of EndpointPathDocument objects to add to the domains.
	 * @returns An object containing the results of the domain updates.
	 **/
	public static async addEpPaths(this: ReturnModelType<typeof ResourceClass>, paths: EndpointPathDocument[]) {
		const dom = await Domain.bulkWrite(
			paths.map((p: EndpointPathDocument) => ({
				updateOne: {
					filter: { origin: p.head.domain.origin },
					update: { $inc: { 'crawl.pathHeads': 1 } }
				}
			}))
		);
		return { dom };
	}

	/**
	* Adds traversal paths to the resources, updating their head counts and minimum path lengths.
	* Also updates the related domain crawl statistics.
	* @param paths - An array of TraversalPathDocument objects to add to the resources.
	* @returns An object containing the results of the resource and domain updates.
	*/
	public static async addTvPaths(this: ReturnModelType<typeof ResourceClass>, paths: TraversalPathDocument[]) {
		const res = await this.bulkWrite(
			paths.map((p: TraversalPathDocument) => ({
				updateOne: {
					filter: { url: p.head.url },
					update: {
						$addToSet: { paths: p._id },
						$inc: { headCount: 1 },
						$min: {
							minPathLength: p.nodes.count
						}
					}
				}
			}))
		);
		const dom = await Domain.bulkWrite(
			paths.map((p: TraversalPathDocument) => ({
				updateOne: {
					filter: { origin: p.head.domain.origin },
					update: { $inc: { 'crawl.pathHeads': 1 } }
				}
			}))
		);
		return { res, dom };
	}

	public static async getUnvisited(
		this: ReturnModelType<typeof ResourceClass>,
		domain: string,
		exclude: string[],
		limit: number
	) {
		return await Resource.find({
			domain,
			status: 'unvisited',
			url: { $nin: exclude }
		})
			.limit(limit - exclude.length)
			.select('url')
			.lean();
	}
}

const Resource = getModelForClass(ResourceClass, {
	schemaOptions: { timestamps: true, collection: 'resources' }
});
type ResourceDocument = ResourceClass & Document;

export { Resource, ResourceClass, type ResourceDocument };
