import { type Types, Document, type QueryFilter, type UpdateQuery } from 'mongoose';
import { Resource } from '../Resource';
import { humanize } from 'humanize-digest';

interface DomainState {
  origin: string;
  status: string;
  nextAllowed: number;
}

interface ProcessState {
  domains: DomainState[];
  beingSavedCount: number;
}

import {
  TraversalPath,
  EndpointPath,
  PathClass,
  HEAD_TYPE,
  UrlHead,
  type TraversalPathDocument,
  type EndpointPathDocument
} from '../Path';
import { createLogger } from '@derzis/common/server';
const log = createLogger('Process');
import {
  prop,
  index,
  getModelForClass,
  pre,
  type ReturnModelType,
  PropType,
  type DocumentType
} from '@typegoose/typegoose';
import { Domain } from '../Domain';
import {
  getPathsForRobotsChecking,
  getPathsForDomainCrawl,
  hasPathsDomainRobotsChecking,
  hasPathsHeadBeingCrawled,
  extendPaths,
  deleteRemainingTraversalPaths
} from './process-paths';
import {
  notifyStepStarted,
  notifyProcessCreated,
  notifyStepFinished,
  notifyStart
} from './process-notifications';
import {
  getTriples,
  getTriplesJson,
  getDomainsJson,
  getResourcesJson,
  getResourceCount,
  getAllResources,
  getAllDomains,
  getInfo,
  curPredsBranchFactor,
  getDoneResourceCount
} from './process-data';
import { BranchFactorClass, NotificationClass, StepClass } from './aux-classes';
import { type SimpleTriple, PathType } from '@derzis/common';

@index({ status: 1 })
@index({ createdAt: 1 })
@index({ status: 1, createdAt: -1 })
// Before saving a new process, set the pid and notification.ssePath if not already set
@pre<ProcessClass>('save', async function () {
  const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
  const count = await Process.countDocuments({
    createdAt: { $gt: today }
  });
  if (!this.pid) {
    // YYYY-MM-DD-count
    const date = today.toISOString().split('T')[0] + '-' + count;
    // YYYY-MM-DD-HHMM
    const str =
      date + '-' + new Date().toISOString().split('T')[1].replace(/[:.]/g, '').slice(0, 4);
    const word = humanize('process' + str);
    this.pid = `${word}-${date}`;
  }
  if (!this.notification) {
    this.notification = {};
  }
  const ssePath = `/processes/${this.pid}/events`;
  this.notification.ssePath = ssePath;
})

/**
 * Process model representing a crawling process with multiple steps, notifications and path management.
 * Each process has a unique pid, a notification object for SSE notifications, a description, a current step with crawling limits, and a list of all steps.
 * The process manages the crawling paths according to the current step's limits and notifies about step and process events.
 */
class ProcessClass extends Document {
  createdAt?: Date;
  updatedAt?: Date;

  @prop({ type: String })
  public pid!: string;

  @prop({ required: true, type: NotificationClass })
  public notification!: NotificationClass;

  @prop({ type: String })
  public description?: string;

  @prop({ required: true, type: StepClass })
  public currentStep!: StepClass;

  @prop({
    enum: ['endpoint', 'traversal'],
    required: true,
    type: String,
    default: PathType.TRAVERSAL
  })
  public curPathType!: PathType;

  /**
   * All crawling steps, including the current one
   */
  @prop({ required: true, default: [], type: [StepClass] }, PropType.ARRAY)
  public steps!: StepClass[];

  @prop({ required: true, type: Object })
  public pathHeads!: {
    required: true;
    type: { [key: string]: number };
  };

  /**
   * Process status
   * 'queued' - waiting to be started
   * 'running' - currently running
   * 'done' - finished successfully
   * 'error' - finished with errors
   * 'extending' - extending existing paths with existing triples
   */
  @prop({
    enum: ['queued', 'running', 'done', 'error', 'extending'],
    default: 'queued',
    type: String
  })
  public status!: 'queued' | 'running' | 'done' | 'error' | 'extending';

  /**
   * Counter that increments each time a new step is added to the process.
   * Used to track which paths have been considered for extension.
   */
  @prop({ default: 1, type: Number })
  public pathExtensionCounter!: number;

  public async captureState(beingSaved?: { count: () => number }): Promise<ProcessState> {
    const domains = await Domain.find({}).select('origin status crawl.nextAllowed').lean();
    return {
      domains: domains.map((d) => ({
        origin: d.origin,
        status: d.status,
        nextAllowed: d.crawl?.nextAllowed?.getTime() ?? 0
      })),
      beingSavedCount: beingSaved?.count() ?? 0
    };
  }

  public stateChanged(before: ProcessState, after: ProcessState): boolean {
    if (before.beingSavedCount !== after.beingSavedCount) {
      return true;
    }

    const beforeDomains = new Map(before.domains.map((d) => [d.origin, d.status]));
    const afterDomains = new Map(after.domains.map((d) => [d.origin, d.status]));

    for (const [origin, status] of afterDomains) {
      if (beforeDomains.get(origin) !== status) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if the process is done
   * @returns {Promise<boolean>} - Whether the process is done
   */
  public async isDone(beingSaved?: { count: () => number }): Promise<boolean> {
    // process is done
    if (['done', 'error'].includes(this.status)) {
      return true;
    }

    if (this.status !== 'running') {
      log.info(`Process ${this.pid} is not running (status: ${this.status}), thus not done yet.`);
      return false;
    }

    // check for more paths to crawl or check
    const maxPathLength = this.currentStep.maxPathLength;
    const maxPathProps = this.currentStep.maxPathProps;

    // Capture state before checks to detect if state changed during execution
    const beforeState = await this.captureState(beingSaved);

    // Check resources being saved first (in-flight work that hasn't completed yet)
    if (beingSaved && beingSaved.count() > 0) {
      log.debug(
        `Checking if process ${this.pid} has paths for domain crawling (maxPathLength: ${maxPathLength}, maxPathProps: ${maxPathProps})`
      );
      log.debug(
        `Process ${this.pid} has ${beingSaved.count()} resources being saved, not done yet`
      );
    }

    // Check from most active states to least active
    // 1. Domains being crawled (active work in progress)
    log.debug(`Checking if process ${this.pid} has paths with domains being crawled`);
    const hasPathsCrawling = await hasPathsHeadBeingCrawled(this);

    // 2. Domains being checked for robots.txt
    log.debug(`Checking if process ${this.pid} has paths for robots checking`);
    const hasPathsChecking = await hasPathsDomainRobotsChecking(this);

    // 3. Paths from unvisited domains (waiting for robots check)
    log.debug(
      `Checking if process ${this.pid} has paths from unvisited domains (maxPathLength: ${maxPathLength}, maxPathProps: ${maxPathProps})`
    );
    const pathsToCheck = await getPathsForRobotsChecking(this, this.curPathType, [], null, null, 1);

    // 4. Paths from ready domains (ready to crawl) - check last as state should be settled by now
    log.debug(
      `Checking if process ${this.pid} has paths for domain crawling (maxPathLength: ${maxPathLength}, maxPathProps: ${maxPathProps})`
    );
    const pathsToCrawl = await getPathsForDomainCrawl(this, this.curPathType, [], null, null, 1);

    // no more paths to crawl and no paths checking or crawling
    if (!pathsToCrawl.length && !pathsToCheck.length && !hasPathsChecking && !hasPathsCrawling) {
      log.warn(
        `Process ${this.pid} has no more paths for checking or crawling, and there there are no paths currently being checked or crawled. Marking process as done.`
      );
      log.debug(
        `Process ${this.pid} isDone() marking done - detailed breakdown: ` +
          JSON.stringify(
            {
              currentStep: { maxPathLength, maxPathProps },
              hasPathsHeadBeingCrawled: hasPathsCrawling,
              hasPathsDomainRobotsChecking: hasPathsChecking,
              getPathsForRobotsChecking: {
                result: pathsToCheck.length,
                samplePaths: pathsToCheck.slice(0, 3).map((p) => ({
                  _id: p._id,
                  headUrl: (p.head as any)?.url,
                  nodesCount: (p as any).nodes?.count
                }))
              },
              getPathsForDomainCrawl: {
                result: pathsToCrawl.length,
                samplePaths: pathsToCrawl.slice(0, 3).map((p) => ({
                  _id: p._id,
                  headUrl: (p.head as any)?.url,
                  nodesCount: (p as any).nodes?.count
                }))
              },
              beingSaved: beingSaved ? beingSaved.count() : 0
            },
            null,
            2
          )
      );
      // Capture state after checks to detect if state changed during execution
      const afterState = await this.captureState(beingSaved);

      // If state changed during isDone execution, don't mark done
      if (this.stateChanged(beforeState, afterState)) {
        log.debug(
          `State changed during isDone execution (beingSaved: ${beforeState.beingSavedCount} -> ${afterState.beingSavedCount}), returning false`
        );
        return false;
      }

      // mark as done and notify
      await this.done();
      return true;
    }

    // process is not done
    log.info(
      `Process ${this.pid} is not done yet: ` +
        JSON.stringify(
          {
            hasPathsCrawling,
            hasPathsChecking,
            pathsToCheck: pathsToCheck.length,
            pathsToCrawl: pathsToCrawl.length,
            beingSaved: beingSaved ? beingSaved.count() : 0
          },
          null,
          2
        )
    );
    return false;
  }

  /**
   * Get triples as a stream
   * @returns {AsyncGenerator<SimpleTriple>} - Triples
   */
  public async *getTriples(): AsyncGenerator<SimpleTriple> {
    for await (const t of getTriples(this)) {
      yield t;
    }
  }

  /**
   * Get triples as a stream of JSON strings
   * @param includeCreatedAt - Whether to include createdAt timestamp
   * @returns {AsyncGenerator<string>} - JSON strings of triples
   */
  public async *getTriplesJson(includeCreatedAt: boolean = false): AsyncGenerator<string> {
    for await (const t of getTriplesJson(this, includeCreatedAt)) {
      yield t;
    }
  }

  public async *getDomainsJson() {
    for await (const d of getDomainsJson(this)) {
      yield d;
    }
  }

  public async *getResourcesJson() {
    for await (const r of getResourcesJson(this)) {
      yield r;
    }
  }

  public async getPathsForRobotsChecking(
    pathType: PathType,
    domainBlacklist: string[] = [],
    lastSeenCreatedAt: Date | null = null,
    lastSeenId: Types.ObjectId | null = null,
    lastSeenLength: number | null = null,
    lastSeenShortestPathLength: number | null = null,
    limit = 20
  ) {
    return getPathsForRobotsChecking(
      this,
      pathType,
      domainBlacklist,
      lastSeenCreatedAt,
      lastSeenId,
      lastSeenLength,
      lastSeenShortestPathLength,
      limit
    );
  }

  public async getPathsForDomainCrawl(
    pathType: PathType,
    domainBlacklist: string[] = [],
    lastSeenCreatedAt: Date | null = null,
    lastSeenId: Types.ObjectId | null = null,
    lastSeenLength: number | null = null,
    lastSeenShortestPathLength: number | null = null,
    limit = 20
  ) {
    return getPathsForDomainCrawl(
      this,
      pathType,
      domainBlacklist,
      lastSeenCreatedAt,
      lastSeenId,
      lastSeenLength,
      lastSeenShortestPathLength,
      limit
    );
  }

  public async hasPathsDomainRobotsChecking(): Promise<boolean> {
    return hasPathsDomainRobotsChecking(this);
  }

  public async hasPathsHeadBeingCrawled(): Promise<boolean> {
    return hasPathsHeadBeingCrawled(this);
  }

  /**
   * Get predicates branching factor for the current step as a map
   * @returns {Map<string, number> | undefined} - map of predicate URL to branching factor
   */
  public curPredsBranchFactor(): Map<string, BranchFactorClass> | undefined {
    return curPredsBranchFactor(this);
  }

  public async getResourceCount(): Promise<number> {
    return getResourceCount(this);
  }

  public async *getAllResources() {
    return yield* getAllResources(this);
  }

  public async *getAllDomains() {
    return yield* getAllDomains(this);
  }

  public async getInfo(): Promise<ReturnType<typeof getInfo>> {
    return getInfo(this);
  }

  // TODO configurable number of simultaneous processes
  public static async startNext(this: ReturnModelType<typeof ProcessClass>) {
    // if there is already a running process, do not start a new one
    const runningProcs = await this.countDocuments({ status: 'running' });
    if (runningProcs > 0) {
      log.info('There are already running processes, not starting a new one');
      return false;
    }

    log.info('No running processes, starting next queued process');
    const process = await this.findOneAndUpdate(
      { status: 'queued' },
      { $set: { status: 'extending' } },
      { new: true }
    );

    // if no process found, return
    if (!process) {
      log.info('No queued processes to start');
      return false;
    }

    const pid = process.pid;

    // Before queuing, reset errored states if needed
    if (process.currentStep.resetErrors) {
      log.info(`Resetting errored states for process ${pid}`);
      const res = await process.resetErroredStates();
      log.debug(`Reset errored states for process ${pid}: ${res}`);
    }

    // Before queuing, extend existing paths according to new step limits
    const convertToEndpoint = process.currentStep.convertToEndpointPaths;
    log.info(
      `Before extendPaths(done): active traversal=${await TraversalPath.countDocuments({ processId: pid, status: 'active' })}, endpoint=${await EndpointPath.countDocuments({ processId: pid, status: 'active' })} (old paths will be deleted when extended)`
    );
    await extendPaths({ pid: process.pid, convertToEndpoint, headStatus: 'done' });
    log.info(
      `After extendPaths(done): active traversal=${await TraversalPath.countDocuments({ processId: pid, status: 'active' })}, endpoint=${await EndpointPath.countDocuments({ processId: pid, status: 'active' })}`
    );

    // Convert remaining traversal paths with unvisited heads if flag is set
    if (convertToEndpoint) {
      log.info(
        `Before extendPaths(unvisited): active traversal=${await TraversalPath.countDocuments({ processId: pid, status: 'active' })}, endpoint=${await EndpointPath.countDocuments({ processId: pid, status: 'active' })}`
      );
      await extendPaths({ pid: process.pid, convertToEndpoint, headStatus: 'unvisited' });
      log.info(
        `After extendPaths(unvisited): active traversal=${await TraversalPath.countDocuments({ processId: pid, status: 'active' })}, endpoint=${await EndpointPath.countDocuments({ processId: pid, status: 'active' })}`
      );
      log.info(
        `Before deleteRemainingTraversalPaths: active traversal=${await TraversalPath.countDocuments({ processId: pid, status: 'active' })}, endpoint=${await EndpointPath.countDocuments({ processId: pid, status: 'active' })}`
      );
      const remainingDeleted = await deleteRemainingTraversalPaths(pid);
      log.info(
        `After deleteRemainingTraversalPaths: active traversal=${await TraversalPath.countDocuments({ processId: pid, status: 'active' })}, endpoint=${await EndpointPath.countDocuments({ processId: pid, status: 'active' })}`
      );
      if (remainingDeleted > 0) {
        log.info(
          `Marked ${remainingDeleted} remaining active traversal paths as deleted for process ${pid}`
        );
      }
      await Process.updateOne({ pid }, { $set: { curPathType: PathType.ENDPOINT } });
    }

    // Allow post-crawl path extension by incrementing the counter
    await Process.updateOne({ pid }, { $inc: { pathExtensionCounter: 1 } });

    // Set the process to queued
    await Process.updateOne(
      { pid, status: 'extending' },
      {
        $set: {
          status: 'running'
        }
      }
    );
    log.info(`Queued process ${pid} for next step`);
    log.info(`Process ${process.pid} is starting with seeds:`, process.currentStep.seeds);

    let seedsToInsert = process.currentStep.seeds;
    if (process.curPathType === PathType.TRAVERSAL) {
      // For TraversalPath, check for actual seed paths (where seed.url == head.url)
      // Extended paths may have the same head.url but a different seed
      const existingPaths = await TraversalPath.find({
        processId: pid,
        'head.type': HEAD_TYPE.URL,
        'head.url': { $in: process.currentStep.seeds },
        $expr: { $eq: ['$head.url', '$seed.url'] }
      })
        .select('head.url')
        .lean();
      const existingSeedUrls = new Set(existingPaths.map((p) => (p.head as UrlHead).url));
      seedsToInsert = process.currentStep.seeds.filter((s) => !existingSeedUrls.has(s));
    } else {
      const existingPaths = await EndpointPath.find({
        processId: pid,
        'head.type': HEAD_TYPE.URL,
        'head.url': { $in: process.currentStep.seeds }
      })
        .select('head.url')
        .lean();
      const existingSeedUrls = new Set(existingPaths.map((p) => (p.head as UrlHead).url));
      seedsToInsert = process.currentStep.seeds.filter((s) => !existingSeedUrls.has(s));
    }

    if (seedsToInsert.length) {
      await Resource.insertSeeds(seedsToInsert, process.pid);
    }

    await process.notifyStart();
    return true;
  }

  /**
   * Get a running process, most recent first
   * @param skip - number of processes to skip
   * @memberof ProcessClass
   */
  public static async getOneRunning(this: ReturnModelType<typeof ProcessClass>, skip = 0) {
    return this.findOne({ status: 'running' }).sort({ createdAt: -1 }).skip(skip);
  }

  /**
   * Mark the process as done and notify
   */
  public async done() {
    if (this.status === 'done') {
      log.warn(`Process ${this.pid} is already marked as done`);
      return;
    }
    this.status = 'done';
    // Counter is already tracked incrementally via ProcessDoneResource - no aggregation needed!
    // Just ensure it's initialized if undefined/null
    if (
      this.currentStep.doneResourceCount === undefined ||
      this.currentStep.doneResourceCount === null
    ) {
      this.currentStep.doneResourceCount = 0;
      log.warn(`Process ${this.pid} had no doneResourceCount, initialized to 0`);
    }
    // save to DB
    await this.save();

    await this.notifyStepFinished();
  }

  /**
   * Notify that a step has started
   */
  public async notifyStepStarted() {
    return notifyStepStarted(this);
  }

  /**
   * Notify that the process has been created
   */
  public async notifyProcessCreated() {
    return notifyProcessCreated(this);
  }

  /**
   * Notify that a step has finished
   */
  public async notifyStepFinished() {
    return notifyStepFinished(this);
  }

  /**
   * Notify that the process has started
   */
  public async notifyStart() {
    return notifyStart(this);
  }

  /**
   * Reset resources, domains and paths that are stuck in an error state for this process so they can be crawled again.
   * Processes entities in batches to avoid large in-memory sets.
   * @param batchSize - Number of paths to process per batch (default: 1000)
   * @return Summary of reset entities
   */
  public async resetErroredStates(this: ProcessClass, batchSize = 1000) {
    log.warn(`Resetting errored resources, domains and paths for process ${this.pid}`);

    let summary = {
      resources: 0,
      domains: 0,
      paths: 0
    };
    let lastSeenCreatedAt: Date | null = null;
    let lastSeenId: Types.ObjectId | null = null;
    let hasMore = true;

    while (hasMore) {
      const cursorCondition: QueryFilter<PathClass> =
        lastSeenCreatedAt && lastSeenId
          ? {
              createdAt: { $gte: lastSeenCreatedAt },
              _id: { $gt: lastSeenId }
            }
          : {};

      // Fetch a batch of paths for this process
      const paths =
        this.curPathType === PathType.TRAVERSAL
          ? await TraversalPath.find({
              processId: this.pid,
              'head.type': HEAD_TYPE.URL,
              ...cursorCondition
            })
              .sort({ createdAt: 1, _id: 1 })
              .limit(batchSize)
              .select('head.url head.domain createdAt _id')
              .lean()
          : await EndpointPath.find({
              processId: this.pid,
              'head.type': HEAD_TYPE.URL,
              ...cursorCondition
            })
              .sort({ createdAt: 1, _id: 1 })
              .limit(batchSize)
              .select('head.url head.domain createdAt _id')
              .lean();

      if (paths.length === 0) {
        hasMore = false;
        continue;
      }

      const lastPath = paths[paths.length - 1];
      lastSeenCreatedAt = lastPath.createdAt || null;
      // eslint-disable-next-line no-restricted-syntax
      lastSeenId = lastPath._id as Types.ObjectId;

      const pathHeads = paths
        .map((p) => p.head)
        .filter((h): h is UrlHead => h.type === HEAD_TYPE.URL);
      const headUrls = new Set(pathHeads.map((h) => h.url));
      const origins = new Set(pathHeads.map((h) => h.domain.origin));

      const pathQuery = {
        processId: this.pid,
        'head.type': HEAD_TYPE.URL,
        'head.status': 'error',
        'head.url': { $in: Array.from(headUrls) }
      };
      // eslint-disable-next-line no-restricted-syntax
      const pathUpdate = { $set: { 'head.status': 'unvisited' } } as UpdateQuery<PathClass>;
      const headUrlsArray: string[] = Array.from(headUrls);
      const originsArray: string[] = Array.from(origins);
      const [resourceRes, domainRes, pathRes] = await Promise.all([
        Resource.updateMany(
          { status: 'error', url: { $in: headUrlsArray } },
          {
            $set: { status: 'unvisited' },
            $unset: { jobId: '', crawlId: '' }
          }
        ),
        Domain.updateMany(
          { status: 'error', origin: { $in: originsArray } },
          {
            $set: {
              status: 'ready',
              error: false,
              'crawl.ongoing': 0
            },
            $unset: { workerId: '', jobId: '' }
          }
        ),
        this.curPathType === PathType.TRAVERSAL
          ? TraversalPath.updateMany(pathQuery, pathUpdate)
          : EndpointPath.updateMany(pathQuery, pathUpdate)
      ]);

      summary.resources += resourceRes.modifiedCount ?? resourceRes.matchedCount ?? 0;
      summary.domains += domainRes.modifiedCount ?? domainRes.matchedCount ?? 0;
      summary.paths += pathRes.modifiedCount ?? pathRes.matchedCount ?? 0;

      log.debug(`Reset error state in paths batch: ${paths.length} paths processed`);
    }

    log.info(`Errored entities reset for process ${this.pid}`, summary);
    return summary;
  }
}

const Process = getModelForClass(ProcessClass, {
  schemaOptions: { timestamps: true, collection: 'processes' }
});

export type ProcessDocument = DocumentType<ProcessClass>;

export { Process, ProcessClass };
