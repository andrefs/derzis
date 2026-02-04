import { Types, Document } from 'mongoose';
import {
	urlListValidator,
	urlValidator,
	type RecursivePartial,
} from '@derzis/common';
import { createLogger } from '@derzis/common/server';
import {
	prop,
	index,
	pre,
	getModelForClass,
	PropType,
	Severity,
	modelOptions
} from '@typegoose/typegoose';
import { TripleClass, Triple, type TripleDocument } from './Triple';
import { ProcessClass } from './Process';
import { ProcessTriple } from './ProcessTriple';
import { Domain } from './Domain';
import { Resource } from './Resource';
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

@modelOptions({ options: { allowMixed: Severity.ERROR } })
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
export type PathSkeleton = Pick<PathClass, 'processId' | 'seed' | 'head'> &
	RecursivePartial<PathClass> & {
		predicates: Pick<ResourceCount, 'elems'>;
		nodes: Pick<ResourceCount, 'elems'>;
	};

@pre<PathClass>('save', async function () {
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
	'nodes.count': 1,
})
@index({ status: 1 })
@index({ 'head.url': 1, status: 1 })
@index({ processId: 1, 'head.url': 1 })
@index({
	processId: 1,
	status: 1,
	'head.domain.status': 1,
	'nodes.count': 1,
	'predicates.count': 1
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

	@prop({ required: true, ref: 'Triple', type: [Types.ObjectId], default: [] }, PropType.ARRAY)
	public triples!: Types.ObjectId[];

	/**
	 * Path status: 'active' or 'deleted'
	 * 'deleted' paths are ignored in processing but kept for record-keeping
	 */
	@prop({
		enum: ['active', 'deleted'],
		default: 'active',
		type: String
	})
	public status!: 'active' | 'deleted';

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

	/**
	* Try to extend the path with existing triples in the database.
	* If successful, create new paths and return them along with the ProcessTriples to create.
	* If not, return empty array.
	*/
	public async extendWithExistingTriples(process: ProcessClass): Promise<{
		newPaths: PathSkeleton[];
		procTriples: Types.ObjectId[];
	}> {

		let predFilter;

		// if path already at max props
		if (this.predicates.count >= process.currentStep.maxPathProps) {
			// and if there's a step whitelist, only predicates on both lists allowed
			if (process.currentStep.predLimit.limType === 'whitelist') {
				const predWhiteList = [];
				for (const p of this.predicates.elems) {
					if (process.currentStep.predLimit.limPredicates.includes(p)) {
						predWhiteList.push(p);
					}
				}
				predFilter = { $in: predWhiteList };
			}
			// blacklist case, just use path predicates
			else {
				predFilter = {
					// path at max props but step has blacklist, so just use path predicates
					$in: this.predicates.elems,
					// and exclude blacklisted predicates
					'$nin': process.currentStep.predLimit.limPredicates
				};
			}
		}
		// path not at max props, use step whitelist/blacklist as is
		else {
			if (process.currentStep.predLimit.limType === 'whitelist') {
				predFilter = { $in: process.currentStep.predLimit.limPredicates };
			}
			else {
				predFilter = { $nin: process.currentStep.predLimit.limPredicates };
			}
		}

		const followDirection = process!.currentStep.followDirection;
		const predsDirMetrics = process!.curPredsDirMetrics();
		let directionFilter = {};

		if (followDirection && predsDirMetrics && predsDirMetrics.size) {
			const subjPreds: string[] = [];
			const objPreds: string[] = [];
			Array.from(predsDirMetrics).forEach(([pred, { bf }]) => {
				const bfRatio = bf.subj / bf.obj;
				if (bfRatio >= 1) {
					subjPreds.push(pred);
				} else {
					objPreds.push(pred);
				}
			});
			directionFilter = {
				$or: [
					{ predicate: { $nin: [...subjPreds, ...objPreds] } },
					{ predicate: { $in: subjPreds }, subject: this.head.url },
					{ predicate: { $in: objPreds }, object: this.head.url }
				]
			};
		}

		// find triples which include the head but dont belong to the path yet
		let triples: TripleDocument[] = await Triple.find({
			predicate: predFilter,
			nodes: this.head.url,
			_id: { $nin: this.triples },
			...directionFilter,
		});

		if (!triples.length) {
			log.silly(`No existing triples found to extend path ${this._id}`);
			return { newPaths: [], procTriples: [] };
		}
		log.silly(`Found ${triples.length} existing triples to extend path ${this._id}`);

		return this.extend(triples, process);
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
			nodes: { elems: [...this.nodes.elems] },
			status: this.status
		};
		return copy;
	}


	/**
	* Try to extend the path with the given triples.
	* If successful, create new paths and return them along with the ProcessTriples to create.
	* If not, return empty array.
	*/
	public async extend(
		triples: TripleClass[],
		process: ProcessClass,
	): Promise<{ newPaths: PathSkeleton[]; procTriples: Types.ObjectId[] }> {
		let newPaths: { [prop: string]: { [newHead: string]: PathSkeleton } } = {};
		let procTriples: Types.ObjectId[] = [];
		const predsDirMetrics = process.curPredsDirMetrics();
		const followDirection = process!.currentStep.followDirection;

		for (const t of triples.filter((t) =>
			this.shouldCreateNewPath(t) &&
			process?.whiteBlackListsAllow(t) &&
			t.directionOk(this.head.url, followDirection, predsDirMetrics)
		)) {
			log.silly('Extending path with triple', t);
			// TODO check follow direction
			const newHeadUrl: string = t.subject === this.head.url ? t.object : t.subject;
			const prop = t.predicate;

			newPaths[prop] = newPaths[prop] || {};
			// avoid extending the same path twice with the same triple
			// and check if triple is out of bounds
			if (!newPaths[prop][newHeadUrl] && !this.tripleIsOutOfBounds(t, process!)) {
				const np = this.copy();
				np.head.url = newHeadUrl;
				np.head.status = 'unvisited'; // to be redefined later
				np.triples = [...this.triples, t._id];
				np.predicates.elems = Array.from(new Set([...this.predicates.elems, prop]));
				np.nodes.elems.push(newHeadUrl);
				np.status = 'active';

				procTriples.push(t._id);
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
