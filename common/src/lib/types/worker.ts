import { type JobResult, type JobType } from '.';


export interface DomainCrawlJobInfo {
  domain: Record<string, any>;
  resources: { url: string }[];
}

export interface DomainLabelFetchJobInfo {
  domain: Record<string, any>;
  resources: { url: string }[];
}

export interface JobCapacity {
  domainLabelFetch: { capacity: number; resourcesPerDomain: number };
  domainCrawl: { capacity: number; resourcesPerDomain: number };
  robotsCheck: { capacity: number };
}

export interface OngoingJobs {
  domainCrawl: {
    [domain: string]: boolean;
  };
  robotsCheck: {
    [domain: string]: boolean;
  };
  domainLabelFetch: {
    [domain: string]: boolean;
  };
}

export interface BaseJobRequest {
  type: JobType;
  jobId: number;
}
export type RobotsCheckJobRequest = BaseJobRequest & {
  type: 'robotsCheck';
  origin: string;
}
export type ResourceCrawlJobRequest = BaseJobRequest & {
  type: 'resourceCrawl';
  origin: string;
  url: string;
}
export type DomainCrawlJobRequest = BaseJobRequest &
  DomainCrawlJobInfo & {
    type: 'domainCrawl';
  };
export type DomainLabelFetchJobRequest = BaseJobRequest &
  DomainLabelFetchJobInfo & {
    type: 'domainLabelFetch';
  };
export type ResourceLabelFetchJobRequest = BaseJobRequest & {
  type: 'resourceLabelFetch';
  url: string;
  domain: string;
};
export type JobRequest = RobotsCheckJobRequest | ResourceCrawlJobRequest | DomainCrawlJobRequest | DomainLabelFetchJobRequest | ResourceLabelFetchJobRequest;

export type MessageType =
  | 'askCurCap'
  | 'jobTimeout'
  | 'doJob'
  | 'jobDone'
  | 'shutdown'
  | 'repCurCap'
  | 'askJobs'
  | 'noCapacity'
  | 'alreadyBeingDone';
export interface BaseMessage {
  type: MessageType;
  payload: object;
}
export interface ShutdownMessage extends BaseMessage {
  type: 'shutdown';
  payload: { signal: string; ongoingJobs: OngoingJobs };
}
export interface JobTimeoutMessage extends BaseMessage {
  type: 'jobTimeout';
  payload: { origin: string };
}
export interface AskCurCapMessage extends BaseMessage {
  type: 'askCurCap';
}
export interface RepCurCapMessage extends BaseMessage {
  type: 'repCurCap';
  payload: JobCapacity;
}
export interface AskJobsMessage extends BaseMessage {
  type: 'askJobs';
  payload: JobCapacity;
}
export interface DoJobMessage extends BaseMessage {
  type: 'doJob';
  payload: Exclude<JobRequest, ResourceCrawlJobRequest | ResourceLabelFetchJobRequest>;
}
export interface JobDoneMessage extends BaseMessage {
  type: 'jobDone';
  payload: JobResult;
}
export interface NoCapacityMessage extends BaseMessage {
  type: 'noCapacity';
  payload: {
    origin: string;
    jobType: Exclude<JobType, 'resourceCrawl'>;
    jobId: number;
  };
}
export interface AlreadyBeingDoneMessage extends BaseMessage {
  type: 'alreadyBeingDone';
  payload: {
    origin: string;
    jobType: Exclude<JobType, 'resourceCrawl' | 'resourceLabelFetch'>;
    jobId: number;
  };
}
export type Message =
  | ShutdownMessage
  | JobTimeoutMessage
  | AskCurCapMessage
  | RepCurCapMessage
  | AskJobsMessage
  | DoJobMessage
  | JobDoneMessage
  | NoCapacityMessage
  | AlreadyBeingDoneMessage;
