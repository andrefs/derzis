import {
  TraversalPath,
  type TraversalPathSkeleton,
  type TraversalPathDocument,
  EndpointPath,
  TraversalPathClass,
  EndpointPathClass,
  type PathSkeleton
} from '../Path';
import { Process, ProcessClass } from './Process';
import { createLogger } from '@derzis/common/server';
import { ProcessTriple } from '../ProcessTriple';
import { Resource } from '../Resource';
const log = createLogger('ProcessPaths');
import { FilterQuery, Types } from 'mongoose';
import { Triple } from '../Triple';
import { PathClass } from '../Path';
import { type PathType } from '@derzis/common';

/**
 * Get paths for a process that are ready for robots checking, based on the head domain status and path limits.
 * @param process ProcessClass instance
 * @param pathType Type of paths to retrieve ('traversal' or 'endpoint')
 * @param skip Number of paths to skip (for pagination)
 * @param limit Maximum number of paths to return
 * @returns Array of TraversalPathClass or EndpointPathClass documents with only head domain origin selected
 */
export async function getPathsForRobotsChecking(
  process: ProcessClass,
  pathType: PathType,
  skip = 0,
  limit = 20
): Promise<TraversalPathClass[] | EndpointPathClass[]> {
  const baseQuery = {
    processId: process.pid,
    status: 'active',
    'head.domain.status': 'unvisited'
  };
  const select = 'head.domain.origin';

  if (pathType === 'traversal') {
    const paths = await TraversalPath.find({
      ...baseQuery,
      'nodes.count': { $lt: process.currentStep.maxPathLength },
      'predicates.count': { $lte: process.currentStep.maxPathProps }
    })
      // shorter paths first
      .sort({ 'nodes.count': 1 })
      .limit(limit)
      .skip(skip)
      .select(select)
      .lean();
    return paths;
  } else {
    const paths = await EndpointPath.find({
      ...baseQuery,
      'shortestPath.length': { $lte: process.currentStep.maxPathLength },
      frontier: true
    })
      .sort({ 'shortestPath.length': 1 })
      .limit(limit)
      .skip(skip)
      .select(select)
      .lean();
    return paths;
  }
}

/**
 * Get paths for a process that are ready for domain crawling, based on the head domain status, head resource status and path limits.
 * @param process ProcessClass instance
 * @param pathType Type of paths to retrieve ('traversal' or 'endpoint')
 * @param domainBlacklist Array of domain origins to exclude from the results
 * @param skip Number of paths to skip (for pagination)
 * @param limit Maximum number of paths to return
 * @returns Array of TraversalPathClass or EndpointPathClass documents with head domain origin, head URL, head status, nodes and predicates selected
 */
export async function getPathsForDomainCrawl(
  process: ProcessClass,
  pathType: PathType,
  domainBlacklist: string[] = [],
  skip = 0,
  limit = 20
): Promise<TraversalPathClass[] | EndpointPathClass[]> {
  const baseQuery = {
    processId: process.pid,
    status: 'active',
    'head.domain.status': 'ready',
    'head.domain.origin': domainBlacklist.length ? { $nin: domainBlacklist } : { $exists: true },
    'head.status': 'unvisited'
  };
  const select = 'head.status head.domain.origin head.url';

  if (pathType === 'traversal') {
    const predLimFilter =
      process.currentStep.predLimit.limType === 'whitelist'
        ? { 'predicates.elems': { $in: process.currentStep.predLimit.limPredicates } }
        : { 'predicates.elems': { $nin: process.currentStep.predLimit.limPredicates } };
    const paths = await TraversalPath.find({
      ...baseQuery,
      'nodes.count': { $lt: process.currentStep.maxPathLength },
      'predicates.count': { $lte: process.currentStep.maxPathProps },
      ...predLimFilter
    })
      // shorter paths first
      .sort({ 'nodes.count': 1 })
      .limit(limit)
      .skip(skip)
      .select(select);
    return paths;
  } else {
    const paths = await EndpointPath.find({
      ...baseQuery,
      'shortestPath.length': { $lte: process.currentStep.maxPathLength },
      frontier: true
    })
      .sort({ 'shortestPath.length': 1 })
      .limit(limit)
      .skip(skip)
      .select(select);
    return paths;
  }
}

export async function hasPathsDomainRobotsChecking(process: ProcessClass): Promise<boolean> {
  const pathsCount = await TraversalPath.countDocuments({
    processId: process.pid,
    status: 'active',
    'head.domain.status': 'checking'
  });
  return !!pathsCount;
}

export async function hasPathsHeadBeingCrawled(process: ProcessClass): Promise<boolean> {
  const pathsCount = await TraversalPath.countDocuments({
    processId: process.pid,
    status: 'active',
    'head.status': 'crawling'
  });
  return !!pathsCount;
}

export async function extendPathsWithExistingTriples(proc: ProcessClass, paths: PathClass[]) {
  log.silly(`Extending ${paths.length} paths for process ${proc.pid} with existing triples...`);

  let newPaths = [];

  for (const path of paths) {
    const res = await path.extendWithExistingTriples(proc);

    if (!res.extendedPaths.length) {
      const length = path instanceof TraversalPath ? path.nodes.count : path instanceof EndpointPath ? path.shortestPath.length : 'N/A';
      const predicates = path instanceof TraversalPath ? path.predicates.elems : null;

      log.silly(`No new paths created from path ${path._id} (seed ${path.seed.url}, head ${path.head.url}, length ${length}, ${predicates ? 'predicates ' + predicates : ''})`);

      continue;
    }

    await insertProcTriples(proc.pid, new Set(res.procTriples), proc.steps.length);
    await deleteOldPaths(new Set([path._id]), path.type);
    // if new paths were created
    newPaths.push(...(await createNewPaths(res.extendedPaths, path.type)));
  }

  if (newPaths.length) {
    // extend newly created paths recursively
    await extendPathsWithExistingTriples(proc, newPaths);
  } else {
    log.silly('No new paths to extend further.');
  }
}

/**
 * Generate a MongoDB query to find active paths for a process that can be extended based on the current step limits.
 * @param process ProcessClass instance
 * @returns MongoDB query object
 */
export function genTraversalPathQuery(process: ProcessClass): FilterQuery<TraversalPathDocument> {
  const baseQuery = {
    processId: process.pid,
    status: 'active',
    'nodes.count': { $lt: process.currentStep.maxPathLength },
  };
  const limType = process.currentStep.predLimit?.limType;
  const limPredicates = process.currentStep.predLimit?.limPredicates || [];
  const maxPathProps = process.currentStep.maxPathProps;
  const queryOr = []

  // if there is no predicate limit, any path can be extended
  if (!process.currentStep.predLimit) {
    queryOr.push({
      'predicates.count': { $lte: maxPathProps }
    });
  }
  // if there is a whitelist, only paths that have less than maxPathProps predicates
  // or that have at least one of the white listed predicates can be extended
  else if (limType === 'whitelist') {
    queryOr.push({
      'predicates.count': { $lt: maxPathProps },
    });
    queryOr.push({
      'predicates.count': maxPathProps,
      'predicates.elems': limPredicates.length === 1 ? limPredicates[0] : { $in: limPredicates }
    });
  }
  // if there is a blacklist, only paths that have less than maxPathProps predicates
  // or that have at least one predicate that is not in the black list can be extended
  else if (limType === 'blacklist') {
    queryOr.push({
      'predicates.count': maxPathProps,
    });
    const predElemsCondition = limPredicates.length === 1
      ? { 'predicates.elems': { $ne: limPredicates[0] } }
      : {
        $expr: {
          $not: {
            $setIsSubset: ['$predicates.elems', limPredicates]
          }
        }
      };
    queryOr.push({
      'predicates.count': { $lte: maxPathProps },
      ...predElemsCondition
    });
  }

  const query = queryOr.length > 1
    ? { ...baseQuery, $or: queryOr }
    : { ...baseQuery, ...queryOr[0] };
  return query;
}


/**
 * Extend existing active paths for a process according to its current step limits.
 * @param pid Process ID
 */
export async function extendExistingPaths(pid: string) {
  const process = await Process.findOne({ pid });
  if (!process) {
    log.warn(`Process ${pid} not found. Skipping extendExistingPaths.`);
    return;
  }
  if (process.status !== 'extending') {
    log.warn(`Process ${process.pid} is not in 'extending' status. Skipping extendExistingPaths.`);
    return;
  }

  // Process paths in batches to avoid using up too much memory
  const batchSize = 100;
  let skip = 0;
  let hasMore = true;
  const query = genTraversalPathQuery(process);

  // Get total number of paths to process
  const initPathsCount = await TraversalPath.countDocuments(query);

  let processedPaths = 0;
  const startTime = Date.now();
  let batchCounter = 0;

  while (hasMore) {
    batchCounter++;
    const batchStartTime = Date.now();
    const curPathsCount = await TraversalPath.countDocuments(query);

    // find a batch of active paths that can be extended
    const paths = await TraversalPath.find(query)
      .sort({ createdAt: 1 }) // older paths first
      .limit(batchSize)
      .skip(skip);

    if (paths.length === 0) {
      hasMore = false;
      break;
    }

    //const percentage = Math.round((processedPaths / initPathsCount) * 100);
    const percentage = Math.round((skip / curPathsCount) * 100);
    const elapsedTime = (Date.now() - startTime) / 1000;

    //log.info(`Extending batch of ${paths.length} existing paths for process ${process.pid} (${processedPaths}/${initPathsCount} - ${percentage}%)`);
    log.info(
      `Extending batch of ${paths.length} existing paths for process ${process.pid} (${skip}/${curPathsCount} - ${percentage}%)`
    );

    await extendPathsWithExistingTriples(process, paths);
    processedPaths += paths.length;

    const batchTime = (Date.now() - batchStartTime) / 1000;
    log.info(
      `Batch ${batchCounter} completed in ${batchTime.toFixed(2)}s (Total elapsed: ${elapsedTime.toFixed(2)}s)`
    );

    // add a 1s delay between batches to reduce DB load
    log.debug('Waiting 1s before processing the next batch...');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    log.silly('Continuing to next batch...');

    skip += batchSize;
  }

  const totalTime = (Date.now() - startTime) / 1000;
  log.info(
    `Finished extending existing paths for process ${process.pid}. Total time: ${totalTime.toFixed(2)}s`
  );
}

/**
 * Helper function to insert process-triple associations in bulk.
 * @param pid Process ID
 * @param procTriples Set of triple IDs to associate with the process
 * @param procStep Current step number of the process
 */
async function insertProcTriples(pid: string, procTriples: Set<Types.ObjectId>, procStep: number) {
  if (procTriples.size) {
    // add proc-triple associations
    await ProcessTriple.upsertMany(
      [...procTriples].map((tId) => ({
        processId: pid,
        triple: tId,
        processStep: procStep
      }))
    );
  } else {
    log.silly('No new process-triple associations to add.');
  }
}

/**
 * Helper function to create new paths in bulk.
 * @param pathsToCreate Array of PathSkeleton objects to create as new paths
 * @param pathType Type of paths to create ('traversal' or 'endpoint')
 * @returns Array of created PathClass documents
 */
async function createNewPaths(
  pathsToCreate: PathSkeleton[],
  pathType: PathType
): Promise<PathClass[]> {
  if (pathsToCreate.length) {
    // update head status of new paths
    await setNewPathHeadStatus(pathsToCreate);

    // create new paths
    return pathType === 'traversal'
      ? await TraversalPath.create(pathsToCreate)
      : await EndpointPath.create(pathsToCreate);
  } else {
    log.silly('No new paths to create.');
    return [];
  }
}

/**
 * * Helper function to mark old paths as deleted in bulk.
 * @param pathsToDelete Set of path IDs to mark as deleted
 * @param pathType Type of paths to delete ('traversal' or 'endpoint')
 */
async function deleteOldPaths(pathsToDelete: Set<Types.ObjectId>, pathType: PathType) {
  if (pathsToDelete.size) {
    const pathQuery = {
      _id: { $in: Array.from(pathsToDelete) },
      'head.status': 'done'
    };
    const pathUpdate = { $set: { status: 'deleted' } };

    // mark old paths as deleted if their head status is 'done'

    if (pathType === 'traversal') {
      await TraversalPath.updateMany(pathQuery, pathUpdate);
    } else {
      await EndpointPath.updateMany(pathQuery, pathUpdate);
    }
  } else {
    log.silly('No old paths to delete.');
  }
}

/**
 * Extend active paths for a process that have a specific head URL, based on the triples connected to that URL.
 * @param process ProcessClass instance
 * @param headUrl URL of the head node to extend paths from
 * @param pathType Type of paths to extend ('traversal' or 'endpoint')
 */
export async function extendProcessPaths(
  process: ProcessClass,
  headUrl: string,
  pathType: PathType
) {
  log.info(`Extending paths for process ${process.pid} with head URL: ${headUrl}`);
  const pathQuery = {
    processId: process.pid,
    status: 'active',
    'head.url': headUrl
  };

  const batchSize = 100;
  let hasMorePaths = true;
  let skipPaths = 0;

  let newPaths = [];
  // process paths in batches to avoid using up too much memory
  while (hasMorePaths) {
    const paths =
      pathType === 'traversal'
        ? await TraversalPath.find(pathQuery)
          .sort({ 'nodes.count': 1 })
          .limit(batchSize)
          .skip(skipPaths)
        : await EndpointPath.find(pathQuery)
          .sort({ 'shortestPath.length': 1 })
          .limit(batchSize)
          .skip(skipPaths);
    skipPaths += batchSize;

    if (!paths.length) {
      log.info(`No active paths found for process ${process.pid} with head URL: ${headUrl}`);
      hasMorePaths = false;
      break;
    }

    let hasMoreTriples = true;
    let skipTriples = 0;
    // process triples in batches to avoid using up too much memory
    while (hasMoreTriples) {
      const triples = await Triple.find({ nodes: headUrl })
        .sort({ createdAt: 1 }) // older triples first
        .limit(batchSize)
        .skip(skipTriples);
      skipTriples += batchSize;

      if (!triples.length) {
        log.info(`No triples found connected to head URL: ${headUrl}`);
        hasMoreTriples = false;
        break;
      }

      // extend each path with the new triples and gather new paths and proc-triple associations
      for (const path of paths) {
        const res = await path.genExtended(triples, process);
        log.silly('Extended paths:', res.extendedPaths);
        // make db operations immediately for each path to avoid keeping too many new paths in memory
        if (res.extendedPaths.length) {
          await insertProcTriples(process.pid, new Set(res.procTriples), process.steps.length);
          newPaths.push(...(await createNewPaths(res.extendedPaths, pathType)));
          await deleteOldPaths(new Set([path._id]), pathType);
        }
      }
    }

    if (newPaths.length) {
      // recursively extend newly created paths
      await extendPathsWithExistingTriples(process, newPaths);
    } else {
      log.silly('No new paths to extend further.');
    }
  }
}

/**
 * Set the head status of new paths based on existing Resource statuses.
 * @param newPaths Array of TraversalPathSkeleton objects to update.
 */
async function setNewPathHeadStatus(newPaths: PathSkeleton[]): Promise<void> {
  const headUrls = newPaths.map((p) => p.head.url);
  const resources = await Resource.find({ url: { $in: headUrls } })
    .select('url status')
    .lean();
  const resourceMap: { [url: string]: 'unvisited' | 'done' | 'crawling' | 'error' } = {};

  for (const r of resources) {
    resourceMap[r.url] = r.status;
  }

  for (const np of newPaths) {
    np.head.status = resourceMap[np.head.url] || 'unvisited';
  }
}
