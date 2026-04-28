import {
  StepClass,
  Process,
  ProcessClass,
  Resource,
  NamedNodeTriple,
  LiteralTriple,
  NamedNodeTripleClass,
  LiteralTripleClass,
  TraversalPath,
  EndpointPath,
  type ProcessDocument,
  type PredicateLimitationType,
  buildStepPathQuery
} from '@derzis/models';
import { PathType, type RecursivePartial } from '@derzis/common';
import { secondsToString, type MakeOptional } from './utils';
import { createLogger } from '@derzis/common/server';
import config from '@derzis/config';
const log = createLogger('process-helper');

/**
 * Create a new process and queue it for execution.
 * @param p Process parameters
 */
export async function newProcess(p: RecursivePartial<ProcessClass>): Promise<ProcessDocument> {
  const seedsInput = p.currentStep!.seeds!;
  const uniqueSeedsSet = new Set(seedsInput);
  const uniqueSeeds = [...uniqueSeedsSet];

  p.currentStep!.seeds = uniqueSeeds;

  const pathHeads: Map<string, number> = new Map();
  for (const s of uniqueSeeds) {
    const domain = new URL(s).origin;
    if (!pathHeads.get(domain)) {
      pathHeads.set(domain, 0);
    }
    pathHeads.set(domain, pathHeads.get(domain)! + 1);
  }

  p.pathHeads = Object.fromEntries(pathHeads.entries());

  // Build the process creation object with required fields
  // Use type assertion to satisfy Process.create requirements
  const processData = {
    steps: p.steps!,
    currentStep: p.currentStep!,
    notification: p.notification!,
    pathHeads: p.pathHeads,
    pathType: p.curPathType ?? config.manager.pathType ?? PathType.ENDPOINT
  } as Parameters<typeof Process.create>[0];

  const proc = await Process.create(processData);
  await proc.notifyProcessCreated();

  await Process.startNext();

  return proc;
}

/**
 * Add a new step to a finished process and queue it for execution.
 * @param pid Process ID
 * @param params Step parameters
 */
export async function addStep(
  pid: string,
  params: MakeOptional<StepClass, 'seeds'> & {
    predLimitations?: { predicate: string; lims: PredicateLimitationType[] }[];
  }
) {
  const p = await Process.findOne({ pid, status: 'done' });

  if (!p) {
    throw new Error('Process not found');
  }

  const allPreviousSeeds = new Set(p.steps.flatMap((step) => step.seeds || []));

  const inputSeeds = params.seeds || [];
  const uniqueInputSeedsSet = new Set(inputSeeds);
  const uniqueInputSeeds = [...uniqueInputSeedsSet];

  const newSeeds = uniqueInputSeeds.filter((s) => !allPreviousSeeds.has(s));
  const newMPL = params.maxPathLength;
  const newMPP = params.maxPathProps;

  const newStep = {
    seeds: [...allPreviousSeeds, ...newSeeds],
    maxPathLength: newMPL,
    maxPathProps: newMPP,
    predLimit: params.predLimit,
    predLimitations: params.predLimitations,
    followDirection: params.followDirection as boolean,
    predsBranchFactor: params.predsBranchFactor,
    convertToEndpointPaths: params.convertToEndpointPaths ?? false
  };

  try {
    // Add the new step
    await Process.updateOne(
      { pid, status: 'done' },
      {
        $push: { steps: newStep },
        $set: {
          status: 'queued',
          currentStep: newStep
        },
        $inc: { pathExtensionCounter: 1 }
      }
    );
    log.info(`Added step to process ${pid}`);
  } catch (err) {
    log.error(`Error adding step to process ${pid}: ${(err as Error).message}`);
    throw err;
  }
}

/**
 * Get detailed info about a process.
 * @param pid Process ID
 */
export async function info(pid: string): Promise<any> {
  const _p: any = await Process.findOne({ pid }).lean();
  if (!_p) {
    return;
  }

  const lastResource = await Resource.findOne().sort({ updatedAt: -1 }); // TODO this should be process specific
  const lastNNT = await NamedNodeTriple.findOne().sort({ updatedAt: -1 });
  const lastLT = await LiteralTriple.findOne().sort({ updatedAt: -1 });
  const lastTriple = [lastLT, lastNNT].reduce<LiteralTripleClass | NamedNodeTripleClass | null>(
    (latest, t) => {
      if (!t || !t.updatedAt) return latest;
      return !latest || !latest.updatedAt || t.updatedAt > latest.updatedAt ? t : latest;
    },
    null as LiteralTripleClass | NamedNodeTripleClass | null
  );

  const lastPath = await TraversalPath.findOne().sort({ updatedAt: -1 });
  const last = Math.max(
    lastResource?.updatedAt?.getTime() || 0,
    lastTriple?.updatedAt?.getTime() || 0,
    lastPath?.updatedAt?.getTime() || 0
  );

  const timeToLastResource = lastResource
    ? (lastResource!.updatedAt.getTime() - _p.createdAt!.getTime()) / 1000
    : null;
  const timeRunning = last ? (last - _p.createdAt!.getTime()) / 1000 : null;

  // Build current step query if available and count paths
  let currentStepQuery: any;
  let currentStepQueryPathCount: number | undefined;

  if (_p.currentStep) {
    const pathType = _p.curPathType ?? PathType.ENDPOINT;
    currentStepQuery = buildStepPathQuery(_p, pathType);
    if (pathType === PathType.TRAVERSAL) {
      currentStepQueryPathCount = await TraversalPath.countDocuments(currentStepQuery);
    } else {
      currentStepQueryPathCount = await EndpointPath.countDocuments(currentStepQuery);
    }
  } else {
    currentStepQuery = undefined;
  }

  const processInfo = {
    ..._p,
    createdAt: _p.createdAt?.toISOString(),
    updatedAt: _p.updatedAt?.toISOString() || _p.createdAt,
    timeToLastResource: timeToLastResource ? secondsToString(timeToLastResource) : '',
    timeRunning: timeRunning ? secondsToString(timeRunning) : '',
    notification: {
      ..._p.notification,
      email: _p?.notification?.email
        ?.replace(/(?<=.).*?(?=.@)/, (x: string) => '*'.repeat(x.length))
        ?.replace(/^..(?=@)/, '**')
    },
    currentStepQuery,
    currentStepQueryPathCount
  };

  return processInfo;
}
