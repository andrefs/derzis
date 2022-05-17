const robotsParser = require('robots-parser');
const config = require('../config');
const db = require('./db');
const Domain = require('../models/Domain');
const Triple = require('../models/Triple');
const Path = require('../models/Path');
const Resource = require('../models/Resource');
const Process = require('../models/Process');
const log = require('../../common/lib/logger')('Manager');
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;
const CurrentJobs = require('./CurrentJobs');


class Manager {
  constructor(){
    this.jobs = new CurrentJobs();
    this.beingSaved = {
      domainCrawl: 0,
      resourceCrawl: 0,
      robotsCheck: 0,
      count: () => {
        const bs = this.beingSaved;
        return bs.domainCrawl + bs.resourceCrawl + bs.robotsCheck
      }
    };
    this.beingSavedByDomain = {};
    this.finished = 0;
  }

  async connect(){
    await db.connect();
  }

  addToBeingSaved(domain, type){
    this.beingSaved[type]++;
    this.beingSavedByDomain[domain]++;
  };

  removeFromBeingSaved(domain, type){
    this.beingSaved[type]--;
    this.beingSavedByDomain[domain]--;
  };

  async updateJobResults(data){
    log.debug('updateJobResults', this.finished, this.jobs.toString(), this.beingSaved);
    this.finished = 0;
    if(!this.jobs.isJobRegistered(data.domain)){
      //log.error(`Something went wrong: cannot update job results for ${data.domain} (no such job registered)`);
      return;
    }
    if(data.jobType === 'robotsCheck'){
      log.info(`Saving robots data for ${data.domain}`);
      this.addToBeingSaved['robotsCheck'];
      try {
        await this.saveRobots(data);
      } catch (e) {
        // TODO handle errors
      } finally {
        this.removeFromBeingSaved['robotsCheck'];
        this.jobs.deregisterJob(data.domain);
        log.debug(`Done saving robots data for ${data.domain}`);
      }
    }
    if(data.jobType === 'domainCrawl'){
      log.info(`Saving domain crawl for ${data.domain}`);
      this.addToBeingSaved['domainCrawl'];
      try {
        await Domain.updateOne({origin: data.domain},{
          '$set': {status: 'ready'},
          '$unset': {workerId: ''}
        });
      } catch (e) {
        // TODO handle errors
      } finally {
        this.removeFromBeingSaved['domainCrawl'];
        this.jobs.deregisterJob(data.domain);
        log.debug(`Done saving domain crawl for ${data.domain}`);
      }
    }
    if(data.jobType === 'resourceCrawl'){
      log.info(`Saving resource crawl for domain ${data.domain}: ${data.url}`);
      if(this.jobs.postponeTimeout(data.domain)){
        this.addToBeingSaved['resourceCrawl'];
        try {
          if(data.results.ok){
            await this.saveCrawl(data.url, data.results.details);
          } else {
            await Resource.markAsCrawled(data.url, data.results.details, true);
          }
        } catch (e) {
          // TODO handle errors
        } finally {
          this.removeFromBeingSaved['resourceCrawl'];
          log.debug(`Done saving resource crawl for domain ${data.domain}: ${data.url}`);
        }
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
      await Resource.addFromTriples(triples);
      const res = await Triple.upsertMany(sourceUrl, triples);
      if(res.upsertedCount){
        const tids = Object.values(res.upsertedIds).map(i => ObjectId(i));
        const newTriples = await Triple.find({_id: {'$in': tids}});
        await this.updatePaths(sourceUrl, newTriples);
      }
    }
    return;
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
    const crawlDelay = config.http.crawlDelay || 1;
    let doc = {workerId: undefined};

    if(data.results.ok){
      const robots = robotsParser(data.domain+'/robots.txt', data.results.details.robots);
      const msCrawlDelay = 1000*(robots.getCrawlDelay(config.userAgent) || msCrawlDelay);

      doc = {
        '$set': {
          'robots.text': data.results.details.robots,
          'robots.checked': data.results.details.endTime,
          'robots.elapsedTime': data.results.details.elapsedTime,
          'robots.status': 'done',
          status: 'ready',
          'crawl.delay': crawlDelay,
          'crawl.nextAllowed': new Date(data.results.details.endTime+(msCrawlDelay)),
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
          'crawl.nextAllowed': new Date(data.results.details.endTime+(msCrawlDelay))
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

  async *domainsToCrawl(workerId, limit, resourcesPerDomain){
    let noDomainsFound = true;
    for await(const domain of Domain.domainsToCrawl(workerId, limit)){
      noDomainsFound = false;
      //const heads = await Path.find({'head.alreadyCrawled': false, 'head.domain': domain.origin})
      const filter = {
        domain: domain.origin,
        status: 'unvisited',
        minPathLength: {'$lt': config.graph.maxPathLength},
        headCount: {'$gt': 0}
      };
      const heads = await Resource.find(filter)
                                  .sort('-headCount')
                                  .select('url')
                                  .limit(resourcesPerDomain || 10)
                                  .lean();
      yield {domain, resources: heads};
    }
    if(noDomainsFound){
      //log.warn('No domains left to crawl!');
    }
  }

  async *assignJobs(workerId, workerAvail){
    log.debug('assignJobs');
    if(this.beingSaved.count() > 2){
      console.warn('Too many jobs being saved, waiting for them to reduce before assigning new jobs');
    }
    let assignedCheck = 0;
    let assignedCrawl = 0;
    if(workerAvail.robotsCheck){
      log.debug(`Getting ${workerAvail.robotsCheck} robotsCheck jobs for ${workerId}`);
      for await(const check of Domain.domainsToCheck(workerId, workerAvail.robotsCheck)){
        if(this.jobs.registerJob(check.origin, 'robotsCheck')){
          assignedCheck++;
          yield {jobType: 'robotsCheck', domain: check.origin};
        }
      }
    }
    if(workerAvail.domainCrawl){
      log.debug(`Getting ${workerAvail.domainCrawl} domainCrawl jobs for ${workerId}`);
      for await(const crawl of this.domainsToCrawl(workerId, workerAvail.domainCrawl, workerAvail.resourcesPerDomain)){
        if(crawl?.resources?.length && this.jobs.registerJob(crawl.domain.origin, 'domainCrawl')){
          assignedCrawl++;
          yield {jobType: 'domainCrawl', ...crawl};
        } else {
          log.info(`No resources to crawl from domain ${crawl.domain.origin}`);
        }
      }
    }
    if(!assignedCheck && !assignedCrawl && !this.jobs.count() && !this.beingSaved.count()){
      log.info('Could not find any domains to check or crawl and there are no outstanding jobs');
      this.finished++;
    }
    //FIXME
    if(this.finished > 5){
      log.info('No current processes running, starting new process');
      Process.startNext();
      //console.log('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX this should be the end!', this.finished, workerAvail, assignedCheck, assignedCrawl, this.jobs.count(), this.beingSaved.count());
    }
  }
};

module.exports = Manager;
