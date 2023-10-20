import { Types, Document } from 'mongoose';
import { Resource } from './Resource';
import { Triple, TripleClass } from './Triple';
import { humanize } from 'humanize-digest';
import { Domain } from './Domain';
import { Path, type PathDocument } from './Path';
import { ProcessTriple } from './ProcessTriple';
import {
	prop,
	index,
	getModelForClass,
	pre,
	type ReturnModelType,
	PropType,
	post
} from '@typegoose/typegoose';

class NotificationClass {
	_id?: Types.ObjectId | string;

	@prop({ type: String })
	public email?: string;

	@prop({ type: String })
	public webhook?: string;

	@prop({ type: String })
	public ssePath?: string;
}
class ParamsClass {
	_id?: Types.ObjectId | string;

	@prop({ default: 2, required: true, type: Number })
	public maxPathLength!: number;

	@prop({ default: 1, required: true, type: Number })
	public maxPathProps!: number;

	@prop({ default: [], type: [String] })
	public whiteList?: string[];

	@prop({ default: [], type: [String] })
	public blackList?: string[];
}

@index({ status: 1 })
@index({ createdAt: 1 })
@pre<ProcessClass>('save', async function() {
	const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
	const count = await Process.countDocuments({
		createdAt: { $gt: today }
	});
	if (!this.pid) {
		const date = today.toISOString().split('T')[0] + '-' + count;
		const word = humanize(date);
		this.pid = `${word}-${date}`;
	}
	if (!this.notification) {
		this.notification = {};
	}
	const ssePath = `/processes/${this.pid}/events`;
	this.notification.ssePath = ssePath;
})
//@post<ProcessClass>('save', function(doc) {
//	if (doc) {
//		doc._id = doc._id.toString();
//		if (doc.notification) {
//			doc.notification._id = doc.notification._id.toString();
//		}
//		if (doc.params) {
//			doc.params._id = doc.params._id.toString();
//		}
//	}
//})
@post<ProcessClass>(/^findOne/, function(doc) {
	doc._id = doc._id.toString();
	if (doc.notification) {
		doc.notification._id = doc.notification._id.toString();
	}
	if (doc.params) {
		doc.params._id = doc.params._id.toString();
	}
})
@post<ProcessClass[]>(/^find/, function(docs) {
	// @ts-ignore
	if (this.op === 'find') {
		docs.forEach((doc) => {
			doc._id = doc._id.toString();

			if (doc.notification) {
				doc.notification._id = doc.notification._id.toString();
			}
			if (doc.params) {
				doc.params._id = doc.params._id.toString();
			}
		});
	}
})
class ProcessClass {
	_id?: Types.ObjectId | string;
	createdAt!: Date;
	updatedAt!: Date;

	@prop({ index: true, unique: true, type: String })
	public pid!: string;

	@prop({ required: true, type: NotificationClass })
	public notification!: NotificationClass;

	@prop({ type: String })
	public description?: string;

	@prop({ required: true, type: String }, PropType.ARRAY)
	public seeds!: string[];

	@prop({ required: true, type: ParamsClass })
	public params!: ParamsClass;

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
		if (this.params.whiteList?.length && !matchesOne(t.predicate, this.params.whiteList)) {
			return false;
		}
		if (this.params.blackList?.length && matchesOne(t.predicate, this.params.blackList)) {
			return false;
		}
		return true;
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
				object: triple.predicate
			};
		}
	}

	public async *getTriplesJson(this: ProcessClass) {
		for await (const t of this.getTriples()) {
			yield JSON.stringify(t);
		}
	}

	public async getPaths(skip = 0, limit = 20) {
		const paths: PathDocument[] = await Path.find({
			processId: this.pid,
			'nodes.count': { $lt: this.params.maxPathLength },
			'predicates.count': { $lte: this.params.maxPathProps }
		})
			// shorter paths first
			.sort({ 'nodes.count': 1 })
			.limit(limit)
			.skip(skip)
			.select('head.domain head.url')
			.lean();
		return paths;
	}

	public async extendPathsWithExistingTriples(paths: PathDocument[]) {
		for (const path of paths) {
			const newPathObjs = [];
			const toDelete = new Set();
			const procTriples = new Set();

			const { newPaths: nps, procTriples: pts } = await path.extendWithExistingTriples();

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

	public async extendPaths(triplesByNode: { [url: string]: TripleClass[] }) {
		const newHeads = Object.keys(triplesByNode);
		const paths = await Path.find({
			processId: this.pid,
			'head.url': newHeads.length === 1 ? newHeads[0] : { $in: Object.keys(triplesByNode) }
		});

		const pathsToDelete = new Set();
		const newPathObjs = [];
		const toDelete = new Set();
		const procTriples = new Set();

		for (const path of paths) {
			const { newPaths: nps, procTriples: pts } = await path.extend(triplesByNode[path.head.url]);
			if (nps.length) {
				toDelete.add(path._id);
				newPathObjs.push(...nps);
				for (const pt of pts) {
					procTriples.add(pt);
				}
			}
		}

		// add proc-triple associations
		await ProcessTriple.insertMany(
			[...procTriples].map((tId) => ({ processId: this.pid, triple: tId }))
		);

		// create new paths
		const newPaths = await Path.create(newPathObjs);

		// delete old paths
		await Path.deleteMany({ _id: { $in: Array.from(toDelete) } });

		// add existing heads
		await this.extendPathsWithExistingTriples(newPaths);
	}

	public async updateLimits(this: ProcessClass) {
		const paths = Path.find({
			processId: this.pid,
			outOfBounds: { $exists: true }
		});

		for await (const path of paths) {
			const { newPaths, procTriples } = await path.extendWithExistingTriples();
			await ProcessTriple.insertMany(
				[...procTriples].map((tId) => ({ processId: this.pid, triple: tId }))
			);
			await Path.create(newPaths);
		}
	}

	public async getInfo() {
		const baseFilter = { processIds: this.pid };
		const lastResource = await Resource.findOne(baseFilter).sort({
			updatedAt: -1
		});
		return {
			resources: {
				total: await Resource.countDocuments(baseFilter).lean(),
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
				total: await Triple.countDocuments(baseFilter).lean()
			},
			domains: {
				total: await Domain.countDocuments(baseFilter).lean(),
				beingCrawled: (
					await Domain.find({ ...baseFilter, status: 'crawling' })
						.select('origin')
						.lean()
				).map((d) => d.origin),
				ready: await Domain.countDocuments({
					...baseFilter,
					status: 'ready'
				}).lean(), // TODO add index
				crawling: await Domain.countDocuments({
					...baseFilter,
					status: 'crawling'
				}).lean(), // TODO add index
				error: await Domain.countDocuments({
					...baseFilter,
					status: 'error'
				}).lean() // TODO add index
			},
			paths: {
				total: await Path.countDocuments({
					'seed.url': { $in: this.seeds }
				}).lean(),
				finished: await Path.countDocuments({
					'seed.url': { $in: this.seeds },
					status: 'finished'
				}).lean(), // TODO add index
				disabled: await Path.countDocuments({
					'seed.url': { $in: this.seeds },
					status: 'disabled'
				}).lean(), // TODO add index
				active: await Path.countDocuments({
					'seed.url': { $in: this.seeds },
					status: 'active'
				}).lean() // TODO add index
			},
			// TODO remove allPaths
			allPaths: {
				total: await Path.countDocuments().lean(),
				finished: await Path.countDocuments({ status: 'finished' }).lean(), // TODO add index
				disabled: await Path.countDocuments({ status: 'disabled' }).lean(), // TODO add index
				active: await Path.countDocuments({ status: 'active' }).lean() // TODO add index
			},
			createdAt: this.createdAt,
			timeRunning: lastResource
				? (lastResource!.updatedAt.getTime() - this.createdAt.getTime()) / 1000
				: null,
			params: this.params,
			notification: this.notification,
			status: this.status,
			seeds: this.seeds
		};
	}

	// TODO configurable number of simultaneous processes
	public static async startNext(this: ReturnModelType<typeof ProcessClass>) {
		const runningProcs = await this.countDocuments({ status: 'running' });

		if (!runningProcs) {
			const process = await this.findOneAndUpdate(
				{ status: 'queued' },
				{ $set: { status: 'running' } },
				{ new: true }
			);
			if (process) {
				await Resource.insertSeeds(process.seeds, process.pid);
				return true;
			}
		}
		return false;
	}

	public static async getOneRunning(this: ReturnModelType<typeof ProcessClass>, skip = 0) {
		const x = await this.findOne({ status: 'running' }).sort({ createdAt: -1 }).skip(skip);
		return x;
	}
}

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

const Process = getModelForClass(ProcessClass, {
	schemaOptions: { timestamps: true, collection: 'processes' }
});

type ProcessDocument = ProcessClass & Document;

export { Process, ProcessClass, type ProcessDocument };
