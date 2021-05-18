const robotsParser = require('robots-parser');
const config = require('../config');
const db = require('./db');
const Domain = require('../models/Domain');
const Triple = require('../models/Triple');
const Path = require('../models/Path');
const Resource = require('../models/Resource');
const log = require('./logger')('Manager');
const util = require('util');
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;


const init = async function(urls){
  const paths = await Resource.insertSeeds(urls);
};

const cleanJobs = async function(jobs){
  log.info(`Cleaning outstanding jobs`);
  await Domain.updateMany({'robots.status': 'checking'}, {'$set': {
    status: 'unvisited',
    'robots.status': 'unvisited',
    workerId: undefined
  }});
  await Domain.updateMany({status: 'crawling'}, {'$set': {
    status: 'ready',
    workerId: undefined
  }});
  return;
};

const cancelJobs = async function(jobs){
  let domains;
  domains = Object.keys(jobs.robotsCheck);
  if(domains.length){
    const update = {
      status: 'unvisited',
      'robots.status': 'unvisited',
      workerId: undefined
    };
    await Domain.updateMany({origin: {'$in': domains}}, {'$set': update});
  }

  domains = Object.keys(jobs.domainCrawl);
  if(domains.length){
    const update = {
      status: 'ready',
      workerId: undefined
    };
    await Domain.updateMany({origin: {'$in': domains}}, {'$set': update});
  }
};

const updateJobResults = async function(data){
  if(data.jobType === 'robotsCheck'){
    await saveRobots(data)
  }
  // TODO handle errors
  if(data.jobType === 'domainCrawl'){
    await Domain.updateOne({origin: data.domain},{
      '$set': {status: 'ready'},
      '$unset': {workerId: ''}
    });
    // TODO handle errors
  }
  if(data.jobType === 'resourceCrawl'){
    if(data.results.ok){
      await saveCrawl(data.url, data.results.details);
    } else {
      await Resource.markAsCrawled(data.url, data.results.details, true);
    }
  }
};

const saveCrawl = async function(sourceUrl, details){
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
    await saveResources(triples);
    const res = await Triple.upsertMany(sourceUrl, triples);
    if(res.upsertedCount){
      const newTriples = await Triple.find({_id: {'$in': Object.values(res.upsertedIds).map(i => ObjectId(i))}});
      //await Resource.updateOne({url: sourceUrl}, {status: 'done'});
      await updatePaths(sourceUrl, newTriples);
    }
  }
};


const saveResources = async function(triples){
  const resources = {};
  for (const t of triples){
    resources[t.subject] = true;
    resources[t.object] = true;
  }

  return await Resource.addMany(Object
    .keys(resources).map(u => ({
      url: u,
      domain: new URL(u).origin
    }))
  );
};

const updatePaths = async function(sourceUrl, triples){
  const query = {'head.url': sourceUrl, status: 'active'};
  let paths = await Path.find(query);
  await Path.updateMany(query, {status: 'finished'});
  for(const path of paths){
    await addHeads(path, triples);
  }
};

const addHeads = async function(path, triples){
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
        await addExistingHead(p);
      }
    }
  }
  return paths;
};

const addExistingHead = async function(path){
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
  return addHeads(path, triples);
};

const saveRobots = async function(data){
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
    let robot_status = 'error';
    if(data.results.error.httpStatus === 404){ robot_status = 'not_found'; }

    doc = {
      '$set': {
        'robots.status': robot_status,
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
    .catch(err => console.log(err));
};

const domainsToCrawl = async function*(workerId, limit){
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
    log.warn('No domains left to crawl!');
  }
};

const assignJobs = async function*(workerId, workerAvail){
  if(workerAvail.robotsCheck){
    for await(const check of Domain.domainsToCheck(workerId, workerAvail.robotsCheck)){
      yield {jobType: 'robotsCheck', domain: check.origin};
    }
  }
  if(workerAvail.domainCrawl){
    for await(const crawl of this.domainsToCrawl(workerId, workerAvail.domainCrawl)){
      if(crawl.resources && crawl.resources.length){
        yield {jobType: 'domainCrawl', ...crawl};
      } else {
        log.info(`No resources to crawl from domain ${crawl.domain.origin}`);
      }
    }
  }
};

module.exports = {
  init,
  cleanJobs,
  cancelJobs,
  updateJobResults,
  saveCrawl,
  saveRobots,
  domainsToCrawl,
  assignJobs
};
