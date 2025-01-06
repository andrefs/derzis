import { Types, Document } from 'mongoose';
import { urlListValidator, urlValidator, RecursivePartial, createLogger } from '@derzis/common';
import { prop, index, pre, getModelForClass, PropType } from '@typegoose/typegoose';
import { TripleClass, Triple, type TripleDocument } from './Triple';
import { Process, ProcessClass } from './Process';
import { ProcessTriple } from './ProcessTriple';
import { Domain } from './Domain';
const log = createLogger('Path');

class _Domain {
	@prop({
		enum: ['unvisited', 'checking', 'error', 'ready', 'crawling'],
		default: 'unvisited',
		type: String
	})
	public status!: 'unvisited' | 'checking' | 'error' | 'ready' | 'crawling';

	@prop({ required: true, validate: urlValidator, type: String })
	public origin!: string;
}

class ResourceCount {
	@prop({ default: 0, type: Number })
	public count!: number;

	@prop({ default: [], validate: urlListValidator, type: [String] }, PropType.ARRAY)
	public elems!: string[];
}
class SeedClass {
	@prop({ required: true, validate: urlValidator, type: String })
	public url!: string;
}
class HeadClass {
	@prop({ required: true, validate: urlValidator, type: String })
	public url!: string;

	@prop({
		enum: ['unvisited', 'done', 'crawling', 'error'],
		default: 'unvisited',
		type: String
	})
	public status!: 'unvisited' | 'done' | 'crawling' | 'error';

	@prop({ type: _Domain })
	public domain!: _Domain;
}
type PathSkeleton = Pick<PathClass, 'processId' | 'seed' | 'head'> &
	RecursivePartial<PathClass> & {
		predicates: Pick<ResourceCount, 'elems'>;
		nodes: Pick<ResourceCount, 'elems'>;
	};

@pre<PathClass>('save', async function() {
	this.nodes.count = this.nodes.elems.length;
	this.predicates.count = this.predicates.elems.length;
	if (this.predicates.count) {
		this.lastPredicate = this.predicates.elems[this.predicates.count - 1];
	}

	const origin = new URL(this.head.url).origin;
	const d = await Domain.findOne({ origin });
	if (d) {
		this.head.domain = {
			origin: d.origin,
			status: d.status
		};
	}
})
@index({ processId: 1 })
@index({
	'seed.url': 1,
	'head.url': 1,
	'predicates.count': 1
})
@index({
	'head.url': 1,
	'nodes.count': 1
})
class PathClass {
	_id!: Types.ObjectId;
	createdAt!: Date;
	updatedAt!: Date;

	@prop({ required: true, type: String })
	public processId!: string;

	@prop({ required: true, type: SeedClass })
	public seed!: SeedClass;

	@prop({ required: true, type: HeadClass })
	public head!: HeadClass;

	@prop({ type: ResourceCount })
	public predicates!: ResourceCount;

	@prop({ validate: urlValidator, type: String })
	public lastPredicate?: string;

	@prop({ type: ResourceCount })
	public nodes!: ResourceCount;

	@prop({ ref: 'Triple' })
	public outOfBounds?: Types.ObjectId;

	public shouldCreateNewPath(this: PathClass, t: TripleClass): boolean {
		//console.log('XXXXXXXXXXXXXX shouldCreateNewPath', { t, _this: this });
		// triple is reflexive
		if (t.subject === t.object) {
			return false;
		}

		// head appears in triple predicate
		if (t.predicate === this.head.url) {
			return false;
		}

		const newHeadUrl: string = t.subject === this.head.url ? t.object : t.subject;

		// path already has outOfBounds triple
		if (!!this.outOfBounds) {
			return false;
		}

		// new head already contained in path
		if (this.nodes.elems.includes(newHeadUrl)) {
			return false;
		}
		//console.log('XXXXXXXXXXXXXX shouldCreateNewPath TRUE');

		return true;
	}

	public tripleIsOutOfBounds(t: TripleClass, process: ProcessClass): boolean {
		const pathPreds: Set<string> = new Set(this.predicates.elems);
		return (
			this.nodes.count >= process.currentStep.maxPathLength ||
			(!pathPreds.has(t.predicate) && this.predicates.count >= process.currentStep.maxPathProps)
		);
	}

	public async extendWithExistingTriples(): Promise<{
		newPaths: PathSkeleton[];
		procTriples: Types.ObjectId[];
	}> {
		// if path has outOfBounds triple, try to extend with that
		if (!!this.outOfBounds) {
			const t: TripleClass | null = await Triple.findById(this.outOfBounds);
			const process = await Process.findOne({ pid: this.processId });
			if (t && !this.tripleIsOutOfBounds(t, process!) && process?.whiteBlackListsAllow(t!)) {
				const newHeadUrl: string = t!.subject === this.head.url ? t!.object : t!.subject;
				if (!this.nodes.elems.includes(newHeadUrl)) {
					const prop = t!.predicate;

					const np = this.copy();
					np.head.url = newHeadUrl;
					np.predicates.elems = Array.from(new Set([...this.predicates.elems, prop]));
					np.nodes.elems.push(newHeadUrl);

					await ProcessTriple.findOneAndUpdate(
						{ processId: this.processId, triple: t },
						{},
						{ upsert: true }
					);
					const path = await Path.create(np);
					await Path.deleteOne({ _id: this._id });

					return path.extendWithExistingTriples();
				}
			}
		}
		// find triples which include the head but dont belong to the path yet
		let triples: TripleDocument[] = await Triple.find({
			nodes: { $eq: this.head.url, $nin: this.nodes.elems }
		});
		return this.extend(triples);
	}

	public copy(this: PathClass): PathSkeleton {
		const copy = {
			processId: this.processId,
			seed: {
				url: this.seed.url
			},
			head: {
				url: this.head.url,
				status: this.head.status,
				domain: { origin: this.head.domain.origin, status: this.head.domain.status }
			},
			predicates: { elems: [...this.predicates.elems] },
			nodes: { elems: [...this.nodes.elems] }
		};
		return copy;
	}

	public async extend(
		triples: TripleClass[]
	): Promise<{ newPaths: PathSkeleton[]; procTriples: Types.ObjectId[] }> {
		let newPaths: { [prop: string]: { [newHead: string]: PathSkeleton } } = {};
		let procTriples: Types.ObjectId[] = [];
		const process = await Process.findOne({ pid: this.processId });

		for (const t of triples.filter(
			(t) => this.shouldCreateNewPath(t) && process?.whiteBlackListsAllow(t)
		)) {
			log.silly('Extending path with triple', t);
			const newHeadUrl: string = t.subject === this.head.url ? t.object : t.subject;
			const prop = t.predicate;

			newPaths[prop] = newPaths[prop] || {};
			// avoid extending the same path twice with the same triple
			if (!newPaths[prop][newHeadUrl]) {
				const np = this.copy();
				np.head.url = newHeadUrl;

				if (this.tripleIsOutOfBounds(t, process!)) {
					np.outOfBounds = t._id;
				} else {
					procTriples.push(t._id);
					np.predicates.elems = Array.from(new Set([...this.predicates.elems, prop]));
					np.nodes.elems.push(newHeadUrl);
				}
				log.silly('New path', np);
				newPaths[prop][newHeadUrl] = np;
			}
		}
		const nps: PathSkeleton[] = [];
		Object.values(newPaths).forEach((x) => Object.values(x).forEach((y) => nps.push(y)));

		log.silly('New paths', nps);
		return { newPaths: nps, procTriples };
	}
}

const Path = getModelForClass(PathClass, {
	schemaOptions: { timestamps: true, collection: 'paths' }
});

type PathDocument = PathClass & Document;

export { Path, PathClass, type PathDocument };
