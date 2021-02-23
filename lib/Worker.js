const redis = require('redis');
const Axios = require('../lib/axios');
const axios = Axios();
const pid = require('process').pid;
const Promise = require('bluebird');
const config = require('../config');

class Worker {
  constructor(opts = {}){
    this._id = 'W#'+pid;
    this._jobCapacity = config.workers.jobs;
    this._currentJobs = {
      domainCrawl: 0,
      domainCheck: 0,
    };

    this.log('Started');
    this.connect();
    this.askJobs();
  }

  connect(){
    this.log('Connecting to Redis');
    this._pub = redis.createClient();
    this._sub = redis.createClient();

    process.on('SIGINT', () => {
      this.pub('shutdown');
      process.exit();
    });

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
      if(payload.type === 'doJobs'){
        console.log('XXXXXXXXXXXXXXXXXx 1');
        return this.doJobs(payload.data);
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

  doJobs(jobs){
    for(const job of Object.values(jobs)){
      this.doJob(job);
    }
  }

  async doJob(job){
    let res;
    if(job.jobType === 'domainCheck'){
      res = await this.checkDomain(job.host);
    //} else if(job.jobType === 'domainCrawl') {
    }
    this.pub('jobDone', {
      jobType: job.jobType,
      host: job.host,
      results: res
    });
  }

  async checkDomain(host){
    const url = host+'/robots.txt';
    let res = {host}
    const reqStart = Date.now();
    await axios.get(url, {headers: {'User-Agent': config.userAgent}})
      .then(resp => {
        res.endTime = resp.headers['request-endTime'];
        res.elapsedTime = resp.headers['request-duration'];
        res.actualHost = resp.request.host;
        res.protocol = resp.request.protocol;
        res.robots = resp.data;
        res.status = resp.status;
        res.ok = true;
      })
      .catch(err => {
        res.endTime = err.response.headers['request-endTime'];
        res.elapsedTime = err.response.headers['request-duration'];
        res.actualHost = err.response.request.host;
        res.protocol = err.response.request.protocol;

        res.status = err.response.status;
        res.error = true;
      });
    return res;
  };


  // _crawlDomain({domain,resources}){
  //   const robots = robotsParser(domain.host+'/robots.txt', domain.robots);
  //   Promise.each(resources, (r) => {
  //     let res = {};

  //     if(robots.isAllowed(r.url, config.userAgent)){
  //       return new Promise.delay(domain.crawlDelay*1000)
  //         .then(() => axios.get(r.url, {headers: {'User-Agent': config.userAgent}}))
  //         .then(resp => this._parseResource(resp.data))
  //         .then(({resources,triples}) => {
  //           res.url = r.url;
  //           //res.status = resp.status;
  //           res.ok = true;
  //           res.resources = resources;
  //           res.triples = triples;

  //           this.pub('resource_info', res);
  //         })
  //         .catch(err => console.log(err));
  //     }
  //   });
  // }

  // _parseResource(rdf){
  //   return new Promise((resolve, reject) => {
  //     parser.parse(resp.data, (err, quad, prefs) => {
  //       if(err){ reject(err); }
  //       else if(prefs){
  //         resolve({
  //           resources: Object.keys(resources),
  //           trip: triples
  //         });
  //       } else {
  //         triples.push(quad);
  //         resources[quad.subject.value] = true;
  //         resources[quad.predicate.value] = true;
  //         if(quad.object.termType === 'NamedNode'){
  //           resources[quad.object.value] = true;
  //         }
  //       }
  //     });
  //   });
  // }

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
