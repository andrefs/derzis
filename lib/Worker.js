const Promise = require('bluebird');
const N3 = require('n3');
const parser = new N3.Parser();
const robotsParser = require('robots-parser');
const config = require('../config');
const Axios = require('./axios');
let axios;
const logger = require('./logger');
let log;

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

  async checkDomain(host){
    this.currentJobs.domainCheck[host] = true;
    const url = host+'/robots.txt';
    let res = {host};
    const reqStart = Date.now();
    await axios.get(url, {headers: {'User-Agent': config.userAgent}})
      .then(resp => {
        res.endTime = resp.headers['request-endTime'];
        res.elapsedTime = resp.headers['request-duration'];
        res.robots = resp.data;
        res.status = resp.status;
        res.ok = true;
      })
      .catch(err => {
        res.endTime = err.response.headers['request-endTime'];
        res.elapsedTime = err.response.headers['request-duration'];
        res.status = err.response.status;
        res.error = true;
      });
    delete this.currentJobs.domainCheck[host];
    return res;
  };

  async *crawlDomain({domain,resources}){
    this.currentJobs.domainCrawl[domain.host] = true;
    const robots = domain.robots ?
      robotsParser(domain.host+'/robots.txt', domain.robots.text) :
      null;

    for(const r of resources){
      const urlAllowed = !domain.robots || robots.isAllowed(r.url, config.userAgent);
      if(!urlAllowed){
        yield {error: true, error_type: 'robots_not_allowed'};
        continue;
      }
      await Promise.delay(domain.crawl.delay*1000);
      const resp = await axios.get(r.url, {headers: {
        'User-Agent': config.userAgent,
        'Accept': 'text/turtle' // TODO
      }});
      const {resources, triples} = await parseResource(resp.data);
      const res = {
        url: r.url,
        resources: resources.sort(), // TODO remove sort
        triples
      };
      yield res;
    }
    delete this.currentJobs.domainCrawl[domain.host];

    return;
  }

  // crawlDomain({domain,resources}){
  //   this._currentJobs.domainCrawl[domain.host] = true;
  //   const robots = domain.robots ?
  //     robotsParser(domain.host+'/robots.txt', domain.robots.text) :
  //     null;
  //   return Promise.each(resources, (r) => {
  //     let res = {};

  //     const urlAllowed = !domain.robots || robots.isAllowed(r.url, config.userAgent);
  //     if(urlAllowed){
  //       return new Promise.delay(domain.crawl.delay*1000)
  //         .then(() => axios.get(r.url, {headers: {
  //           'User-Agent': config.userAgent,
  //           'Accept': 'text/turtle' // TODO
  //         }}))
  //         .then(resp => this._parseResource(resp.data))
  //         .then(({resources,triples}) => {
  //           res.url = r.url;
  //           //res.status = resp.status;
  //           res.ok = true;
  //           res.resources = resources.sort(); // TODO remove
  //           res.triples = triples;

  //           this.pub('jobDone', {
  //             jobType: 'resourceCrawl',
  //             host: domain.host,
  //             url: r.url,
  //             results: res
  //           });
  //         })
  //         .catch(err => console.log(err));
  //     }
  //   })
  //   .then(() => this.pub('jobDone', {
  //     jobType: 'domainCrawl',
  //     host: domain.host
  //   }))
  //   .catch(console.log);

  //   delete this._currentJobs.domainCrawl[domain.host];
  // }
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



module.exports = Worker;
