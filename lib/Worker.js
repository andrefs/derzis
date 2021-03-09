const Promise = require('bluebird');
const robotsParser = require('robots-parser');
const config = require('../config');
const Axios = require('./axios');
let axios;
const contentType = require('content-type');
const parseRdf = require('./parse-rdf');
const logger = require('./logger');
const cheerio = require('cheerio');
let log;
const {
  HttpError,
  MimeTypeError,
  ConnectionResetError,
  RobotsForbiddenError,
  TimeoutError,
  TooManyRedirectsError} = require('./errors');
const acceptedMimeTypes = config.http.acceptedMimeTypes;
const setupDelay = require('./delay');
let delay = () => Promise.resolve();
const LinkHeader = require('http-link-header');


class Worker {
  constructor(wId){
    this.wId = wId;
    log = logger(this.wId);
    axios = Axios(log);
    this.jobCapacity = config.workers.jobs;
    this.currentJobs = {domainCrawl: {}, domainCheck: {}};
  }

  availability(){
    const domCrawlCap = this.jobCapacity.domainCrawl.capacity;
    const domCheckCap = this.jobCapacity.domainCheck.capacity;
    const curDomCrawl = Object.keys(this.currentJobs.domainCrawl).length;
    const curDomCheck = Object.keys(this.currentJobs.domainCheck).length;
    const av = {
      domainCrawl: domCrawlCap - curDomCrawl,
      domainCheck: domCheckCap - curDomCheck
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

  async checkDomain(host){
    this.currentJobs.domainCheck[host] = true;

    const url = host+'/robots.txt';
    const res = await fetchRobots(url);
    delete this.currentJobs.domainCheck[host];
    return res;
  };

  async *crawlDomain({domain,resources}){
    this.currentJobs.domainCrawl[domain.host] = true;
    const robotsText = domain?.robots?.text || '';
    const robots = robotsParser(domain.host+'/robots.txt', robotsText);

    delay = setupDelay(domain.crawl.delay*1000);

    for(const r of resources){
      this.currentJobs.domainCrawl[domain.host] = true;
      try {
        robotsAllow(robots, r.url, config.http.userAgent);
        const details = await this.crawlResource(r);
        delete this.currentJobs.domainCrawl[domain.host];
        yield {ok: true, url: r.url, details};
      }
      catch (err) {
        delete this.currentJobs.domainCrawl[domain.host];
        yield err;
      }
    }
  }

  async crawlResource(r){
    const resp = await makeHttpRequest(r.url);
    const res = await parseRdf(resp.rdf, resp.mime);
    return res;
  }
};

const fetchRobots = async url => {
  let res = {};
  const reqStart = Date.now();
  const timeout = config.http.domainCheck.timeout || 10*1000;
  const maxRedirects = config.http.domainCheck.maxRedirects || 5;
  const headers = {'User-Agent': config.http.userAgent};
  await axios.get(url, {headers, timeout, maxRedirects})
    .then(resp => {
      res = {
        details: {
          endTime: resp.headers['request-endTime'],
          elapsedTime: resp.headers['request-duration'],
          robots: resp.data,
          status: resp.status,
        },
        ok: true
      };
    })
    .catch(err => {
      if(err.response){
        res = {
          error: new HttpError(err.response.status),
          url,
          details: {
            endTime: err.response.headers['request-endTime'],
            elapsedTime: err.response.headers['request-duration']
          }
        };
      }
      else if(err.code && err.code === 'ECONNABORTED'){
        res = {
          error: new TimeoutError(config.timeouts.domainCheck),
          details: {
            endTime: err.response.headers['request-endTime'],
            elapsedTime: err.response.headers['request-duration']
          }
        };
      }
      else if(err.request){
        console.log('XXXXXXXXXXXXXXXXxx 2'); // TODO
      } else {
        console.log('XXXXXXXXXXXXXXXXxx 3', err);
      }
    });
  return res;
};


const robotsAllow = (robots, url, userAgent) => {
  if(!robots.isAllowed(url, userAgent)){
    throw new  RobotsForbiddenError();
  }
};

const makeHttpRequest = async (url, redirect=0) => {
  let res;
  const reqStart = Date.now();
  const timeout = config.http.domainCrawl.timeout || 10*1000;
  const maxRedirects = config.http.domainCrawl.maxRedirects || 5;
  const accept = acceptedMimeTypes.map((m, i) => `${m}; q=${Math.round(100/(i+2))/100}`);
  const headers = {
    'User-Agent': config.http.userAgent,
    'Accept': accept.join(', ')
  };
  try{
    await delay();
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
      return makeHttpRequest(newUrl, redirect+1);
    }
    return {rdf: resp.data, mime};
  }
  catch(err) {
    if(err.response){
      let e = new HttpError(err.response.status);
      const details = {
        endTime: err.response.headers['request-endTime'],
        elapsedTime: err.response.headers['request-duration']
      };
      throw {url, error: e, details};
    }
    if(err.code && err.code === 'ECONNABORTED'){
      throw {url, error: new TimeoutError(config.http.domainCheck.timeouts)};
    }
    if(err.code && err.code === 'ECONNRESET'){
      throw {url, error: new ConnectionResetError()};
    }
    if(err.name === 'TypeError' && err.response ){
      throw {url, error: new MimeTypeError(err.response.headers['content-type'])};
    }

    throw {error: err.toString(), error_type: 'unknown_error', url};
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
        return link[0].attr('href');
      }
    }
  }

};

module.exports = Worker;
