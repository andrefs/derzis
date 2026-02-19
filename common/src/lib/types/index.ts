import { WorkerError } from '../errors';
export * from './worker';

export enum TripleType {
  LITERAL = 'literal',
  NAMED_NODE = 'namedNode'
}

export type TypedTripleId = {
  id: string;
  type: TripleType;
};
export enum PathType {
  TRAVERSAL = 'traversal',
  ENDPOINT = 'endpoint'
}


export type CrawlResourceResultDetails = {
  crawlId: { domainTs: Date; counter: number };
  ts: number;
};

export type RobotsCheckResultError = {
  err: WorkerError;
  details?: {
    endTime?: number;
    elapsedTime?: number;
    message?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stack?: any;
  };
} & BaseRobotsCheckResult &
  JobResultError;

export type RobotsCheckResult = RobotsCheckResultOk | RobotsCheckResultError;

export type JobResult = CrawlResourceResult | RobotsCheckResult | CrawlDomainResult;

export type BaseRobotsCheckResult = {
  jobType: 'robotsCheck';
  url: string;
} & BaseJobResult;
export type RobotsCheckResultOk = {
  details: {
    endTime: number;
    elapsedTime: number;
    robotsText: string;
    status: number;
  };
} & BaseRobotsCheckResult &
  JobResultOk;

export interface BaseJobResult {
  status: 'ok' | 'not_ok';
  jobType: JobType;
  origin: string;
  jobId: number;
}

export type JobType = 'domainCrawl' | 'robotsCheck' | 'resourceCrawl';
export interface JobResultError extends BaseJobResult {
  status: 'not_ok';
  err: object;
  details?: object;
}

export interface JobResultOk extends BaseJobResult {
  status: 'ok';
  details: object;
}

export type CrawlDomainResultDetails = {
  crawledResources?: string[];
  nonCrawledResources?: string[];
};

export type BaseCrawlDomainResult = {
  jobType: 'domainCrawl';
  details: CrawlDomainResultDetails;
} & BaseJobResult;
export type BaseCrawlDomainResultOk = BaseCrawlDomainResult & JobResultOk;
export type BaseCrawlDomainResultError = BaseCrawlDomainResult & JobResultError;
export type CrawlDomainResult = BaseCrawlDomainResultOk | BaseCrawlDomainResultError;

export type BaseCrawlResourceResult = {
  jobType: 'resourceCrawl';
  url: string;
  details: CrawlResourceResultDetails;
} & BaseJobResult;

export type LiteralObject = {
  value: string;
  datatype?: string;
  language?: string;
};

export interface BaseSimpleTriple {
  subject: string;
  predicate: string;
  type: TripleType;
}
export type SimpleLiteralTriple = BaseSimpleTriple & {
  object: LiteralObject;
  type: TripleType.LITERAL;
};
export type SimpleNamedNodeTriple = BaseSimpleTriple & {
  object: string;
  type: TripleType.NAMED_NODE;
};
export type SimpleTriple = SimpleLiteralTriple | SimpleNamedNodeTriple;

export type CrawlResourceResultOk = {
  details: { triples: SimpleTriple[] };
} & BaseCrawlResourceResult &
  JobResultOk;

export type CrawlResourceResultError = {
  err: WorkerError;
} & BaseCrawlResourceResult &
  JobResultError;

export type CrawlResourceResult = CrawlResourceResultOk | CrawlResourceResultError;

export type RecursivePartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
  ? RecursivePartial<U>[]
  : T[P] extends object | undefined
  ? RecursivePartial<T[P]>
  : T[P];
};
