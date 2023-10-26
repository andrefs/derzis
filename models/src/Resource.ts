import type { Types, Document } from 'mongoose';
import { urlValidator, WorkerError } from '@derzis/common';
import { Domain } from './Domain';
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
class ResourceClass {
	createdAt!: Date;
	updatedAt!: Date;

	@prop({ required: true, validate: urlValidator, type: String })
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
	public triples!: Types.DocumentArray<TripleClass>;

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
			await Domain.upsertMany(resources.map((r) => r.domain));
		}

		return insertedDocs;
	}

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

		// Domain
		const baseFilter = { origin: new URL(url).origin };

		if (oldRes) {
			let updateInc = error ? { 'crawl.failed': 1 } : { 'crawl.success': 1 };
			const update = {
				$inc: {
					...updateInc,
					'crawl.queued': -1,
					'crawl.ongoing': -1
				}
			};

			await Domain.findOneAndUpdate(baseFilter, update);
		}

		let d = await Domain.findOne(baseFilter)!;

		const nextAllowed = new Date(details.ts + d!.crawl.delay * 1000);
		const filter = {
			...baseFilter,
			'crawl.nextAllowed': {
				$lt: nextAllowed
			}
		};
		d = await Domain.findOneAndUpdate(filter, {
			'crawl.nextAllowed': nextAllowed
		});

		return {
			domain: d
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
		await Domain.upsertMany(urls.map((u: string) => new URL(u).origin));

		const paths = urls.map((u: string) => ({
			processId: pid,
			seed: { url: u },
			head: { url: u },
			nodes: { elems: [u] },
			predicates: { elems: [] }
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
					filter: { origin: p.head.domain },
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
