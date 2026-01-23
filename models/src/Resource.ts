import type { Types, Document, UpdateQuery } from 'mongoose';
import { urlValidator, WorkerError } from '@derzis/common';
import { Domain, DomainClass } from './Domain';
import { Path, type PathDocument } from './Path';
import { Triple, type TripleClass, type TripleSkeleton } from './Triple';
import type { CrawlResourceResultDetails } from '@derzis/common';

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

		// Path
		await Path.updateMany(
			{ 'head.url': url },
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

		const paths = seedResources.map((s) => ({
			processId: pid,
			seed: { url: s.url },
			head: { url: s.url, status: s.status },
			nodes: { elems: [s.url] },
			predicates: { elems: [] },
			triples: []
		}));

		const insPaths = await Path.create(paths);
		return this.addPaths(insPaths);
	}

	public static async addPaths(this: ReturnModelType<typeof ResourceClass>, paths: PathDocument[]) {
		const res = await this.bulkWrite(
			paths.map((p: PathDocument) => ({
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
			paths.map((p: PathDocument) => ({
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
			origin: domain,
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
