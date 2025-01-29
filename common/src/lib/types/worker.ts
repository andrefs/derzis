import { type JobResult, type JobType } from '.';
import { type DomainCrawlJobInfo } from '@derzis/models';

export interface JobCapacity {
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
}

export interface BaseJobRequest {
  type: JobType;
  jobId: number;
}
export interface RobotsCheckJobRequest extends BaseJobRequest {
  type: 'robotsCheck';
  origin: string;
}
export interface ResourceCrawlJobRequest extends BaseJobRequest {
  type: 'resourceCrawl';
  origin: string;
  url: string;
}
export type DomainCrawlJobRequest = BaseJobRequest &
  DomainCrawlJobInfo & {
    type: 'domainCrawl';
  };
export type JobRequest = RobotsCheckJobRequest | ResourceCrawlJobRequest | DomainCrawlJobRequest;

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
  payload: Exclude<JobRequest, ResourceCrawlJobRequest>;
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
    jobType: Exclude<JobType, 'resourceCrawl'>;
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
