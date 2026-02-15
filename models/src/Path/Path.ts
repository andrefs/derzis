import { Types } from 'mongoose';
import {
	urlListValidator,
	urlValidator,
} from '@derzis/common';
import { createLogger } from '@derzis/common/server';
import {
	prop,
	PropType,
	Severity,
	modelOptions
} from '@typegoose/typegoose';
import { TripleClass } from '../Triple';
import { ProcessClass } from '../Process';
import { TraversalPathSkeleton } from './TraversalPath';
import { EndpointPathSkeleton } from './EndpointPath';

class DomainClass {
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

	@prop({ type: DomainClass })
	public domain!: DomainClass;
}

export type PathSkeleton = TraversalPathSkeleton | EndpointPathSkeleton;

export type PathSkeletonConstructor<T extends PathSkeleton> = Omit<T, '_id'> & {
	_id?: Types.ObjectId;
};

export { DomainClass, ResourceCount, SeedClass, HeadClass };

export abstract class PathClass {
	_id!: Types.ObjectId;
	createdAt!: Date;
	updatedAt!: Date;

	@prop({ required: true, type: String })
	public processId!: string;

	@prop({
		enum: ['traversal', 'endpoint'],
		required: true,
		type: String
	})
	public type!: 'traversal' | 'endpoint';

	@prop({ required: true, type: SeedClass })
	public seed!: SeedClass;

	@prop({ required: true, type: HeadClass })
	public head!: HeadClass;

	@prop({
		enum: ['active', 'deleted'],
		default: 'active',
		type: String
	})
	public status!: 'active' | 'deleted';

	public abstract shouldCreateNewPath(t: TripleClass): boolean;

	public abstract tripleIsOutOfBounds(t: TripleClass, process: ProcessClass): boolean;

	public abstract genExistingTriplesFilter(process: ProcessClass): object;

	public abstract copy(): PathSkeleton;

	public abstract genExtended(triples: TripleClass[], process: ProcessClass): Promise<{ extendedPaths: PathSkeleton[]; procTriples: Types.ObjectId[] }>;
}
