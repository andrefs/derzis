import robotsParser from 'robots-parser';
import config from '@derzis/config';
import * as db from './db';
import {Domain, ITriple, Triple, IPath, PathDocument, Path, Resource, Process, PathSkeleton, IResource} from '@derzis/models';
import {createLogger, HttpError } from '@derzis/common';
const log = createLogger('Manager');
import RunningJobs from './RunningJobs';
import { JobCapacity, JobRequest, JobResult, RobotsCheckResult, CrawlResourceResult, ResourceCrawlJobRequest } from '@derzis/worker';
import { ObjectId } from 'bson';

export {OngoingJobs} from './RunningJobs';

export default class Manager {
  jobs: RunningJobs;
  finished: number;

  constructor(){
    this.jobs = new RunningJobs();
    this.finished = 0;
  }

  async connect(){
    await db.connect();
  }


  async updateJobResults(jobResult: JobResult){
    log.debug('updateJobResults', {
      finished: this.finished,
      jobs: this.jobs.toString(),
      beingSaved: this.jobs.beingSaved
    });
    this.finished = 0;
    if(!this.jobs.isJobRegistered(jobResult.origin)){
      //log.error(`Something went wrong: cannot update job results for ${data.domain} (no such job registered)`);
      return;
    }
    if(jobResult.jobType === 'robotsCheck'){
      log.info(`Saving robots data (job #${jobResult.jobId}) for ${jobResult.origin}`);
      this.jobs.addToBeingSaved(jobResult.origin, jobResult.jobType);
      try {
        await this.saveRobots(jobResult);
      } catch (e) {
        // TODO handle errors
        log.error(`Error saving robots (job #${jobResult.jobId}) for ${jobResult.origin}`);
        log.info(jobResult);
      } finally {
        this.jobs.removeFromBeingSaved(jobResult.origin, jobResult.jobType);
        this.jobs.deregisterJob(jobResult.origin);
        log.debug(`Done saving robots data (job #${jobResult.jobId}) for ${jobResult.origin}`);
      }
    }
    if(jobResult.jobType === 'resourceCrawl'){
      log.info(`Saving resource crawl (job #${jobResult.jobId}) for domain ${jobResult.origin}: ${jobResult.url}`);
      if(this.jobs.postponeTimeout(jobResult.origin)){
      this.jobs.addToBeingSaved(jobResult.origin, jobResult.jobType);
        try {
          await this.saveCrawl(jobResult);
        } catch (e) {
          // TODO handle errors
          log.error(`Error saving resource crawl (job #${jobResult.jobId}) for ${jobResult.url}`);
          log.info(jobResult);
        } finally {
          this.jobs.removeFromBeingSaved(jobResult.origin, jobResult.jobType);
          log.debug(`Done saving resource crawl (job #${jobResult.jobId}) for domain ${jobResult.origin}: ${jobResult.url}`);
          const res = await Domain.updateOne(
            {
              origin: jobResult.origin,
              jobId: jobResult.jobId,
              'crawl.ongoing': 0
            },{
              $set: {status: 'ready'},
              $unset: {
                workerId: '',
                jobId: ''
              }
            }

          );
          if(res.acknowledged && res.modifiedCount){
            this.jobs.deregisterJob(jobResult.origin);
            log.debug(`Done saving domain crawl (job #${jobResult.jobId}) for ${jobResult.origin}`);
          }
        }
      }
    }
  }

  async saveCrawl(jobResult: CrawlResourceResult){
    if(jobResult.status === 'not_ok'){
      return await Resource.markAsCrawled(jobResult.url, jobResult.details, jobResult.err);
    }
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
      const source = await Resource.findOne({url: jobResult.url}) as IResource;
      await Resource.addFromTriples(source, triples);
      const res = await Triple.upsertMany(source, triples);
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
      if(!p.head.needsCrawling){
        await this.addExistingHead(p);
      }
    }
    return paths;
  }

  async addExistingHead(path: PathDocument){
    const headResource = await Resource.findOne({url: path.head.url}).lean();
    // path gone back to seed or to repeated resource
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
    let doc: object = {
      '$unset': {
        workerId: '',
        jobId: ''
      }
    };

    if(jobResult.status === 'ok'){
      const robots = robotsParser(jobResult.origin+'/robots.txt', jobResult.details.robotsText);
      crawlDelay = robots.getCrawlDelay(config.http.userAgent) || crawlDelay;
      return Domain.saveRobotsOk(jobResult, crawlDelay);
    }
    else {
      return Domain.saveRobotsError(jobResult, crawlDelay);
    }
  }

  async *domainsToCrawl(workerId: string, limit: number, resourcesPerDomain: number){
    let noDomainsFound = true;
    for await(const domain of Domain.domainsToCrawl(workerId, limit)){
      noDomainsFound = false;
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
      await Resource.updateMany({url: {'$in': heads.map(h => h.url)}}, {status: 'crawling', jobId: domain.jobId}).lean();
      await Domain.updateOne({origin: domain.origin, jobId: domain.jobId}, {'crawl.ongoing': heads.length});
      yield {domain, resources: heads};
    }
    if(noDomainsFound){
      //log.warn('No domains left to crawl!');
    }
  }

  async *assignJobs(workerId: string, workerAvail: JobCapacity): AsyncIterable<Exclude<JobRequest, ResourceCrawlJobRequest>>{
    if(this.jobs.beingSaved.count() > 2){
      log.warn(`Too many jobs (${this.jobs.beingSaved.count()}) being saved, waiting for them to reduce before assigning new jobs`);
    }
    let assignedCheck = 0;
    let assignedCrawl = 0;
    if(workerAvail.robotsCheck.capacity){
      log.debug(`Getting ${workerAvail.robotsCheck.capacity} robotsCheck jobs for ${workerId}`);
      for await(const check of Domain.domainsToCheck(workerId, workerAvail.robotsCheck.capacity)){
        if(await this.jobs.registerJob(check.jobId, check.origin, 'robotsCheck')){
          assignedCheck++;
          yield {
            type: 'robotsCheck',
            jobId: check.jobId,
            origin: check.origin
          };
        }
      }
    }
    if(workerAvail.domainCrawl){
      log.debug(`Getting ${workerAvail.domainCrawl.capacity} domainCrawl jobs for ${workerId}`);
      for await(const crawl of this.domainsToCrawl(workerId, workerAvail.domainCrawl.capacity, workerAvail.domainCrawl.resourcesPerDomain)){
        if(crawl?.resources?.length && await this.jobs.registerJob(crawl.domain.jobId, crawl.domain.origin, 'domainCrawl')){
          assignedCrawl++;
          yield {
            type: 'domainCrawl',
            jobId: crawl.domain.jobId,
            ...crawl
          };
        } else {
          log.info(`No resources to crawl from domain ${crawl.domain.origin}`);
        }
      }
    }
    if(!assignedCheck && !assignedCrawl && !this.jobs.count() && !this.jobs.beingSaved.count()){
      log.info('Could not find any domains to check or crawl and there are no outstanding jobs');
      this.finished++;
    }
    //FIXME
    if(this.finished > 5){
      log.info('No current processes running, starting new process');
      await Process.startNext();
      console.log('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX this should be the end!', this.finished, workerAvail, assignedCheck, assignedCrawl, this.jobs.toString());
    }
  }
};

