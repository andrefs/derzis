import { Types, Document } from 'mongoose';
import { Resource } from './Resource';
import { Triple, TripleClass } from './Triple';
import { humanize } from 'humanize-digest';
import { Domain } from './Domain';
import { Path, type PathSkeleton, type PathDocument } from './Path';
import { ProcessTriple } from './ProcessTriple';
import { HttpError, createLogger } from '@derzis/common';
const log = createLogger('Process');
import {
  prop,
  index,
  getModelForClass,
  pre,
  type ReturnModelType,
  PropType,
  post,
  type DocumentType
} from '@typegoose/typegoose';
import { sendEmail } from '@derzis/common';

export class NotificationClass {
  _id?: Types.ObjectId | string;

  @prop({ type: String })
  public email?: string;

  @prop({ type: String })
  public webhook?: string;

  @prop({ type: String })
  public ssePath?: string;
}
export class StepClass {
  _id?: Types.ObjectId | string;

  @prop({ required: true, type: String }, PropType.ARRAY)
  public seeds!: string[];

  @prop({ default: 2, required: true, type: Number })
  public maxPathLength!: number;

  @prop({ default: 1, required: true, type: Number })
  public maxPathProps!: number;

  @prop({ default: [], type: [String] }, PropType.ARRAY)
  public whiteList?: string[];

  @prop({ default: [], type: [String] }, PropType.ARRAY)
  public blackList?: string[];
}

@index({ status: 1 })
@index({ createdAt: 1 })
@pre<ProcessClass>('save', async function() {
  const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
  const count = await Process.countDocuments({
    createdAt: { $gt: today }
  });
  if (!this.pid) {
    const date = today.toISOString().split('T')[0] + '-' + count;
    const word = humanize('process' + date);
    this.pid = `${word}-${date}`;
  }
  if (!this.notification) {
    this.notification = {};
  }
  const ssePath = `/processes/${this.pid}/events`;
  this.notification.ssePath = ssePath;
})
class ProcessClass {
  _id!: Types.ObjectId | string;
  createdAt?: Date;
  updatedAt?: Date;

  @prop({ index: true, unique: true, type: String })
  public pid!: string;

  @prop({ required: true, type: NotificationClass })
  public notification!: NotificationClass;

  @prop({ type: String })
  public description?: string;

  @prop({ required: true, type: StepClass })
  public currentStep!: StepClass;

  @prop({ required: true, default: [], type: [StepClass] }, PropType.ARRAY)
  public steps!: StepClass[];

  @prop({ required: true, type: Object })
  public pathHeads!: {
    required: true;
    type: { [key: string]: number };
  };

  @prop({
    enum: ['queued', 'running', 'done', 'error'],
    default: 'queued',
    type: String
  })
  public status!: 'queued' | 'running' | 'done' | 'error';

  public whiteBlackListsAllow(this: ProcessClass, t: TripleClass) {
    // triple predicate allowed by white/blacklist
    if (
      this.currentStep.whiteList?.length &&
      !matchesOne(t.predicate, this.currentStep.whiteList)
    ) {
      return false;
    }
    if (this.currentStep.blackList?.length && matchesOne(t.predicate, this.currentStep.blackList)) {
      return false;
    }
    return true;
  }

  public async isDone(this: ProcessClass) {
    // process is done
    if (['done', 'error'].includes(this.status)) {
      return true;
    }

    const pathsToCrawl = await this.getPathsForDomainCrawl(0, 1);
    const pathsToCheck = await this.getPathsForRobotsChecking(0, 1);
    const hasPathsChecking = await this.hasPathsDomainRobotsChecking();
    const hasPathsCrawling = await this.hasPathsHeadBeingCrawled();

    // no more paths to crawl and no paths checking or crawling
    if (!pathsToCrawl.length && !pathsToCheck.length && !hasPathsChecking && !hasPathsCrawling) {
      log.warn(
        `Process ${this.pid} has no more paths for checking or crawling, and there there are no paths currently being checked or crawled. Marking process as done.`
      );
      log.silly(
        JSON.stringify({
          pathsToCrawl: pathsToCrawl.length,
          pathsToCheck: pathsToCheck.length,
          hasPathsChecking,
          hasPathsCrawling
        })
      );
      // mark as done and notify
      await this.done();
      return true;
    }

    // process is not done
    log.info(`Process ${this.pid} is not done yet:`, {
      pathsToCrawl,
      pathsToCheck,
      hasPathsChecking,
      hasPathsCrawling
    });
    return false;
  }

  public async *getTriples(this: ProcessClass) {
    const procTriples = ProcessTriple.find({
      processId: this.pid
    }).populate('triple');
    for await (const procTriple of procTriples) {
      const triple = procTriple.triple;
      yield {
        subject: triple.subject,
        predicate: triple.predicate,
        object: triple.predicate
      };
    }
  }

  public async *getTriplesJson(this: ProcessClass) {
    for await (const t of this.getTriples()) {
      yield JSON.stringify(t);
    }
  }

  public async getPathsForRobotsChecking(skip = 0, limit = 20) {
    const paths: PathDocument[] = await Path.find({
      processId: this.pid,
      'head.domain.status': 'unvisited',
      'nodes.count': { $lt: this.currentStep.maxPathLength },
      'predicates.count': { $lte: this.currentStep.maxPathProps }
    })
      // shorter paths first
      .sort({ 'nodes.count': 1 })
      .limit(limit)
      .skip(skip)
      .select('head.domain head.url')
      .lean();
    return paths;
  }

  /**
   * Get paths that are ready to be crawled
   * @param skip - number of paths to skip
   * @param limit - number of paths to return
   * @returns {Promise<PathDocument[]>} - paths
   * @memberof ProcessClass
   */
  public async getPathsForDomainCrawl(skip = 0, limit = 20): Promise<PathDocument[]> {
    const paths: PathDocument[] = await Path.find({
      processId: this.pid,
      'head.domain.status': 'ready',
      'head.status': 'unvisited',
      'nodes.count': { $lt: this.currentStep.maxPathLength },
      'predicates.count': { $lte: this.currentStep.maxPathProps }
    })
      // shorter paths first
      .sort({ 'nodes.count': 1 })
      .limit(limit)
      .skip(skip)
      .select('head.domain head.url head.status')
      .lean();
    return paths;
  }

  /**
   * Check if process has paths whose head's domain is currently being robots-checked
   * @returns {Promise<boolean>} - true if there are paths
   * @memberof ProcessClass
   */
  public async hasPathsDomainRobotsChecking(): Promise<boolean> {
    const paths = await Path.find({
      processId: this.pid,
      'head.domain.status': 'checking'
    });
    return !!paths.length;
  }

  /**
   * Check if process has paths whose head's url is currently being crawled
   * @returns {Promise<boolean>} - true if there are paths
   * @memberof ProcessClass
   */
  public async hasPathsHeadBeingCrawled(): Promise<boolean> {
    const paths = await Path.find({
      processId: this.pid,
      'head.status': 'crawling'
    });
    return !!paths.length;
  }

  public async extendPathsWithExistingTriples(paths: PathDocument[]) {
    for (const path of paths) {
      const newPathObjs = [];
      const toDelete = new Set();
      const procTriples = new Set();

      const { newPaths: nps, procTriples: pts } = await path.extendWithExistingTriples();

      // if new paths were created
      if (nps.length) {
        toDelete.add(path._id);
        newPathObjs.push(...nps);
        for (const pt of pts) {
          procTriples.add(pt);
        }

        // create new paths
        const newPaths = await Path.create(newPathObjs);

        // delete old paths
        await Path.deleteMany({ _id: { $in: Array.from(toDelete) } });

        await this.extendPathsWithExistingTriples(newPaths);
      }
    }
  }

  public async extendPaths(triplesByNode: { [headUrl: string]: TripleClass[] }) {
    const newHeads = Object.keys(triplesByNode);
    log.silly('New heads:', newHeads);
    const paths = await Path.find({
      processId: this.pid,
      'head.url': newHeads.length === 1 ? newHeads[0] : { $in: Object.keys(triplesByNode) }
    });
    log.silly('Paths:', paths);

    const pathsToDelete = new Set();
    const newPathObjs = [];
    const toDelete = new Set();
    const procTriples = new Set();

    for (const path of paths) {
      const { newPaths: nps, procTriples: pts } = await path.extend(triplesByNode[path.head.url]);
      log.silly('New paths:', nps);
      if (nps.length) {
        toDelete.add(path._id);
        newPathObjs.push(...nps);
        for (const pt of pts) {
          procTriples.add(pt);
        }
      }
    }

    await updateNewPathHeadStatus(newPathObjs);

    // add proc-triple associations
    await ProcessTriple.insertMany(
      [...procTriples].map((tId) => ({ processId: this.pid, triple: tId }))
    );

    // create new paths
    const newPaths = await Path.create(newPathObjs);

    // delete old paths
    await Path.deleteMany({ _id: { $in: Array.from(toDelete) } });

    // add existing heads
    await this.extendPathsWithExistingTriples(newPaths);
  }

  public async updateLimits(this: ProcessClass) {
    const paths = Path.find({
      processId: this.pid,
      outOfBounds: { $exists: true }
    });

    for await (const path of paths) {
      const { newPaths, procTriples } = await path.extendWithExistingTriples();
      await ProcessTriple.insertMany(
        [...procTriples].map((tId) => ({ processId: this.pid, triple: tId }))
      );
      await Path.create(newPaths);
    }
  }

  public async getResourceCount(this: ProcessClass) {
    const res = await ProcessTriple.aggregate(
      [
        {
          $match: {
            processId: this.pid
          }
        },
        { $group: { _id: '$triple' } },
        {
          $lookup: {
            from: 'triples',
            localField: '_id',
            foreignField: '_id',
            as: 'ts'
          }
        },
        {
          $unwind: {
            path: '$ts',
            preserveNullAndEmptyArrays: true
          }
        },
        { $project: { sources: '$ts.sources' } },
        {
          $unwind: {
            path: '$sources',
            preserveNullAndEmptyArrays: true
          }
        },
        { $group: { _id: '$sources' } },
        { $count: 'count' }
      ],
      { maxTimeMS: 60000, allowDiskUse: true }
    );
    return res[0].count;
  }

  public async getInfo(this: DocumentType<ProcessClass>) {
    const baseFilter = { processId: this.pid };
    const lastResource = await Resource.findOne().sort({ updatedAt: -1 }); // TODO these should be process specific
    const lastTriple = await Triple.findOne().sort({ updatedAt: -1 });
    const lastPath = await Path.findOne().sort({ updatedAt: -1 });
    const last = Math.max(
      lastResource?.updatedAt.getTime() || 0,
      lastTriple?.updatedAt.getTime() || 0,
      lastPath?.updatedAt.getTime() || 0
    );

    const timeToLastResource = lastResource
      ? (lastResource!.updatedAt.getTime() - this.createdAt!.getTime()) / 1000
      : null;
    const timeRunning = last ? (last - this.createdAt!.getTime()) / 1000 : null;

    return {
      resources: {
        total: await this.getResourceCount(),
        done: await Resource.countDocuments({
          ...baseFilter,
          status: 'done'
        }).lean(), // TODO add index
        crawling: await Resource.countDocuments({
          ...baseFilter,
          status: 'crawling'
        }).lean(), // TODO add index
        error: await Resource.countDocuments({
          ...baseFilter,
          status: 'error'
        }).lean() // TODO add index
        //seed: await Resource.countDocuments({
        //  ...baseFilter,
        //  isSeed: true,
        //}).lean(), // TODO add index
      },
      triples: {
        total: await ProcessTriple.countDocuments(baseFilter).lean()
      },
      domains: {
        total: await Domain.countDocuments(baseFilter).lean(),
        beingCrawled: (
          await Domain.find({ ...baseFilter, status: 'crawling' })
            .select('origin')
            .lean()
        ).map((d) => d.origin),
        ready: await Domain.countDocuments({
          ...baseFilter,
          status: 'ready'
        }).lean(), // TODO add index
        crawling: await Domain.countDocuments({
          ...baseFilter,
          status: 'crawling'
        }).lean(), // TODO add index
        error: await Domain.countDocuments({
          ...baseFilter,
          status: 'error'
        }).lean() // TODO add index
      },
      paths: {
        total: await Path.countDocuments({
          'seed.url': { $in: this.currentStep.seeds }
        }).lean(),
        finished: await Path.countDocuments({
          'seed.url': { $in: this.currentStep.seeds },
          status: 'finished'
        }).lean(), // TODO add index
        disabled: await Path.countDocuments({
          'seed.url': { $in: this.currentStep.seeds },
          status: 'disabled'
        }).lean(), // TODO add index
        active: await Path.countDocuments({
          'seed.url': { $in: this.currentStep.seeds },
          status: 'active'
        }).lean() // TODO add index
      },
      // TODO remove allPaths
      allPaths: {
        total: await Path.countDocuments().lean(),
        finished: await Path.countDocuments({ status: 'finished' }).lean(), // TODO add index
        disabled: await Path.countDocuments({ status: 'disabled' }).lean(), // TODO add index
        active: await Path.countDocuments({ status: 'active' }).lean() // TODO add index
      },
      createdAt: this.createdAt,

      timeToLastResource: timeToLastResource || '',
      timeRunning: timeRunning || '',
      currentStep: this.currentStep,
      steps: this.steps,
      notification: this.notification,
      status: this.status
    };
  }

  // TODO configurable number of simultaneous processes
  public static async startNext(this: ReturnModelType<typeof ProcessClass>) {
    const runningProcs = await this.countDocuments({ status: 'running' });

    if (!runningProcs) {
      const process = await this.findOneAndUpdate(
        { status: 'queued' },
        { $set: { status: 'running' } },
        { new: true }
      );
      if (process) {
        await Resource.insertSeeds(process.currentStep.seeds, process.pid);
        return true;
      }
    }
    return false;
  }

  /**
   * Get a running process, most recent first
   * @param skip - number of processes to skip
   * @memberof ProcessClass
   */
  public static async getOneRunning(this: ReturnModelType<typeof ProcessClass>, skip = 0) {
    return this.findOne({ status: 'running' }).sort({ createdAt: -1 }).skip(skip);
  }

  public async done() {
    await Process.updateOne({ pid: this.pid }, { $set: { status: 'done' } });
    await this.notifyStep();
  }

  public async notifyStep() {
    const notif: StepNotification = {
      ok: true,
      messageType: 'OK_STEP_FINISHED',
      message: `Process ${this.pid} just finished step #${this.steps.length}.`,
      details: this.steps[this.steps.length - 1]
    };

    if (this.notification.email) {
      await notifyEmail(this.notification.email, notif);
    }
    if (this.notification.webhook) {
      await notifyWebhook(this.notification.webhook, notif);
    }
  }
}

const notifyEmail = async (email: string, notif: ProcessNotification) => {
  const res = await sendEmail({
    to: email,
    from: 'derzis@andrefs.com',
    text: notif.message,
    html: `<p>${notif.message}</p>`,
    subject: 'Derzis - Event'
  });
  return res;
};
const notifyWebhook = async (webhook: string, notif: ProcessNotification) => {
  let retries = 0;
  while (retries < 3) {
    try {
      const res = await fetch(webhook, {
        method: 'POST',
        body: JSON.stringify(notif),
        headers: { 'Content-Type': 'application/json' }
      });
      return res;
    } catch (e) {
      retries++;
    }
  }
};

interface BaseProcNotification {
  ok: boolean;
  messageType: string;
  message: string;
  details: any;
}

type ProcStartNotification = BaseProcNotification & {
  ok: true;
  messageType: 'OK_PROCESS_STARTED';
  message: string;
};

type StepNotification = BaseProcNotification & {
  details: StepClass;
  ok: true;
  messageType: 'OK_STEP_FINISHED';
};

type ProcessNotification = StepNotification | ProcStartNotification;

const matchesOne = (str: string, patterns: string[]) => {
  let matched = false;
  for (const p of patterns) {
    // pattern is a regex
    if (/^\/(.*)\/$/.test(p)) {
      const re = new RegExp(p);
      if (re.test(str)) {
        matched = true;
        break;
      }
      continue;
    }
    // pattern is a URL prefix
    try {
      const url = new URL(p);
      if (str.startsWith(p)) {
        matched = true;
        break;
      }
    } catch (e) {
      continue;
    }
    // pattern is a string
    if (str.includes(p)) {
      matched = true;
      break;
    }
  }
  return matched;
};

async function updateNewPathHeadStatus(newPaths: PathSkeleton[]): Promise<void> {
  const headUrls = newPaths.map((p) => p.head.url);
  const resources = await Resource.find({ url: { $in: headUrls } })
    .select('url status')
    .lean();
  const resourceMap: { [url: string]: 'unvisited' | 'done' | 'crawling' | 'error' } = {};
  resources.forEach((r) => (resourceMap[r.url] = r.status));
  newPaths.forEach((p) => (p.head.status = resourceMap[p.head.url] || 'unvisited'));
}

const Process = getModelForClass(ProcessClass, {
  schemaOptions: { timestamps: true, collection: 'processes' }
});

type ProcessDocument = ProcessClass & Document;

export { Process, ProcessClass, type ProcessDocument };
