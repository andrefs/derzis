const robotsParser = require('robots-parser');
const config = require('../config');
const db = require('./db');
const Domain = require('../models/Domain');
const Triple = require('../models/Triple');
const Path = require('../models/Path');
const Resource = require('../models/Resource');
const log = require('../../common/lib/logger')('Manager');
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;
const CurrentJobs = require('./CurrentJobs');
const {readFile} = require('fs/promises');


class Manager {
  constructor(){
    this.jobs = new CurrentJobs();
    this._savingResults = {
      domainCrawl: 0,
      resourceCrawl: 0,
      robotsCheck: 0
    };
    this._savingResultsByDomain = {};
  }

  async connect(){
    await db.connect();
    return this.insertSeeds();
  }

  async insertSeeds(){
    const text = await readFile(config.seeds.file);
    const seeds = text.toString()
                      .split(/\n+/)
                      .filter(x => !/^\s*$/.test(x))
                      .filter(x => !/^\s*#/.test(x));
    return await Resource.insertSeeds(seeds);
  }

  addToSavingResults(domain, type){
    this._savingResults[type]++;
    this._savingResultsByDomain[domain]++;
  };

  removeFromSavingResults(domain, type){
    this._savingResults[type]--;
    this._savingResultsByDomain[domain]--;
  };

  async updateJobResults(data){
    if(data.jobType === 'robotsCheck'){
      if(this.jobs.deregisterJob(data.domain)){
        this.addToSavingResults['robotsCheck'];
        await this.saveRobots(data);
        this.removeFromSavingResults['robotsCheck'];
      }
    }
    // TODO handle errors
    if(data.jobType === 'domainCrawl'){
      if(this.jobs.deregisterJob(data.domain)){
        this.addToSavingResults['domainCrawl'];
        await Domain.updateOne({origin: data.domain},{
          '$set': {status: 'ready'},
          '$unset': {workerId: ''}
        });
        this.removeFromSavingResults['domainCrawl'];
      }
      // TODO handle errors
    }
    if(data.jobType === 'resourceCrawl'){
      if(this.jobs.postponeTimeout(data.domain)){
        this.addToSavingResults['resourceCrawl'];
        if(data.results.ok){
          await this.saveCrawl(data.url, data.results.details);
        } else {
          await Resource.markAsCrawled(data.url, data.results.details, true);
        }
        this.removeFromSavingResults['resourceCrawl'];
      }
    }
  }

  async saveCrawl(sourceUrl, details){
    const source = await Resource.markAsCrawled(sourceUrl, details);
    const triples = details.triples
                      .filter(t => t.subject.termType === 'NamedNode')
                      .filter(t => t.object.termType  === 'NamedNode')
                      .filter(t => t.object.value  === sourceUrl ||
                                   t.subject.value === sourceUrl)
                      .map(t => ({
                        subject: t.subject.value,
                        predicate: t.predicate.value,
                        object: t.object.value,
                      }));
    if(triples.length){
      await this.saveResources(triples);
      const res = await Triple.upsertMany(sourceUrl, triples);
      if(res.upsertedCount){
        const newTriples = await Triple.find({_id: {'$in': Object.values(res.upsertedIds).map(i => ObjectId(i))}});
        await this.updatePaths(sourceUrl, newTriples);
      }
    }
  }


  async saveResources(triples){
    const resources = {};
    for (const t of triples){
      resources[t.subject] = true;
      resources[t.object] = true;
    }

    return await Resource.addMany(Object.keys(resources).map(u => ({
      url: u,
      domain: new URL(u).origin
    })));
  }

  async updatePaths(sourceUrl, triples){
    const query = {'head.url': sourceUrl, status: 'active'};
    let paths = await Path.find(query);
    await Path.updateMany(query, {status: 'finished'});
    for(const path of paths){
      await this.addHeads(path, triples);
    }
  }

  async addHeads(path, triples){
    let newPaths = {};
    let newHeads = {};

    for(const t of triples){
      if(t.subject === t.object){ continue; }
      if(t.subject !== path.head.url && t.object !== path.head.url){
        continue;
      }

      const newHead = t.subject === path.head.url ? t.object : t.subject;
      const prop = t.predicate;
      if(path.nodes.elems.includes(newHead)){ continue; }
      if(!path.predicates.elems.includes(prop) &&
         path.predicates.count >= config.graph.maxPathProps){
        continue;
      }
      newPaths[prop] = newPaths[prop] || {};
      if(!newPaths[prop][newHead]){
        const nodes = [...path.nodes.elems, newHead];
        const np = {
          seed: path.seed,
          head: {url: newHead},
          predicates: {elems: Array.from(new Set([...path.predicates.elems, prop]))},
          nodes: {elems: nodes},
          parentPath: path
        };
        newPaths[prop][newHead] = np;
      }
    }

    const nps = [];
    Object.values(newPaths).forEach(x => Object.values(x).forEach(y => nps.push(y)));
    if(!nps.length){ return; }

    let paths = await Path.create(nps);
    paths = paths.filter(p => p.status === 'active');

    if(paths.length){
      await Resource.addPaths(paths);

      for(const p of paths){
        if(p.head.alreadyCrawled){
          await this.addExistingHead(p);
        }
      }
    }
    return paths;
  }

  async addExistingHead(path){
    const headResource = Resource.findOne({url: path.head.url}).lean();
    if(headResource.isSeed || path.nodes.elems.includes(headResource.url)){
      await path.markDisabled();
    }
    const props = new Set(path.predicates.elems);
    let betterPathCandidates = await Path.find({
      'seed.url': path.seed.url,
      'head.url': path.head.url,
      'predicates.count': {'$lt': path.predicates.count}
    });
    const foundBetter = betterPathCandidates?.some(pc => pc.predicates.elems.every(pred => props.has(pred)));
    if(foundBetter){
      await path.markDisabled();
    }
    const triples = await Triple.find({nodes: headResource.url});
    await path.markFinished();
    return this.addHeads(path, triples);
  }

  async saveRobots(data){
    let crawlDelay = config.http.crawlDelay || 1;
    let doc = {workerId: undefined};

    if(data.results.ok){
      const robots = robotsParser(data.domain+'/robots.txt', data.results.details.robots);
      crawlDelay = 1000*(robots.getCrawlDelay(config.userAgent) || crawlDelay);

      doc = {
        '$set': {
          'robots.text': data.results.details.robots,
          'robots.checked': data.results.details.endTime,
          'robots.elapsedTime': data.results.details.elapsedTime,
          'robots.status': 'done',
          status: 'ready',
          'crawl.delay': crawlDelay,
          'crawl.nextAllowed': new Date(data.results.details.endTime+(crawlDelay)),
          lastAccessed: data.results.details.endTime
        }, '$unset': {workerId: ''}
      };
    }
    else if(data.results.error.errorType === 'http'){
      let robotStatus = 'error';
      if(data.results.error.httpStatus === 404){ robotStatus = 'not_found'; }

      doc = {
        '$set': {
          'robots.status': robotStatus,
          status: 'ready',
          'crawl.delay': crawlDelay,
          'crawl.nextAllowed': new Date(data.results.details.endTime+(crawlDelay))
        }, '$unset': {workerId: ''}
      };
    } else {
      // TODO store error
      // TODO what should status be?
      doc = {
        '$set': {
          'robots.status': 'error'
        }, '$unset': {workerId: ''}
      };
    }

    return await Domain.findOneAndUpdate({origin: data.domain}, doc, {new: true})
      .catch(err => log.error(err));
  }

  async *domainsToCrawl(workerId, limit){
    let noDomainsFound = true;
    for await(const domain of Domain.domainsToCrawl(workerId, limit)){
      noDomainsFound = false;
      const limit = config.workers?.jobs?.domainCrawl?.resourcesPerDomain || 100;
      //const heads = await Path.find({'head.alreadyCrawled': false, 'head.domain': domain.origin})
      const heads = await Resource.find({
          domain: domain.origin,
          status: 'unvisited',
          headCount: {'$gt': 0}
        })
        .sort('-headCount')
        .select('url')
        .limit(limit)
        .lean();
      yield {domain, resources: heads};
    }
    if(noDomainsFound){
      //log.warn('No domains left to crawl!');
    }
  }

  async *assignJobs(workerId, workerAvail){
    let assignedCheck = 0;
    let assignedCrawl = 0;
    if(workerAvail.robotsCheck){
      for await(const check of Domain.domainsToCheck(workerId, workerAvail.robotsCheck)){
        if(this.jobs.registerJob(check.origin, 'robotsCheck')){
          assignedCheck++;
          yield {jobType: 'robotsCheck', domain: check.origin};
        }
      }
    }
    if(workerAvail.domainCrawl){
      for await(const crawl of this.domainsToCrawl(workerId, workerAvail.domainCrawl)){
        if(crawl?.resources?.length && this.jobs.registerJob(crawl.domain.origin, 'domainCrawl')){
          assignedCrawl++;
          yield {jobType: 'domainCrawl', ...crawl};
        } else {
          //log.info(`No resources to crawl from domain ${crawl.domain.origin}`);
        }
      }
    }
    if(!assignedCheck && !assignedCrawl && !this.jobs.count()){
      log.info('Could not find any domains to check or crawl and there are no outstanding jobs');
      console.log('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX this should be the end!', this._savingResults);
    }
  }
};

module.exports = Manager;
