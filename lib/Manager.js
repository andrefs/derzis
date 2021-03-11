const robotsParser = require('robots-parser');
const config = require('../config');
const db = require('./db');
const Domain = require('../models/Domain');
const Triple = require('../models/Triple');
const Resource = require('../models/Resource');
const log = require('./logger')('Manager');
const util = require('util');


const cancelJobs = async function(jobs){
  let hosts;
  hosts = Object.keys(jobs.domainCheck);
  if(hosts.length){
    const update = {
      status: 'unvisited',
      'robots.status': 'unvisited',
      workerId: undefined
    };
    await Domain.updateMany({host: {'$in': hosts}}, {'$set': update});
  }

  hosts = Object.keys(jobs.domainCrawl);
  if(hosts.length){
    const update = {
      status: 'ready',
      workerId: undefined
    };
    await Domain.updateMany({host: {'$in': hosts}}, {'$set': update});
  }
};

const updateJobResults = async function(data){
  if(data.jobType === 'domainCheck'){
    await updateRobotsInfo(data)
  }
  // TODO handle errors
  if(data.jobType === 'domainCrawl'){
    await Domain.updateOne({host: data.host},{
      '$set': {status: 'ready'},
      '$unset': {workerId: ''}
    });
    // TODO handle errors
  }
  if(data.jobType === 'resourceCrawl'){
    if(data.results.ok){
      await saveCrawlInfo(data.url, data.results.details);
    } else {
      // TODO better handle errors
      await Resource.updateOne({url: data.results.url}, {status: 'error'});
    }
  }
};


const saveCrawlInfo = async function(sourceUrl, details){
  const source = await Resource.findOne({url: sourceUrl}).select('url host depth domain');
  const filtTrips = details.triples
    .filter(t =>
      t.subject.termType === 'NamedNode' &&
      t.object.termType  === 'NamedNode' &&
      (
        t.subject.value === source.url ||
        t.object.value  === source.url
      )
    ) // what about blank nodes
    .map(t => ({
      subject: t.subject.value,
      predicate: t.predicate.value,
      object: t.object.value,
      source: source.url
    }));
  let insTrips = [];
  await Triple.insertMany(filtTrips, {ordered:false})
    .then(trips => insTrips = trips)
    .catch(err => {
      for(const e of err.writeErrors){
        if(e.err.code && e.err.code === 11000){
          //existingTrips.push(filtTrips[e.err.index]);
        }
        // TO DO handle other errors
      }
      insTrips = err.insertedDocs;
    });

  const newResources = {};
  if(source.depth < config.graph.maxDepth){
    for(const t of insTrips){
      if(t.subject === t.source || t.object === t.source){
        newResources[t.subject] = source.depth+2;
        newResources[t.predicate] = source.depth+1;
        newResources[t.object] = source.depth+2;
      }
    }
  }

  if(Object.keys(newResources).length){
    await Resource.upsertMany(Object.keys(newResources).map(u => ({
      url: u,
      depth: newResources[u],
      domain: new URL(u).origin,
      crawled: false
    })));
  }

  await Resource.updateOne({url: source.url}, {
    status: 'done',
    totalTriples: details.triples.length
  });

  let d = await Domain.findOne({host: source.domain});
  d.crawl.queued--;
  d.crawl.success++;
  d.crawl.nextAllowed = new Date(details.ts + d.crawl.delay*1000);
  await d.save();
};

const updateRobotsInfo = async function(data){
  let crawlDelay = config.http.crawlDelay || 1;
  let doc = {workerId: undefined};

  if(data.results.ok){
    const robots = robotsParser(data.host+'/robots.txt', data.results.details.robots);
    crawlDelay = robots.getCrawlDelay(config.userAgent) || crawlDelay;

    doc = {
      '$set': {
        'robots.text': data.results.details.robots,
        'robots.checked': data.results.details.endTime,
        'robots.elapsedTime': data.results.details.elapsedTime,
        'robots.status': 'done',
        status: 'ready',
        'crawl.delay': crawlDelay,
        'crawl.nextAllowed': new Date(data.results.details.endTime+(crawlDelay*1000)),
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
        'crawl.nextAllowed': new Date(data.results.details.endTime+(crawlDelay*1000))
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

  return await Domain.findOneAndUpdate({host: data.host}, doc, {new: true})
    .catch(err => console.log(err));
};

const domainsToCrawl = async function*(workerId, limit){
  for await(const domain of Domain.domainsToCrawl(workerId, limit)){
    const resources = await Resource.resourcesToCrawl(domain.host, workerId, config.workers?.jobs?.domainCrawl?.resourcesPerDomain || 100);
    yield {domain, resources};
  }
};

const assignJobs = async function*(workerId, workerAvail){
  if(workerAvail.domainCheck){
    for await(const check of Domain.domainsToCheck(workerId, workerAvail.domainCheck)){
      yield {jobType: 'domainCheck', ...check};
    }
  }
  if(workerAvail.domainCrawl){
    for await(const crawl of this.domainsToCrawl(workerId, workerAvail.domainCrawl)){
      yield {jobType: 'domainCrawl', ...crawl};
    }
  }
};

module.exports = {
  cancelJobs,
  updateJobResults,
  saveCrawlInfo,
  updateRobotsInfo,
  domainsToCrawl,
  assignJobs
};
