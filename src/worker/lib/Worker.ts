import config from '@derzis/config';
import {AxiosInstance} from "axios";
import Bluebird from "bluebird";
import EventEmitter from 'events';
import robotsParser, {Robot} from 'robots-parser';

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
  TooManyRedirectsError
} from '@derzis/common';
const acceptedMimeTypes = config.http.acceptedMimeTypes;
import setupDelay from './delay';
let delay = () => Bluebird.resolve();
import {v4 as uuidv4} from 'uuid';
import * as RDF from "@rdfjs/types";
import {DomainCrawlJobRequest} from "./WorkerPubSub";
import {OngoingJobs} from "@derzis/manager";
import {
  fetchRobots,
  findRedirectUrl,
  handleHttpError,
  HttpRequestResult
} from "./worker-utils";

export type JobType = 'domainCrawl'|'robotsCheck'|'resourceCrawl';
export interface BaseJobResult {
  status: 'ok'|'not_ok', jobType: JobType;
  origin: string,
}
;
export interface JobResultOk extends BaseJobResult {
  status: 'ok', details: object;
}
;
export interface JobResultError extends BaseJobResult {
  status: 'not_ok', err: object;
  details?: object;
}
;

export type CrawlResourceResultDetails = {
  crawlId: {domainTs: Date, counter: number},
  ts: number,
};
export type BaseCrawlResourceResult = {
  jobType: 'resourceCrawl'; url : string; details : CrawlResourceResultDetails;
}&BaseJobResult;
export type CrawlResourceResultOk = {
  details: {triples: RDF.Quad[]};
}&BaseCrawlResourceResult&JobResultOk;
export type CrawlResourceResultError = {
  err: WorkerError
}&BaseCrawlResourceResult&JobResultError;
export type CrawlResourceResult =
    CrawlResourceResultOk|CrawlResourceResultError;

export type BaseRobotsCheckResult = {
  jobType: 'robotsCheck',
  url: string,
}&BaseJobResult;
export type RobotsCheckResultOk = {
  details:
      {endTime: number, elapsedTime: number, robotsText: string, status: number}
}&BaseRobotsCheckResult&JobResultOk;
export type RobotsCheckResultError = {
  err: WorkerError,
  details
  ?: {endTime?: number, elapsedTime?: number, message?: string, stack?: any}
}&BaseRobotsCheckResult&JobResultError;
export type RobotsCheckResult = RobotsCheckResultOk|RobotsCheckResultError;

export type BaseCrawlDomainResult = {
  jobType: 'domainCrawl'
}&BaseJobResult;
export type BaseCrawlDomainResultOk = BaseCrawlDomainResult&JobResultOk;
export type BaseCrawlDomainResultError = BaseCrawlDomainResult&JobResultError;
export type CrawlDomainResult =
    BaseCrawlDomainResultOk|BaseCrawlDomainResultError;

export type JobResult = CrawlResourceResult|RobotsCheckResult|CrawlDomainResult;

export interface Availability {
  currentCapacity: JobCapacity, currentJobs: OngoingJobs
}
;

export interface JobCapacity {
  domainCrawl: {capacity: number; resourcesPerDomain : number;};
  robotsCheck: {capacity: number;};
}
;

interface JobsTimedOut {
  [domain: string]: boolean
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

  constructor() {
    super();
    this.wId = uuidv4();
    this.wShortId = this.wId.replace(/-.*$/, '');
    log = createLogger(this.wShortId);
    axios = Axios(log);
    this.jobCapacity = config.jobs;
    this.currentJobs = {domainCrawl : {}, robotsCheck : {}};
    this.accept =
        acceptedMimeTypes
            .map((m, i) => `${m}; q=${Math.round(100 / (i + 2)) / 100}`)
            .join(', ');
    this.jobsTimedout = {};
  }

  currentCapacity(): JobCapacity {
    const domCrawlCap = this.jobCapacity.domainCrawl.capacity;
    const robCheckCap = this.jobCapacity.robotsCheck.capacity;
    const curDomCrawl = Object.keys(this.currentJobs.domainCrawl).length;
    const curRobCheck = Object.keys(this.currentJobs.robotsCheck).length;
    const av = {
      domainCrawl : {
        capacity : domCrawlCap - curDomCrawl,
        resourcesPerDomain : this.jobCapacity.domainCrawl.resourcesPerDomain
      },
      robotsCheck : {
        capacity : robCheckCap - curRobCheck,
      }
    };
    return av;
  }

  status(): Availability {
    return {
      currentCapacity : this.currentCapacity(),
      currentJobs : this.currentJobs
    };
  }

  hasCapacity(jobType: 'domainCrawl'|'robotsCheck'): boolean {
    return Object.keys(this.currentJobs[jobType]).length <
           this.jobCapacity[jobType].capacity;
  }

  async checkRobots(origin: string): Promise<RobotsCheckResult> {
    this.currentJobs.robotsCheck[origin] = true;

    const url = origin + '/robots.txt';
    const res = await fetchRobots(url, axios);
    delete this.currentJobs.robotsCheck[origin];
    return {...res, url, origin, jobType : 'robotsCheck'};
  };

  async * crawlDomain({domain, resources}: DomainCrawlJobRequest) {
    this.crawlTs = new Date();
    this.crawlCounter = 0;
    this.currentJobs.domainCrawl[domain.origin] = true;
    const robotsText = domain?.robots?.text || '';
    const robots = robotsParser(domain.origin + '/robots.txt', robotsText);

    this.emit(
        'httpDebug',
        {type : 'delay', domain : domain.origin, delay : domain.crawl.delay});
    delay =
        setupDelay(domain.crawl.delay * 1000 * 1.1); // ms to s, add 10% margin

    for (const r of resources) {
      const res = await this.crawlResource(domain.origin, r.url, robots);
      if (!res) {
        break;
      }
      yield res;
    }
    delete this.currentJobs.domainCrawl[domain.origin];
  }

  async crawlResource(origin: string, url: string,
                      robots: Robot): Promise<CrawlResourceResult> {
    const jobInfo = {jobType : 'resourceCrawl' as const, origin : origin, url};
    const crawlId = {domainTs : this.crawlTs, counter : this.crawlCounter};
    if (this.jobsTimedout[origin]) {
      delete this.jobsTimedout[origin];
      delete this.currentJobs.domainCrawl[origin];
      log.warn(`Stopping domain ${origin} because Manager removed job`);
      return {
        ...jobInfo,
        status : 'not_ok' as const,
        details : {crawlId, ts : Date.now()},
        err : new JobTimeoutError()
      };
    }
    this.crawlCounter++;
    this.currentJobs.domainCrawl[origin] = true;
    let jobResult: CrawlResourceResult;

    if (robots.isDisallowed(url, config.http.userAgent)) {
      return {
        ...jobInfo,
        status : 'not_ok' as const,
        details : {crawlId, ts : Date.now()},
        err : new RobotsForbiddenError()
      };
    }

    let res = await this.fetchResource(url);

    if (res.status === 'ok') {
      jobResult = {
        ...jobInfo,
        status : 'ok',
        details : {crawlId, triples : res.triples, ts : res.ts}
      };
    } else {
      jobResult = {
        ...jobInfo,
        status : 'not_ok' as const,
        details : {crawlId, ts : Date.now()},
        err : res.err
      };
    }
    return jobResult as CrawlResourceResult;
  }

  async fetchResource(url: string) {
    let res = await this.makeHttpRequest(url);
    if (res.status === 'ok') {
      const {triples} = await parseRdf(res.rdf, res.mime);
      return {...res, triples};
    }
    return res;
  }

  makeHttpRequest =
      async(url: string, redirect = 0): Promise<HttpRequestResult> => {
    const timeout = config.http.domainCrawl.timeouts || 10 * 1000;
    const maxRedirects = config.http.domainCrawl.maxRedirects || 5;
    const headers = {
      'User-Agent' : config.http.userAgent,
      'Accept' : this.accept
    };
    try {
      await delay();
      this.emit('httpDebug', {
        wId : this.wId,
        type : 'request',
        url,
        ts : new Date(),
        domain : new URL(url).origin
      });
      const opts = {
        headers,
        // prevent axios of parsing [ld+]json
        transformResponse : (x: any) => x,
        timeout,
        maxRedirects
      };
      const resp = await axios.get(url, opts);
      const mime = contentType.parse(resp.headers['content-type']).type;
      if (!acceptedMimeTypes.some(aMT => mime === aMT)) {
        const newUrl = findRedirectUrl(resp.headers, resp.data);
        if (!newUrl) {
          throw new MimeTypeError(mime);
        }
        if (redirect >= maxRedirects) {
          throw new TooManyRedirectsError(url);
        } // TODO list of redirect URLs?
        return this.makeHttpRequest(newUrl, redirect + 1);
      }
      return {
        status : 'ok',
        rdf : resp.data,
        ts : resp.headers['request-endTime'],
        mime
      };
    } catch (err) {
      return handleHttpError(url, err);
    }
  }
};
