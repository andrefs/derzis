import config from '@derzis/config';
import { AxiosInstance, AxiosResponse } from 'axios';
import Bluebird from 'bluebird';
import EventEmitter from 'events';
import robotsParser, { Robot } from 'robots-parser';
import * as db from './db';
import { IResource, Resource } from '@derzis/models';

import Axios from './axios';

let axios: AxiosInstance;
import contentType from 'content-type';
import parseRdf from './parse-rdf';
let log: MonkeyPatchedLogger;
import {
  createLogger,
  JobTimeoutError,
  MonkeyPatchedLogger,
  WorkerError,
  MimeTypeError,
  RobotsForbiddenError,
  TooManyRedirectsError,
  AxiosError,
} from '@derzis/common';
const acceptedMimeTypes = config.http.acceptedMimeTypes;
import setupDelay from './delay';
let delay = () => Bluebird.resolve();
import { v4 as uuidv4 } from 'uuid';
import * as RDF from '@rdfjs/types';
import { DomainCrawlJobRequest } from './WorkerPubSub';
import { OngoingJobs } from '@derzis/manager';
import {
  AxiosResponseHeaders,
  fetchRobots,
  findRedirectUrl,
  handleHttpError,
  HttpRequestResult,
} from './worker-utils';

export type JobType = 'domainCrawl' | 'robotsCheck' | 'resourceCrawl';

export interface BaseJobResult {
  status: 'ok' | 'not_ok';
  jobType: JobType;
  origin: string;
  jobId: number;
}
export interface JobResultOk extends BaseJobResult {
  status: 'ok';
  details: object;
}
export interface JobResultError extends BaseJobResult {
  status: 'not_ok';
  err: object;
  details?: object;
}

export type CrawlResourceResultDetails = {
  crawlId: { domainTs: Date; counter: number };
  ts: number;
};
export type BaseCrawlResourceResult = {
  jobType: 'resourceCrawl';
  url: string;
  details: CrawlResourceResultDetails;
} & BaseJobResult;

export type CrawlResourceResultOk = {
  details: { triples: RDF.Quad[] };
} & BaseCrawlResourceResult &
  JobResultOk;

export type CrawlResourceResultError = {
  err: WorkerError;
} & BaseCrawlResourceResult &
  JobResultError;

export type CrawlResourceResult =
  | CrawlResourceResultOk
  | CrawlResourceResultError;

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
export type RobotsCheckResultError = {
  err: WorkerError;
  details?: {
    endTime?: number;
    elapsedTime?: number;
    message?: string;
    stack?: any;
  };
} & BaseRobotsCheckResult &
  JobResultError;
export type RobotsCheckResult = RobotsCheckResultOk | RobotsCheckResultError;

export type BaseCrawlDomainResult = {
  jobType: 'domainCrawl';
} & BaseJobResult;
export type BaseCrawlDomainResultOk = BaseCrawlDomainResult & JobResultOk;
export type BaseCrawlDomainResultError = BaseCrawlDomainResult & JobResultError;
export type CrawlDomainResult =
  | BaseCrawlDomainResultOk
  | BaseCrawlDomainResultError;

export type JobResult =
  | CrawlResourceResult
  | RobotsCheckResult
  | CrawlDomainResult;

export interface Availability {
  currentCapacity: JobCapacity;
  currentJobs: OngoingJobs;
}
export interface JobCapacity {
  domainCrawl: { capacity: number; resourcesPerDomain: number };
  robotsCheck: { capacity: number };
}
interface JobsTimedOut {
  [domain: string]: boolean;
}

export class Worker extends EventEmitter {
  wId: string;
  wShortId: string;
  jobCapacity: JobCapacity;
  currentJobs: OngoingJobs;
  accept: string;
  jobsTimedout: JobsTimedOut;
  crawlTs!: Date;
  crawlCounter!: number;

  async connect() {
    log.info('Connecting to MongoDB');
    await db.connect();
  }

  constructor() {
    super();
    this.wId = uuidv4();
    this.wShortId = this.wId.replace(/-.*$/, '');
    log = createLogger(this.wShortId);
    axios = Axios(log);
    this.jobCapacity = config.jobs;
    this.currentJobs = { domainCrawl: {}, robotsCheck: {} };
    this.accept = acceptedMimeTypes
      .map((m, i) => `${m}; q=${Math.round(100 / (i + 2)) / 100}`)
      .join(', ');
    this.jobsTimedout = {};
  }

  alreadyBeingDone(domain: string, jobType: Exclude<JobType, 'resourceCrawl'>) {
    return !!this.currentJobs[jobType][domain];
  }

  currentCapacity(): JobCapacity {
    const domCrawlCap = this.jobCapacity.domainCrawl.capacity;
    const robCheckCap = this.jobCapacity.robotsCheck.capacity;
    const curDomCrawl = Object.keys(this.currentJobs.domainCrawl).length;
    const curRobCheck = Object.keys(this.currentJobs.robotsCheck).length;
    const av = {
      domainCrawl: {
        capacity: domCrawlCap - curDomCrawl,
        resourcesPerDomain: this.jobCapacity.domainCrawl.resourcesPerDomain,
      },
      robotsCheck: {
        capacity: robCheckCap - curRobCheck,
      },
    };
    return av;
  }

  status(): Availability {
    return {
      currentCapacity: this.currentCapacity(),
      currentJobs: this.currentJobs,
    };
  }

  hasCapacity(jobType: 'domainCrawl' | 'robotsCheck'): boolean {
    return (
      Object.keys(this.currentJobs[jobType]).length <
      this.jobCapacity[jobType].capacity
    );
  }

  async checkRobots(jobId: number, origin: string): Promise<RobotsCheckResult> {
    this.currentJobs.robotsCheck[origin] = true;

    const url = origin + '/robots.txt';
    const res = await fetchRobots(url, axios);
    delete this.currentJobs.robotsCheck[origin];
    return { ...res, url, jobId, origin, jobType: 'robotsCheck' };
  }

  async *crawlDomain({ jobId, domain, resources }: DomainCrawlJobRequest) {
    console.log('XXXXXXXx 1');
    this.crawlTs = new Date();
    this.crawlCounter = 0;
    this.currentJobs.domainCrawl[domain.origin] = true;
    const robotsText = domain?.robots?.text || '';
    const robots = robotsParser(domain.origin + '/robots.txt', robotsText);
    console.log('XXXXXXXx 2');

    this.emit('httpDebug', {
      type: 'delay',
      domain: domain.origin,
      delay: domain.crawl.delay,
    });
    delay = setupDelay(domain.crawl.delay * 1000 * 1.1); // ms to s, add 10% margin
    console.log('XXXXXXXx 3');

    for (const r of resources) {
      console.log('XXXXXXXx 4');
      const res = await this.crawlResource(jobId, domain.origin, r.url, robots);
      if (!res) {
        break;
      }
      console.log('XXXXXXXx 5');
      yield res;
    }
    console.log('XXXXXXXx 6');
    delete this.currentJobs.domainCrawl[domain.origin];
    console.log('XXXXXXXx 7');
  }

  async getResourceFromCache(url: string) {
    return Resource.findOne({ url });
  }

  async crawlResource(
    jobId: number,
    origin: string,
    url: string,
    robots: Robot
  ): Promise<CrawlResourceResult> {
    console.log('XXXXXXXx 4.1');
    const jobInfo = {
      jobType: 'resourceCrawl' as const,
      jobId,
      origin: origin,
      url,
    };
    console.log('XXXXXXXx 4.2');
    const crawlId = { domainTs: this.crawlTs, counter: this.crawlCounter };
    if (this.jobsTimedout[origin]) {
      console.log('XXXXXXXx 4.3');
      delete this.jobsTimedout[origin];
      delete this.currentJobs.domainCrawl[origin];
      log.warn(
        `Stopping domain ${origin} because Manager removed job #${jobId})`
      );
      return {
        ...jobInfo,
        status: 'not_ok' as const,
        details: { crawlId, ts: Date.now() },
        err: new JobTimeoutError(),
      };
    }
    console.log('XXXXXXXx 4.4');
    this.crawlCounter++;
    this.currentJobs.domainCrawl[origin] = true;
    let jobResult: CrawlResourceResult;

    console.log('XXXXXXXx 4.5');
    if (robots.isDisallowed(url, config.http.userAgent)) {
      console.log('XXXXXXXx 4.6');
      return {
        ...jobInfo,
        status: 'not_ok' as const,
        details: { crawlId, ts: Date.now() },
        err: new RobotsForbiddenError(),
      };
    }
    console.log('XXXXXXXx 4.7', { url });

    let cachedRes = await this.getResourceFromCache(url);
    console.log('XXXXXXXx 4.8');
    if (cachedRes) {
      console.log('XXXXXXXx 4.9');
      return {
        ...jobInfo,
        status: 'ok',
        details: {
          crawlId,
          triples: cachedRes.triples.map((t) => t.toObject()),
          ts: crawlId.domainTs.getTime(),
          cached: true,
        },
      } as CrawlResourceResultOk;
    }

    console.log('XXXXXXXx 4.10');
    let res = await this.fetchResource(url);

    if (res.status === 'ok') {
      console.log('XXXXXXXx 4.11');
      jobResult = {
        ...jobInfo,
        status: 'ok',
        details: { crawlId, triples: res.triples, ts: res.ts },
      };
    } else {
      console.log('XXXXXXXx 4.12');
      jobResult = {
        ...jobInfo,
        status: 'not_ok' as const,
        details: { crawlId, ts: Date.now() },
        err: res.err,
      };
    }
    console.log('XXXXXXXx 4.13');
    return jobResult as CrawlResourceResult;
  }

  async fetchResource(url: string) {
    let res = await this.getHttpContent(url);
    if (res.status === 'ok') {
      const { triples, errors } = await parseRdf(res.rdf, res.mime);
      // TODO do something with errors
      return { ...res, triples };
    }
    return res;
  }

  getHttpContent = async (
    url: string,
    redirect = 0
  ): Promise<HttpRequestResult> => {
    const resp = await this.makeHttpRequest(url);
    if (resp.status === 'not_ok') {
      return resp;
    }
    const res = await this.handleHttpResponse(resp.res, redirect, url);
    return res?.status === 'ok' ? res : handleHttpError(url, res.err);
  };

  makeHttpRequest = async (url: string) => {
    const timeout = config.http.domainCrawl.timeouts || 10 * 1000;
    const maxRedirects = config.http.domainCrawl.maxRedirects || 5;
    const headers = {
      'User-Agent': config.http.userAgent,
      Accept: this.accept,
    };
    await delay();
    this.emitHttpDebugEvent(url);
    const opts = {
      headers,
      // prevent axios of parsing [ld+]json
      transformResponse: (x: any) => x,
      timeout,
      maxRedirects,
    };
    try {
      const res = await axios.get(url, opts);
      return { status: 'ok' as const, res: res as MinimalAxiosResponse };
    } catch (err) {
      return { status: 'not_ok' as const, url, err: new AxiosError(err) };
    }
  };

  emitHttpDebugEvent = (url: string) => {
    this.emit('httpDebug', {
      wId: this.wId,
      type: 'request',
      url,
      ts: new Date(),
      domain: new URL(url).origin,
    });
  };

  handleHttpResponse = async (
    resp: MinimalAxiosResponse,
    redirect: number,
    url: string
  ) => {
    const maxRedirects = config.http.domainCrawl.maxRedirects || 5;
    const mime = contentType.parse(resp.headers['content-type']).type;
    if (!acceptedMimeTypes.some((aMT) => mime === aMT)) {
      const newUrl = findRedirectUrl(
        resp.headers as AxiosResponseHeaders,
        resp.data
      );
      if (!newUrl) {
        return { status: 'not_ok' as const, err: new MimeTypeError(mime) };
      }
      if (redirect >= maxRedirects) {
        return {
          status: 'not_ok' as const,
          err: new TooManyRedirectsError(url),
        };
      } // TODO list of redirect URLs?
      return this.getHttpContent(newUrl, redirect + 1);
    }
    return {
      status: 'ok' as const,
      rdf: resp.data,
      ts: Number(resp.headers['request-endTime']),
      mime,
    };
  };
}

export type MinimalAxiosResponse = Pick<AxiosResponse<any>, 'headers' | 'data'>;
