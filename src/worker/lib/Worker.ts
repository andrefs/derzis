import Bluebird from "bluebird";
import robotsParser, { Robot } from 'robots-parser';
import EventEmitter from 'events';
import config from '@derzis/config';
import Axios from './axios';
import { AxiosInstance, AxiosResponse } from "axios";
let axios: AxiosInstance;
import contentType from 'content-type';
import parseRdf from './parse-rdf';
import {createLogger} from '@derzis/common'
import cheerio from 'cheerio';
import winston from "winston";
let log: winston.Logger;
import {
  WorkerError,
  HttpError,
  DomainNotFoundError,
  MimeTypeError,
  ConnectionResetError,
  RobotsForbiddenError,
  TimeoutError,
  TooManyRedirectsError} from '@derzis/common';
const acceptedMimeTypes = config.http.acceptedMimeTypes;
import setupDelay from './delay';
let delay = () => Bluebird.resolve();
import LinkHeader from 'http-link-header';
import {v4 as uuidv4} from 'uuid';
import { IDomain } from '@derzis/models';
import * as RDF from "@rdfjs/types";

interface JobResult {
  ok: boolean;
  jobType: 'domainCrawl' | 'resourceCrawl' | 'robotsCheck',
  domain: string,
};

interface JobResultOk extends JobResult {
  ok: true,
  details: object
};

interface JobResultError extends JobResult {
  ok: false,
  err: object,
  details?: object
};

type BaseCrawlResourceResult = {
  jobType: 'resourceCrawl',
  details: {
    crawlId: {
      domainTs: Date,
      counter: number
    },
    ts: number,
  }
} & JobResult;
type CrawlResourceResultOk = { details: { triples: RDF.Quad[] }} & BaseCrawlResourceResult & JobResultOk;
type CrawlResourceResultError = { err: object } & BaseCrawlResourceResult & JobResultError;
type CrawlResourceResult = CrawlResourceResultOk | CrawlResourceResultError;

type BaseRobotsCheckResult = {
  jobType:'robotsCheck',
  url: string,
};
type RobotsCheckResultOk = {
  details: {
    endTime: Date,
    elapsedTime: number,
    robots: object,
    status: number
  }
} & BaseRobotsCheckResult & JobResultOk;
type RobotsCheckResultError = {
  err: WorkerError,
  details?:{
    endTime?: Date,
    elapsedTime?: number,
    message?: string,
    stack?: any
  }
} & BaseRobotsCheckResult & JobResultError;
type RobotsCheckResult = RobotsCheckResultOk | RobotsCheckResultError;



export interface Availability {
  currentCapacity: JobCapacity,
  currentJobs: CurrentJobs
}

export interface JobCapacity {
  domainCrawl: {
    capacity: number;
    resourcesPerDomain: number;
  };
  robotsCheck: {
    capacity: number;
  };
};

interface Resource {
  url: string
};

export type JobType = 'domainCrawl' | 'robotsCheck' | 'resourceCrawl';
export type Job = RobotsCheckJob | ResourceCrawlJob | DomainCrawlJob;

interface RobotsCheckJob {
  domain: string,
  //results
};

interface ResourceCrawlJob {
  domain: string,
  url: string,
  //results
};

interface DomainCrawlJob {
  domain: IDomain,
  resources: {url: string}[]
};

interface CurrentJobs {
  domainCrawl: {
    [domain: string]: boolean
  },
  robotsCheck: {
    [domain: string]: boolean
  }
}

interface JobsTimedOut {
  [domain: string]: boolean
}

export class Worker extends EventEmitter {
  wId: string;
  wShortId: string;
  jobCapacity: JobCapacity;
  currentJobs: CurrentJobs;
  accept: string;
  jobsTimedout: JobsTimedOut;
  crawlTs: Date;
  crawlCounter: number;

  constructor(wId: string){
    super();
    this.wId = uuidv4();
    this.wShortId = this.wId.replace(/-.*$/, '');
    log = createLogger(this.wShortId);
    axios = Axios(log);
    this.jobCapacity = config.jobs;
    this.currentJobs = {domainCrawl: {}, robotsCheck: {}};
    this.accept = acceptedMimeTypes
                    .map((m, i) => `${m}; q=${Math.round(100/(i+2))/100}`)
                    .join(', ');
    this.jobsTimedout = {};
  }

  currentCapacity(): JobCapacity{
    const domCrawlCap = this.jobCapacity.domainCrawl.capacity;
    const robCheckCap = this.jobCapacity.robotsCheck.capacity;
    const curDomCrawl = Object.keys(this.currentJobs.domainCrawl).length;
    const curRobCheck = Object.keys(this.currentJobs.robotsCheck).length;
    const av = {
      domainCrawl: {
        capacity: domCrawlCap - curDomCrawl,
        resourcesPerDomain: this.jobCapacity.domainCrawl.resourcesPerDomain
      },
      robotsCheck: {
        capacity: robCheckCap - curRobCheck,
      }
    };
    return av;
  }

  status(): Availability {
    return {
      currentCapacity: this.currentCapacity(),
      currentJobs: this.currentJobs
    };
  }

  hasCapacity(jobType: JobType): boolean {
    return Object.keys(this.currentJobs[jobType]).length < this.jobCapacity[jobType].capacity;
  }

  async checkRobots(domain: string): Promise<RobotsCheckResult> {
    this.currentJobs.robotsCheck[domain] = true;

    const url = domain+'/robots.txt';
    const res = await fetchRobots(url);
    delete this.currentJobs.robotsCheck[domain];
    return {
      ...res,
      url,
      domain,
      jobType: 'robotsCheck'
    };
  };

  async *crawlDomain({domain,resources}: DomainCrawlJob){
    this.crawlTs = new Date();
    this.crawlCounter = 0;
    this.currentJobs.domainCrawl[domain.origin] = true;
    const robotsText = domain?.robots?.text || '';
    const robots = robotsParser(domain.origin+'/robots.txt', robotsText);

    this.emit('httpDebug', {type: 'delay', domain: domain.origin, delay: domain.crawl.delay});
    delay = setupDelay(domain.crawl.delay*1000*1.1); // ms to s, add 10% margin

    for(const r of resources){
      const res = await this.crawlResource(domain.origin, r.url, robots );
      if(!res){ break; }
      yield res;
    }
    delete this.currentJobs.domainCrawl[domain.origin];
  }

  async crawlResource(origin: string , url: string, robots: Robot): Promise<CrawlResourceResult> {
    if(this.jobsTimedout[origin]){
      delete this.jobsTimedout[origin];
      delete this.currentJobs.domainCrawl[origin];
      log.warn(`Stopping domain ${origin} because Manager removed job`);
      return;
    }
    this.crawlCounter++;
    this.currentJobs.domainCrawl[origin] = true;
    const crawlId = {
      domainTs: this.crawlTs,
      counter: this.crawlCounter
    };
    const jobInfo = {
      jobType: 'resourceCrawl' as const,
      domain: origin,
    };
    let jobResult: CrawlResourceResult;
    try {  
      robotsAllow(robots, url, config.http.userAgent);
      const {triples, ts} = await this.fetchResource(r);
      jobResult = {
        ...jobInfo,
        ok: true,
        details: { crawlId, triples, ts }
      };
    } catch (err) {
      jobResult = {
        ...jobInfo,
        ok: false,
        details: { crawlId, ts: Date.now() },
        err
      };
    }
    return jobResult as CrawlResourceResult;
  }

  async fetchResource({url}: Resource){
    const resp = await this.makeHttpRequest(url);
    const res = await parseRdf(resp.rdf, resp.mime);
    return {ts: resp.ts, ...res};
  }

  makeHttpRequest = async (url: string, redirect=0) => {
    let res;
    const reqStart = Date.now();
    const timeout = config.http.domainCrawl.timeouts || 10*1000;
    const maxRedirects = config.http.domainCrawl.maxRedirects || 5;
    const headers = {
      'User-Agent': config.http.userAgent,
      'Accept': this.accept
    };
    try{
      await delay();
      this.emit('httpDebug', {wId: this.wId, type: 'request', url, ts: new Date(), domain: new URL(url).origin});
      const opts = {
        headers,
        // prevent axios of parsing [ld+]json
        transformResponse: (x: any) => x,
        timeout,
        maxRedirects
      };
      const resp = await axios.get(url, opts);
      const mime = contentType.parse(resp.headers['content-type']).type;
      if(!acceptedMimeTypes.some(aMT => mime === aMT)){
        const newUrl = findRedirectUrl(resp);
        if(!newUrl){ throw new MimeTypeError(mime); }
        if(redirect >= maxRedirects){ throw new TooManyRedirectsError(url); } // TODO list of redirect URLs?
        return this.makeHttpRequest(newUrl, redirect+1);
      }
      return {rdf: resp.data, ts: resp.headers['request-endTime'], mime};
    }
    catch(err) { return handleHttpError(url, err); }
  }
};

const handleHttpError = (url: string, err) => {
  if(err.response){
    let e = new HttpError(err.response.status);
    const details = {
      endTime: err.response.headers['request-endTime'],
      elapsedTime: err.response.headers['request-duration']
    };
    return {url, err: e, details};
  }
  if(err.code && err.code === 'ECONNABORTED'){
    return {url, err: new TimeoutError(config.http.robotsCheck.timeouts)};
  }
  if(err.code && err.code === 'ENOTFOUND'){
    return {url, err: new DomainNotFoundError()};
  }
  if(err.code && err.code === 'ECONNRESET'){
    return {url, err: new ConnectionResetError()};
  }
  if(err.name === 'TypeError' && err.response ){
    return {url, err: new MimeTypeError(err.response.headers['content-type'])};
  }
  if(err instanceof WorkerError){
    return {err: err, url};
  }
  return {err: new WorkerError(), url, details: {message:err.message, stack: err.stack}};
};

const fetchRobots = async (url: string) => {
  const timeout = config.http.robotsCheck.timeouts || 10*1000;
  const maxRedirects = config.http.robotsCheck.maxRedirects || 5;
  const headers = {'User-Agent': config.http.userAgent};
  let res = await axios.get(url, {headers, timeout, maxRedirects})
    .then(resp => ({
      details: {
        endTime: resp.headers['request-endTime'],
        elapsedTime: resp.headers['request-duration'],
        robots: resp.data,
        status: resp.status,
      },
      ok: true as const
    }))
    .catch(err => ({
      ...handleHttpError(url, err),
      ok: false as const
    }));
  return res;
};

const robotsAllow = (robots:ReturnType<typeof robotsParser>, url: string, userAgent: string) => {
  if(!robots.isAllowed(url, userAgent)){
    throw new RobotsForbiddenError();
  }
};

const findRedirectUrl = (resp: AxiosResponse<any>) => {
  // check Link header
  if(resp.headers['Link']){
    const links = LinkHeader.parse(resp.headers['Link']);
    const link = links.refs.find(l => l.rel === 'alternate' && acceptedMimeTypes.some(aMT => l.type === aMT));
    if(link){ return link.uri; }
  }

  // html
  const mime = contentType.parse(resp.headers['content-type']).type;
  if(mime === 'text/html'){
    const $ = cheerio.load(resp.data);
    for(const mime of config.http.acceptedMimeTypes){
      // <link> tags
      const link = $(`link[rel="alternate"][type="${mime}"]`);
      if(link.length){
        return link.first().attr('href');
      }
    }
  }

};

