const redis = require('redis');
const Axios = require('../lib/axios');
const axios = Axios();
const N3 = require('n3');
const parser = new N3.Parser();
const robotsParser = require('robots-parser');
const pid = require('process').pid;
const Promise = require('bluebird');
const config = require('../config');

class Worker {
  constructor(opts = {}){
    this._id = 'W#'+pid;
    this._jobCapacity = config.workers.jobs;
    this._currentJobs = {domainCrawl: {}, domainCheck: {}};

    this.log('Started');
    this.connect();
    this.askJobs();
  }

  connect(){
    this.log('Connecting to Redis');
    this._pub = redis.createClient();
    this._sub = redis.createClient();

    this.exitHandler = (opts = {}) => {
      return exitCode => {
        console.log(pid, {opts}, this._currentJobs);
        this.pub('shutdown', {ongoingJobs: this._currentJobs});
        process.exit(exitCode || 0);
      };
    };

    process.on('SIGINT'            , this.exitHandler({signal: 'SIGINT'}));
    //process.on('exit'              , this.exitHandler({signal: 'exit'}));
    process.on('uncaughtException' , this.exitHandler({signal: 'uncaughtException'}));
    process.on('SIGUSR1'           , this.exitHandler({signal: 'SIGUSR1'}));
    process.on('SIGUSR2'           , this.exitHandler({signal: 'SIGUSR2'}));

    this.log(`Subscribing to\n\t${config.pubsub.manager.from}\n\t${config.pubsub.workers.to+this._id}`);
    this._sub.subscribe(config.pubsub.manager.from, config.pubsub.workers.to+this._id);

    this._pubChannel = config.pubsub.workers.from+this._id;
    this.log(`Publishing to ${this._pubChannel}`);

    this._subEvents();
  }

  log(...messages){
    console.info(`[${this._id}]`, ...messages);
  }

  pub(type, data = {}){
    const payload = {type, data};
    this.log('Publishing', this._pubChannel, payload);
    this._pub.publish(this._pubChannel, JSON.stringify(payload));
  }

  _subEvents(){
    const dispatch = {
      get_status: this._sendStatus
    };
    this._sub.on('message', (channel, message) => {
      this.log('Got', channel, message);
      const payload = JSON.parse(message);
      if(payload.type === 'getStatus'){
        return this.askJobs(payload.data);
      }
      if(payload.type === 'doJob'){
        return this.doJob(payload.data);
      }
      if(payload.type === 'domainCheck'){
        if(this._checkCapacity(payload.type, payload.data)){
          return this._domainCheck(payload.data);
        }
      }
      if(payload.type === 'domainCrawl'){
        if(this._checkCapacity(payload.type)){
          return this._crawlDomain(payload.data);
        }
      }
    });
  }

  hasCapacity(jobTypejobInfo){
    return Object.keys(this._currentJobs[jobType]).length < this._jobCapacity[jobType].capacity;
  }

  async doJob(job){
    let res;
    if(job.jobType === 'domainCheck'){
      this._currentJobs.domainCheck[job.host] = true;
      res = await this.checkDomain(job.host);
      this.pub('jobDone', {
        jobType: job.jobType,
        host: job.host,
        results: res
      });
      delete this._currentJobs.domainCheck[job.host];
    }
    else if(job.jobType === 'domainCrawl'){
      this._currentJobs.domainCrawl[job.domain.host] = true;
      await this.crawlDomain(job);
      delete this._currentJobs.domainCrawl[job.domain.host];
    }
  }

  async checkDomain(host){
    const url = host+'/robots.txt';
    let res = {host}
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
    return res;
  };


  crawlDomain({domain,resources}){
    const robots = domain.robots ?
      robotsParser(domain.host+'/robots.txt', domain.robots.text) :
      null;
    return Promise.each(resources, (r) => {
      let res = {};

      const urlAllowed = !domain.robots || robots.isAllowed(r.url, config.userAgent);
      if(urlAllowed){
        return new Promise.delay(domain.crawl.delay*1000)
          .then(() => axios.get(r.url, {headers: {
            'User-Agent': config.userAgent,
            'Accept': 'text/turtle' // TODO
          }}))
          .then(resp => this._parseResource(resp.data))
          .then(({resources,triples}) => {
            res.url = r.url;
            //res.status = resp.status;
            res.ok = true;
            res.resources = resources;
            res.triples = triples;

            this.pub('jobDone', {
              jobType: 'resourceCrawl',
              host: domain.host,
              url: r.url,
              results: res
            });
          })
          .catch(err => console.log(err));
      }
    })
    .then(() => this.pub('jobDone', {
      jobType: 'domainCrawl',
      host: domain.host
    }))
    .catch(console.log);
  }

  _parseResource(rdf){
    let resources = {};
    let triples = [];
    return new Promise((resolve, reject) => {
      parser.parse(rdf, (err, quad, prefs) => {
        if(err){
          return reject(err);
        }
        else if(prefs){
          resolve({
            resources: Object.keys(resources),
            triples
          });
        } else {
          triples.push(quad);
          resources[quad.subject.value] = true;
          resources[quad.predicate.value] = true;
          if(quad.object.termType === 'NamedNode'){
            resources[quad.object.value] = true;
          }
        }
      });
    });
  }

  statusReport(){
    const availability = {
      domainCrawl: this._jobCapacity.domainCrawl.capacity - Object.keys(this._currentJobs.domainCrawl).length,
      domainCheck: this._jobCapacity.domainCheck.capacity - Object.keys(this._currentJobs.domainCheck).length
    };
    return availability;
  }

  askJobs(){
    this.pub('askJobs', this.statusReport());
  }

};

module.exports = Worker;
