import robotsParser from 'robots-parser';
import config from '@derzis/config';
import * as db from './db';
import {Domain, ITriple, Triple, IPath, PathDocument, Path, Resource, Process, PathSkeleton} from '@derzis/models';
import {createLogger, HttpError } from '@derzis/common';
const log = createLogger('Manager');
import CurrentJobs from './CurrentJobs';
import { JobCapacity, JobType, JobRequest, JobResult, CrawlResourceResultOk, RobotsCheckResult } from '@derzis/worker';
import { ObjectId } from 'bson';
import { next } from 'cheerio/lib/api/traversing';

interface JobsBeingSaved {
  domainCrawl: number;
  resourceCrawl: number;
  robotsCheck: number;
  count: () => number;
};

export default class Manager {
  jobs: CurrentJobs;
  beingSaved: JobsBeingSaved;
  beingSavedByDomain: {[domain: string]: number }
  finished: number;

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

  addToBeingSaved(origin: string, type: JobType){
    this.beingSaved[type]++;
    this.beingSavedByDomain[origin]++;
  };

  removeFromBeingSaved(origin: string, type: JobType){
    this.beingSaved[type]--;
    this.beingSavedByDomain[origin]--;
  };

  async updateJobResults(jobResult: JobResult){
    log.debug('updateJobResults', this.finished, this.jobs.toString(), this.beingSaved);
    this.finished = 0;
    if(!this.jobs.isJobRegistered(jobResult.origin)){
      //log.error(`Something went wrong: cannot update job results for ${data.domain} (no such job registered)`);
      return;
    }
    if(jobResult.jobType === 'robotsCheck'){
      log.info(`Saving robots data for ${jobResult.origin}`);
      this.addToBeingSaved(jobResult.origin, jobResult.jobType);
      try {
        await this.saveRobots(jobResult);
      } catch (e) {
        // TODO handle errors
      } finally {
        this.removeFromBeingSaved(jobResult.origin, jobResult.jobType);
        this.jobs.deregisterJob(jobResult.origin);
        log.debug(`Done saving robots data for ${jobResult.origin}`);
      }
    }
    if(jobResult.jobType === 'domainCrawl'){
      log.info(`Saving domain crawl for ${jobResult.origin}`);
      this.addToBeingSaved(jobResult.origin, jobResult.jobType);
      try {
        await Domain.updateOne({origin: jobResult.origin},{
          '$set': {status: 'ready'},
          '$unset': {workerId: ''}
        });
      } catch (e) {
        // TODO handle errors
      } finally {
        this.removeFromBeingSaved(jobResult.origin, jobResult.jobType);
        this.jobs.deregisterJob(jobResult.origin);
        log.debug(`Done saving domain crawl for ${jobResult.origin}`);
      }
    }
    if(jobResult.jobType === 'resourceCrawl'){
      log.info(`Saving resource crawl for domain ${jobResult.origin}: ${jobResult.url}`);
      if(this.jobs.postponeTimeout(jobResult.origin)){
      this.addToBeingSaved(jobResult.origin, jobResult.jobType);
        try {
          if(jobResult.status === 'ok' ){
            await this.saveCrawl(jobResult);
          } else {
            await Resource.markAsCrawled(jobResult.url, jobResult.details, true);
          }
        } catch (e) {
          // TODO handle errors
        } finally {
        this.removeFromBeingSaved(jobResult.origin, jobResult.jobType);
          log.debug(`Done saving resource crawl for domain ${jobResult.origin}: ${jobResult.url}`);
        }
      }
    }
  }

  async saveCrawl(jobResult: CrawlResourceResultOk){
    await Resource.markAsCrawled(jobResult.url, jobResult.details);
    const triples = jobResult.details.triples
                      .filter(t => t.subject.termType === 'NamedNode')
                      .filter(t => t.object.termType  === 'NamedNode')
                      .filter(t => t.object.value  === jobResult.url ||
                                   t.subject.value === jobResult.url)
                      .map(t => ({
                        subject: t.subject.value,
                        predicate: t.predicate.value,
                        object: t.object.value,
                      }));
    if(triples.length){
      await Resource.addFromTriples(triples);
      const res = await Triple.upsertMany(jobResult.url, triples);
      if(res.upsertedCount){
        const tids = Object.values(res.upsertedIds).map(i => new ObjectId(i));
        const newTriples = await Triple.find({_id: {'$in': tids}});
        await this.updatePaths(jobResult.url, newTriples);
      }
    }
    return;
  }


  async updatePaths(sourceUrl: string, triples: ITriple[]){
    const query = {
      'head.url': sourceUrl,
      'nodes.count': {
        '$lt': config.graph.maxPathLength
      }
    };
    await Path.updateMany({...query, status: 'active'}, {status: 'finished'});
    for await (const path of Path.find(query)){
      await this.addHeads(path, triples);
    }
  }

  async addHeads(path: IPath, triples: ITriple[]){
    let newPaths: {[prop: string]: {[newHead: string]: PathSkeleton}} = {};

    for(const t of triples){
      if(t.subject === t.object){ continue; }
      if(t.subject !== path.head.url && t.object !== path.head.url){
        continue;
      }

      const newHead: string = t.subject === path.head.url ? t.object : t.subject;
      const prop: string = t.predicate;
      // new head already contained in path
      if(path.nodes.elems.includes(newHead)){ continue; }
      // new predicate and path already has max preds
      if(!path.predicates.elems.includes(prop) &&
         path.predicates.count >= config.graph.maxPathProps){
        continue;
      }
      // path already has max length
      if(path.nodes.count >= config.graph.maxPathLength){
        continue;
      }
      newPaths[prop] = newPaths[prop] || {};
      if(!newPaths[prop][newHead]){
        const nodes = [...path.nodes.elems, newHead];
        const np: PathSkeleton = {
          seed: path.seed,
          head: {url: newHead},
          predicates: {elems: Array.from(new Set([...path.predicates.elems, prop]))},
          nodes: {elems: nodes},
          parentPath: path
        };
        newPaths[prop][newHead] = np;
      }
    }

    const nps: PathSkeleton[] = [];
    Object.values(newPaths).forEach(x => Object.values(x).forEach(y => nps.push(y)));
    if(!nps.length){ return; }

    let paths = await Path.create(nps as PathSkeleton[]);
    paths = paths.filter(p => p.status === 'active');

    if(!paths.length){ return []; }

    await Resource.addPaths(paths);

    return this.addExistingHeads(paths);
  }

  async addExistingHeads(paths: PathDocument[]){
    for(const p of paths){
      if(p.head.alreadyCrawled){
        await this.addExistingHead(p);
      }
    }
    return paths;
  }

  async addExistingHead(path: PathDocument){
    const headResource = await Resource.findOne({url: path.head.url}).lean();
    if(headResource && (headResource.isSeed || path.nodes.elems.includes(headResource.url))){
      await path.markDisabled();
    }
    const props = new Set(path.predicates.elems);
    let betterPathCandidates = await Path.find({
      'seed.url': path.seed.url,
      'head.url': path.head.url,
      'predicates.count': {'$lt': path.predicates.count}
    });
    // there are already better ways of reaching this head
    const foundBetter = betterPathCandidates?.some(pc => pc.predicates.elems.every(pred => props.has(pred)));
    if(foundBetter){
      await path.markDisabled();
    }
    const triples = await Triple.find({nodes: headResource!.url});
    await path.markFinished();
    return this.addHeads(path, triples);
  }

  async saveRobots(jobResult: RobotsCheckResult){
    let crawlDelay = config.http.crawlDelay || 1;
    let doc: object = {workerId: undefined};

    if(jobResult.status === 'ok'){
      const robots = robotsParser(jobResult.origin+'/robots.txt', jobResult.details.robotsText);
      crawlDelay = robots.getCrawlDelay(config.http.userAgent) || crawlDelay;
      const msCrawlDelay = 1000*crawlDelay;

      doc = {
        '$set': {
          'robots.text': jobResult.details.robotsText,
          'robots.checked': jobResult.details.endTime,
          'robots.elapsedTime': jobResult.details.elapsedTime,
          'robots.status': 'done',
          status: 'ready',
          'crawl.delay': crawlDelay,
          'crawl.nextAllowed': new Date(jobResult.details.endTime+(msCrawlDelay)),
          lastAccessed: jobResult.details.endTime
        }, '$unset': {workerId: ''}
      };
    }
    else if(jobResult.err instanceof HttpError){
      let robotStatus = 'error';
      const msCrawlDelay = 1000*crawlDelay;
      if(jobResult.err.httpStatus === 404){ robotStatus = 'not_found'; }

      const endTime = jobResult.details?.endTime || Date.now();
      const nextAllowed = jobResult.details ?
                                new Date(endTime+(msCrawlDelay)) :
                                Date.now()+1000
      doc = {
        '$set': {
          'robots.status': robotStatus,
          status: 'ready',
          'crawl.delay': crawlDelay,
          'crawl.nextAllowed': nextAllowed
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

    return await Domain.findOneAndUpdate({origin: jobResult.origin}, doc, {new: true})
      .catch(err => log.error(err));
  }

  async *domainsToCrawl(workerId: string, limit: number, resourcesPerDomain: number){
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
      await Resource.updateMany({_id: {'$in': heads.map(h => h._id)}}, {status: 'crawling'}).lean();
      yield {domain, resources: heads};
    }
    if(noDomainsFound){
      //log.warn('No domains left to crawl!');
    }
  }

  async *assignJobs(workerId: string, workerAvail: JobCapacity): AsyncIterable<JobRequest>{
    log.debug('assignJobs');
    if(this.beingSaved.count() > 2){
      log.warn(`Too many jobs (${this.beingSaved.count()}) being saved, waiting for them to reduce before assigning new jobs`);
    }
    let assignedCheck = 0;
    let assignedCrawl = 0;
    if(workerAvail.robotsCheck.capacity){
      log.debug(`Getting ${workerAvail.robotsCheck.capacity} robotsCheck jobs for ${workerId}`);
      for await(const check of Domain.domainsToCheck(workerId, workerAvail.robotsCheck.capacity)){
        if(this.jobs.registerJob(check.origin, 'robotsCheck')){
          assignedCheck++;
          yield {
            type: 'robotsCheck',
            origin: check.origin
          };
        }
      }
    }
    if(workerAvail.domainCrawl){
      log.debug(`Getting ${workerAvail.domainCrawl.capacity} domainCrawl jobs for ${workerId}`);
      for await(const crawl of this.domainsToCrawl(workerId, workerAvail.domainCrawl.capacity, workerAvail.domainCrawl.resourcesPerDomain)){
        if(crawl?.resources?.length && this.jobs.registerJob(crawl.domain.origin, 'domainCrawl')){
          assignedCrawl++;
          yield {type: 'domainCrawl', ...crawl};
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
      console.log('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX this should be the end!', this.finished, workerAvail, assignedCheck, assignedCrawl, this.jobs.toString(), this.beingSaved);
    }
  }
};

