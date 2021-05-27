const Promise = require('bluebird');
const robotsParser = require('robots-parser');
const EventEmitter = require('events');
const config = require('../config');
const Axios = require('./axios');
let axios;
const contentType = require('content-type');
const parseRdf = require('./parse-rdf');
const logger = require('../../common/lib/logger');
const cheerio = require('cheerio');
let log;
const {
  WorkerError,
  HttpError,
  DomainNotFoundError,
  MimeTypeError,
  ConnectionResetError,
  RobotsForbiddenError,
  TimeoutError,
  TooManyRedirectsError} = require('../../common/lib/errors');
const acceptedMimeTypes = config.http.acceptedMimeTypes;
const setupDelay = require('./delay');
let delay = () => Promise.resolve();
const LinkHeader = require('http-link-header');
const {v4: uuidv4} = require('uuid');


class Worker extends EventEmitter {
  constructor(wId){
    super();
    this.wId = uuidv4();
    this.wShortId = this.wId.replace(/-.*$/, '');
    log = logger(this.wShortId);
    axios = Axios(log);
    this.jobCapacity = config.jobs;
    this.currentJobs = {domainCrawl: {}, robotsCheck: {}};
    this.accept = acceptedMimeTypes
                    .map((m, i) => `${m}; q=${Math.round(100/(i+2))/100}`)
                    .join(', ');
  }

  availability(){
    const domCrawlCap = this.jobCapacity.domainCrawl.capacity;
    const robCheckCap = this.jobCapacity.robotsCheck.capacity;
    const curDomCrawl = Object.keys(this.currentJobs.domainCrawl).length;
    const curRobCheck = Object.keys(this.currentJobs.robotsCheck).length;
    const av = {
      domainCrawl: domCrawlCap - curDomCrawl,
      robotsCheck: robCheckCap - curRobCheck
    };
    return av;
  }

  status(){
    return {
      availability: this.availability(),
      currentJobs: this.currentJobs
    };
  }

  hasCapacity(jobType){
    return Object.keys(this.currentJobs[jobType]).length < this.jobCapacity[jobType].capacity;
  }

  async checkRobots(domain){
    this.currentJobs.robotsCheck[domain] = true;

    const url = domain+'/robots.txt';
    try {
      const res = await fetchRobots(url);
      delete this.currentJobs.robotsCheck[domain];
      return res;
    }
    catch(err){
      delete this.currentJobs.robotsCheck[domain];
      return err;
    }
  };

  async *crawlDomain({domain,resources}){
    this.crawlTs = new Date();
    this.crawlCounter = 0;
    this.currentJobs.domainCrawl[domain.origin] = true;
    const robotsText = domain?.robots?.text || '';
    const robots = robotsParser(domain.origin+'/robots.txt', robotsText);

    this.emit('httpDebug', {type: 'delay', domain: domain.origin, delay: domain.crawl.delay});
    delay = setupDelay(domain.crawl.delay*1.1); // add 10% margin

    for(const r of resources){
      this.crawlCounter++;
      this.currentJobs.domainCrawl[domain.origin] = true;
      try {
        robotsAllow(robots, r.url, config.http.userAgent);
        const details = await this.crawlResource(r);
        delete this.currentJobs.domainCrawl[domain.origin];
        yield {
          url: r.url,
          results: {
            ok: true,
            details: {
              ...details,
              crawlId: {
                domainTs: this.crawlTs,
                counter: this.crawlCounter
              }
            }
          }
        };
      }
      catch (err) {
        delete this.currentJobs.domainCrawl[domain.origin];
        yield {
          url: r.url,
          results: {
            ...err,
            details: {
              ts: Date.now(),
              crawlId: {
                domainTs: this.crawlTs,
                counter: this.crawlCounter
              },
            }
          }
        };
      }
    }
  }

  async crawlResource(r){
    const resp = await this.makeHttpRequest(r.url);
    const res = await parseRdf(resp.rdf, resp.mime);
    return {ts: resp.ts, ...res};
  }

  makeHttpRequest = async (url, redirect=0) => {
    let res;
    const reqStart = Date.now();
    const timeout = config.http.domainCrawl.timeout || 10*1000;
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
        transformResponse: x => x,
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
    catch(err) { handleHttpError(url, err); }
  }
};

const handleHttpError = (url, err) => {
  if(err.response){
    let e = new HttpError(err.response.status);
    const details = {
      endTime: err.response.headers['request-endTime'],
      elapsedTime: err.response.headers['request-duration']
    };
    throw {url, error: e, details};
  }
  if(err.code && err.code === 'ECONNABORTED'){
    throw {url, error: new TimeoutError(config.http.robotsCheck.timeouts)};
  }
  if(err.code && err.code === 'ENOTFOUND'){
    throw {url, error: new DomainNotFoundError()};
  }
  if(err.code && err.code === 'ECONNRESET'){
    throw {url, error: new ConnectionResetError()};
  }
  if(err.name === 'TypeError' && err.response ){
    throw {url, error: new MimeTypeError(err.response.headers['content-type'])};
  }
  if(err instanceof WorkerError){
    throw {error: err, url};
  }
  throw {error: new WorkerError(), url, details: {message:err.message, stack: err.stack}};
};

const fetchRobots = async url => {
  const reqStart = Date.now();
  const timeout = config.http.robotsCheck.timeout || 10*1000;
  const maxRedirects = config.http.robotsCheck.maxRedirects || 5;
  const headers = {'User-Agent': config.http.userAgent};
  return axios.get(url, {headers, timeout, maxRedirects})
    .then(resp => ({
      details: {
        endTime: resp.headers['request-endTime'],
        elapsedTime: resp.headers['request-duration'],
        robots: resp.data,
        status: resp.status,
      },
      ok: true
    }))
    .catch(err => handleHttpError(url, err));
};


const robotsAllow = (robots, url, userAgent) => {
  if(!robots.isAllowed(url, userAgent)){
    throw new RobotsForbiddenError();
  }
};


const findRedirectUrl = resp => {
  // check Link header
  if(resp.headers['Link']){
    const links = LinkHeader.parse(resp.headers['Link']);
    const link = links.find(l => l.rel === 'alternate' && acceptedMimeTypes.some(aMT => l.type === aMT));
    if(link){ return l.uri; }
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

module.exports = Worker;
