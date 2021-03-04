const Promise = require('bluebird');
const N3 = require('n3');
const parser = new N3.Parser();
const robotsParser = require('robots-parser');
const config = require('../config');
const Axios = require('./axios');
let axios;
const logger = require('./logger');
let log;
const {HttpError, RobotsForbiddenError, TooManyRedirectsError} = require('./errors');
const acceptedMimeTypes = new RegExp(config.http.acceptedMimeTypes.join('|'));
const setupDelay = require('./delay');
let delay = () => Promise.resolve();

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
    const robotsText = domain.robots || '';
    const robots = robotsParser(domain.host+'/robots.txt', robotsText);

    delay = setupDelay(domain.crawl.delay*1000);

    for(const r of resources){
      this.currentJobs.domainCrawl[domain.host] = true;
      try {
        robotsAllow(robots, r.url, config.http.userAgent);
        const res = await this.crawlResource(r);
        delete this.currentJobs.domainCrawl[domain.host];
        yield res;
      }
      catch (err) {
        delete this.currentJobs.domainCrawl[domain.host];
        yield err;
      }
    }
  }

  async crawlResource(r){
    const resp = await makeHttpRequest(r.url);
    const {triples} = await parseResource(resp.rdf);
    const res = {
      url: r.url,
      triples
    };
    return res;
  }
};


const parseResource = rdf => {
  let resources = {};
  let triples = [];
  return new Promise((resolve, reject) => {
    parser.parse(rdf, (err, quad, prefs) => {
      if(err){ return reject(err); }
      else if(prefs){
        resolve({
          resources: Object.keys(resources),
          triples
        });
      }
      else {
        triples.push(quad);
        resources[quad.subject.value] = true;
        resources[quad.predicate.value] = true;
        if(quad.object.termType === 'NamedNode'){
          resources[quad.object.value] = true;
        }
      }
    });
  });
};

const fetchRobots = async url => {
  let res;
  const reqStart = Date.now();
  const timeout = config.http.domainCheck.timeout || 10*1000;
  const maxRedirects = config.http.domainCheck.maxRedirects || 5;
  const headers = {'User-Agent': config.http.userAgent};
  await axios.get(url, {headers, timeout, maxRedirects})
    .then(resp => {
      res = {
        endTime: resp.headers['request-endTime'],
        elapsedTime: resp.headers['request-duration'],
        robots: resp.data,
        status: resp.status,
        ok: true
      };
    })
    .catch(err => {
      if(err.response){
        res = new HttpError(err.response.status);
        res.endTime = err.response.headers['request-endTime'];
        res.elapsedTime = err.response.headers['request-duration'];
      }
      else if(err.code && err.code === 'ECONNABORTED'){
        res = new TimeoutError(config.timeouts.domainCheck);
        res.endTime = err.response.headers['request-endTime'];
        res.elapsedTime = err.response.headers['request-duration'];
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
  const headers = {
    'User-Agent': config.http.userAgent,
    'Accept': 'text/turtle' // TODO
  };
  try{
    await delay();
    const resp = await axios.get(url, {headers, timeout, maxRedirects});
    const mime = resp.headers['content-type'];
    if(!mime.match(acceptedMimeTypes)){
      const newUrl = findRedirectUrl(resp);
      if(!newUrl){ throw new MimeTypeError(mime); }
      if(redirect >= maxRedirects){ throw new TooManyRedirectsError(url); } // TODO list of redirect URLs?
      return makeHttpRequest(newUrl, redirect+1);
    }
    return {ok: true, rdf: resp.data, mime};
  }
  catch(err) {
    if(err.response){
      let e = new HttpError(err.response.status);
      e.endTime = err.response.headers['request-endTime'];
      e.elapsedTime = err.response.headers['request-duration'];
      throw e;
    }
    if(err.code && err.code === 'ECONNABORTED'){
      const e = new TimeoutError(config.timeouts.domainCheck);
      throw e;
    }
    throw err;
  }
  return res;
};

module.exports = Worker;
