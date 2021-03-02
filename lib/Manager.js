const robotsParser = require('robots-parser');
const config = require('../config');
const db = require('./db');
const Domain = require('../models/Domain');
const Resource = require('../models/Resource');
const log = require('./logger')('Manager');


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
    updateRobotsInfo(data.results)
  }
  if(data.jobType === 'domainCrawl'){
    await Domain.updateOne({host: data.host},{
      '$set': {status: 'ready'},
      '$unset': {workerId: ''}
    });
  }
  if(data.jobType === 'resourceCrawl'){
    const source = {
      url: data.results.url,
      domain: data.host
    }
    await saveCrawlInfo(source, data.results.resources, data.results.triples);
  }
};


const saveCrawlInfo = async function(source, urls, triples){
  await Resource.upsertMany(urls.map(u => ({
    url: u,
    // source
    domain: new URL(u).origin,
    crawled: false
  })));
  await Resource.updateOne({url: source.url}, {
    status: 'done',
    totalTriples: triples.length
  });
  await Domain.updateOne({host: source.domain}, {
    '$inc': {
      'crawl.queued': -1,
      'crawl.success': 1
    }
  });
};

const updateRobotsInfo = async function(results){
  let crawlDelay = 1;
  let doc = {workerId: undefined};

  if(results.ok){
    const robots = robotsParser(results.host+'/robots.txt', results.robots);
    crawlDelay = robots.getCrawlDelay(config.userAgent) || crawlDelay;

    doc = {
      '$set': {
        'robots.text': results.robots,
        'robots.checked': results.endTime,
        'robots.elapsedTime': results.elapsedTime,
        'robots.status': 'done',
        status: 'ready',
        'crawl.delay': crawlDelay,
        'crawl.nextAllowed': new Date(results.endTime+(crawlDelay*1000)),
        lastAccessed: results.endTime
      }, '$unset': {workerId: ''}
    };
  }
  else if(results.status === 404){
    doc = {
      '$set': {
        'robots.status': 'not_found',
        status: 'ready',
        'crawl.delay': crawlDelay,
        'crawl.nextAllowed': new Date(results.endTime+(crawlDelay*1000))
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

  return await Domain.findOneAndUpdate({host: results.host}, doc, {new: true})
    .catch(err => console.log(err));
};

const domainsToCrawl = async function*(workerId, limit){
  for await(const domain of Domain.domainsToCrawl(workerId, limit)){
    const resources = await Resource.resourcesToCrawl(domain.host, workerId, limit);
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
