import { Types } from 'mongoose';
import {
	prop,
	PropType
} from '@typegoose/typegoose';

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

	/**
	 * Whether to reset error statuses of resources, domains, and paths at the start of this step
	 */
	@prop({ type: Boolean, default: false, required: true })
	public resetErrors: boolean = false;
}
