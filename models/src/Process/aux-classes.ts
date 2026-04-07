import { Types } from 'mongoose';
import { prop, PropType } from '@typegoose/typegoose';

export class BranchFactorClass {
  @prop({ type: Number })
  public subj!: number;

  @prop({ type: Number })
  public obj!: number;
}

export class PredBranchFactor {
  @prop({ type: String })
  public url!: string;

  @prop({ type: BranchFactorClass })
  public branchFactor?: BranchFactorClass;
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

export type PredicateLimitationType =
  | 'disallow-past'
  | 'require-past'
  | 'disallow-future'
  | 'require-future';

export class PredLimitation {
  @prop({ required: true, type: String })
  public predicate!: string;

  @prop(
    {
      required: true,
      type: String,
      enum: ['disallow-past', 'require-past', 'disallow-future', 'require-future'],
      default: []
    },
    PropType.ARRAY
  )
  public lims!: PredicateLimitationType[];
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
   * Predicate limitation (whitelist/blacklist) for this step (deprecated, use predLimitations)
   */
  @prop({ type: PredicateLimitationClass })
  public predLimit?: PredicateLimitationClass;

  /**
   * Per-predicate limitations with past/future constraints
   */
  @prop({ type: PredLimitation, default: [] }, PropType.ARRAY)
  public predLimitations!: PredLimitation[];

  /**
   * Branch factors of last step's predicates
   */
  @prop({ type: [PredBranchFactor] }, PropType.ARRAY)
  public predsBranchFactor?: PredBranchFactor[];

  /**
   * Whether to crawl taking into account predicates branch factor
   */
  @prop({ type: Boolean, default: false, required: true })
  public followDirection: boolean = false;

  /**
   * Whether to reset error statuses of resources, domains, and paths at the start of this step
   */
  @prop({ type: Boolean, default: false, required: true })
  public resetErrors: boolean = false;

  /**
   * Whether to convert to endpoint path crawling after this step's expansion.
   * Only relevant when process.curPathType is 'traversal'. When true, after this step's
   * path extension completes, all active TraversalPaths are converted to EndpointPaths.
   */
  @prop({ type: Boolean, default: false, required: true })
  public convertToEndpointPaths: boolean = false;

  /**
   * Number of resources with status=done for this step (populated in notifications)
   */
  @prop({ type: Number, default: 0 })
  public doneResourceCount?: number;

  public toObject?(): object {
    return {
      seeds: this.seeds,
      maxPathLength: this.maxPathLength,
      maxPathProps: this.maxPathProps,
      predLimit: this.predLimit
        ? {
            limType: this.predLimit.limType,
            limPredicates: this.predLimit.limPredicates
          }
        : undefined,
      predLimitations: this.predLimitations?.map((pl) => ({
        predicate: pl.predicate,
        lims: pl.lims
      })),
      predsBranchFactor: this.predsBranchFactor?.map((pbf) => ({
        url: pbf.url,
        branchFactor: pbf.branchFactor
          ? { subj: pbf.branchFactor.subj, obj: pbf.branchFactor.obj }
          : undefined
      })),
      followDirection: this.followDirection,
      resetErrors: this.resetErrors,
      convertToEndpointPaths: this.convertToEndpointPaths,
      doneResourceCount: this.doneResourceCount
    };
  }
}
