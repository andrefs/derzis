import { Types, Document } from 'mongoose';
import {
	urlValidator,
} from '@derzis/common';
import { createLogger } from '@derzis/common/server';
import {
	prop,
	index,
	getModelForClass,
	Severity,
	modelOptions
} from '@typegoose/typegoose';
import { TripleClass, Triple, type TripleDocument } from './Triple';
import { ProcessClass } from './Process';
const log = createLogger('EndpointPath');

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
class MinPathInfo {
	@prop({ required: true, type: Number, default: 0 })
	public length!: number;

	@prop({ required: true, type: String })
	public seed!: string;
}
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
@index({ 'head.status': 1, status: 1 })
@index({ 'head.domain.status': 1, status: 1 })
@index({ processId: 1, 'head.url': 1 })
@index({
	processId: 1,
	status: 1,
	'head.domain.status': 1,
	'nodes.count': 1,
	'predicates.count': 1
})
class EndpointPathClass {
	_id!: Types.ObjectId;
	createdAt!: Date;
	updatedAt!: Date;

	@prop({ required: true, type: String })
	public processId!: string;

	@prop({ required: true, type: SeedClass })
	public seed!: SeedClass;

	@prop({ required: true, type: HeadClass })
	public head!: HeadClass;

	@prop({ required: true, type: Boolean, default: false })
	public frontier!: boolean;

	@prop({ required: true, type: MinPathInfo })
	public minPath: MinPathInfo;

	/**
	 * Mapping of seed IRIs to minimum path length from that seed to this path's head.
	 * Used for quickly determining if a new path is shorter than existing paths from the same seed.
	 */
	@prop({ required: true, type: Object, default: {} })
	public seedPaths: { [seedUrl: string]: number } = {};

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

	public shouldCreateNewPath(this: EndpointPathClass, t: TripleClass): boolean {
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
	 * Generate a filter to find existing triples that can extend this path,
	 * based on the process's current step whitelist/blacklist and the path's current predicates.
	 *
	 * @param process The current process context.
	 * @returns A filter object for querying existing triples.
	 */
	public genExistingTriplesFilter(process: ProcessClass) {
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

		return {
			predicate: predFilter,
			nodes: this.head.url,
			_id: { $nin: this.triples },
			...directionFilter,
		};

	}

	/**
	* Try to extend the path with existing triples in the database.
	* If successful, create new paths and return them along with the ProcessTriples to create.
	* If not, return empty array.
	*/
	public async extendWithExistingTriples(process: ProcessClass): ReturnType<EndpointPathClass['genExtended']> {
		const triplesFilter = this.genExistingTriplesFilter(process);
		// find triples which include the head but dont belong to the path yet
		let triples: TripleDocument[] = await Triple.find(triplesFilter);
		if (!triples.length) {
			log.silly(`No existing triples found to extend path ${this._id}`);
			return { extendedPaths: [], procTriples: [] };
		}
		log.silly(`Found ${triples.length} existing triples to extend path ${this._id}`);
		return this.genExtended(triples, process);
	}

	/**
	 * Create a copy of the path.
	 */
	public copy(this: EndpointPathClass): EndpointPathSkeleton {
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
	* If successful, generate new paths and return them along with the ProcessTriples to create.
	* If not, return empty array.
	* Does not save anything to the database.
	* @param triples Triples to use for extension.
	* @param process Process context.
	*/
	public async genExtended(
		triples: TripleClass[],
		process: ProcessClass,
	): Promise<{ extendedPaths: EndpointPathSkeleton[]; procTriples: Types.ObjectId[] }> {
		let extendedPaths: { [prop: string]: { [newHead: string]: EndpointPathSkeleton } } = {};
		let procTriples: Types.ObjectId[] = [];
		const predsDirMetrics = process.curPredsDirMetrics();
		const followDirection = process!.currentStep.followDirection;

		for (const t of triples.filter((t) =>
			this.shouldCreateNewPath(t) &&
			process?.whiteBlackListsAllow(t) &&
			t.directionOk(this.head.url, followDirection, predsDirMetrics)
		)) {
			log.silly('Extending path with triple', t);
			const newHeadUrl: string = t.subject === this.head.url ? t.object : t.subject;
			const prop = t.predicate;

			extendedPaths[prop] = extendedPaths[prop] || {};
			// avoid extending the same path twice with the same triple
			// and check if triple is out of bounds
			if (!extendedPaths[prop][newHeadUrl] && !this.tripleIsOutOfBounds(t, process!)) {
				const ep = this.copy();
				ep.head.url = newHeadUrl;
				ep.head.status = 'unvisited'; // to be redefined later
				ep.triples = [...this.triples, t._id];
				ep.predicates.elems = Array.from(new Set([...this.predicates.elems, prop]));
				ep.nodes.elems.push(newHeadUrl);
				ep.status = 'active';

				procTriples.push(t._id);
				log.silly('New path', ep);
				extendedPaths[prop][newHeadUrl] = ep;
			}
		}
		const eps: EndpointPathSkeleton[] = [];
		Object.values(extendedPaths).forEach((x) => Object.values(x).forEach((y) => eps.push(y)));

		log.silly('Extended paths', eps);
		return { extendedPaths: eps, procTriples };
	}
}

const EndpointPath = getModelForClass(EndpointPathClass, {
	schemaOptions: { timestamps: true, collection: 'traversalPaths' }
});

type EndpointPathDocument = EndpointPathClass & Document;

export { EndpointPath, EndpointPathClass, type EndpointPathDocument };
