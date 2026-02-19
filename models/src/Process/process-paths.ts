import {
  TraversalPath,
  type TraversalPathDocument,
  EndpointPath,
  type EndpointPathDocument,
  TraversalPathClass,
  type PathSkeleton,
  type PathDocument,
} from '../Path';
import { Process, ProcessClass } from './Process';
import { createLogger } from '@derzis/common/server';
import { ProcessTriple } from '../ProcessTriple';
import { Resource } from '../Resource';
const log = createLogger('ProcessPaths');
import { FilterQuery, Types } from 'mongoose';
import { NamedNodeTriple } from '../Triple';
import { type PathType, type TypedTripleId, TripleType } from '@derzis/common';

/**
 * Get paths for a process that are ready for robots checking, based on the head domain status and path limits.
 * @param process ProcessClass instance
 * @param pathType Type of paths to retrieve ('traversal' or 'endpoint')
 * @param lastSeenCreatedAt Cursor for pagination - return paths with createdAt greater than this value
 * @param lastSeenId Cursor for pagination - return paths with _id greater than this value (for ties)
 * @param limit Maximum number of paths to return
 * @returns Array of TraversalPathClass or EndpointPathClass documents with only head domain origin selected
 */
export async function getPathsForRobotsChecking(
  process: ProcessClass,
  pathType: PathType,
  lastSeenCreatedAt: Date | null = null,
  lastSeenId: Types.ObjectId | null = null,
  limit = 20
) {
  const baseQuery = {
    processId: process.pid,
    status: 'active',
    'head.domain.status': 'unvisited'
  };
  const select = 'head.domain.origin createdAt _id';

  const cursorCondition = lastSeenCreatedAt && lastSeenId
    ? {
      createdAt: { $gte: lastSeenCreatedAt },
      _id: { $gt: lastSeenId }
    }
    : {};

  if (pathType === 'traversal') {
    const paths = await TraversalPath.find({
      ...baseQuery,
      ...cursorCondition,
      'nodes.count': { $lt: process.currentStep.maxPathLength },
      'predicates.count': { $lte: process.currentStep.maxPathProps }
    })
      .sort({ createdAt: 1, _id: 1 })
      .limit(limit)
      .select(select);
    return paths;
  } else {
    const paths = await EndpointPath.find({
      ...baseQuery,
      ...cursorCondition,
      'shortestPath.length': { $lte: process.currentStep.maxPathLength },
      frontier: true
    })
      .sort({ createdAt: 1, _id: 1 })
      .limit(limit)
      .select(select);
    return paths;
  }
}

/**
 * Get paths for a process that are ready for domain crawling, based on the head domain status, path limits, and optional domain blacklist.
 * @param process ProcessClass instance
 * @param pathType Type of paths to retrieve ('traversal' or 'endpoint')
 * @param domainBlacklist Optional array of domain origins to exclude from results
 * @param lastSeenCreatedAt Cursor for pagination - return paths with createdAt greater than this value
 * @param lastSeenId Cursor for pagination - return paths with _id greater than this value (for ties)
 * @param limit Maximum number of paths to return
 * @returns Array of TraversalPathClass or EndpointPathClass documents with only head domain origin and head url selected
 */
export async function getPathsForDomainCrawl(
  process: ProcessClass,
  pathType: PathType,
  domainBlacklist: string[] = [],
  lastSeenCreatedAt: Date | null = null,
  lastSeenId: Types.ObjectId | null = null,
  limit = 20
) {
  const select = 'head.status head.domain.origin head.url createdAt _id';

  // Compound cursor using $gte and $gt - requires compound index on {createdAt: 1, _id: 1}
  const cursorCondition = lastSeenCreatedAt && lastSeenId
    ? {
      createdAt: { $gte: lastSeenCreatedAt },
      _id: { $gt: lastSeenId }
    }
    : {};

  if (pathType === 'traversal') {
    const traversalQuery = genTraversalPathQuery(process);

    const paths = await TraversalPath.find({
      ...traversalQuery,
      ...cursorCondition,
      'head.domain.status': 'ready',
      'head.domain.origin': domainBlacklist.length ? { $nin: domainBlacklist } : { $exists: true },
      'head.status': 'unvisited'
    })
      .sort({ createdAt: 1, _id: 1 })
      .limit(limit)
      .select(select);
    return paths;
  } else {
    const paths = await EndpointPath.find({
      ...cursorCondition,
      processId: process.pid,
      status: 'active',
      'head.domain.status': 'ready',
      'head.domain.origin': domainBlacklist.length ? { $nin: domainBlacklist } : { $exists: true },
      'head.status': 'unvisited',
      'shortestPath.length': { $lte: process.currentStep.maxPathLength },
      frontier: true
    })
      .sort({ createdAt: 1, _id: 1 })
      .limit(limit)
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

/**
 * Recursively extend given paths for a process with existing triples in the database, according to the process's current step limits.
 * For each path, new paths are generated by extending with connected triples that meet the step limits. The new paths are created in the database, old paths are marked as deleted, and the function is called recursively on the new paths until no more extensions can be made.
 * @param proc ProcessClass instance
 * @param paths Array of PathClass documents to extend
 */
export async function extendPathsWithExistingTriples(proc: ProcessClass, paths: PathDocument[]) {
  log.silly(`Extending ${paths.length} paths for process ${proc.pid} with existing triples...`);

  let newPaths = [];

  for (const path of paths) {
    const res = await path.extendWithExistingTriples(proc);

    if (!res.extendedPaths.length) {
      const length = path instanceof TraversalPath
        ? path.nodes.count
        : path instanceof EndpointPath
          ? path.shortestPath.length
          : 'N/A';
      const predicates = path instanceof TraversalPath
        ? path.predicates.elems
        : null;

      log.silly(`No new paths created from path ${path._id} (seed ${path.seed.url}, head ${path.head.url}, length ${length}, ${predicates ? 'predicates ' + predicates : ''})`);

      continue;
    }

    await insertProcTriples(proc.pid, res.procTriples, proc.steps.length);
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
  const limType = process.currentStep.predLimit?.limType;
  const limPredicates = process.currentStep.predLimit?.limPredicates || [];
  const maxPathProps = process.currentStep.maxPathProps;

  const query: FilterQuery<TraversalPathDocument> = {
    processId: process.pid,
    status: 'active',
    'nodes.count': { $lt: process.currentStep.maxPathLength },
    'predicates.count': { $lte: maxPathProps },
  };

  // Filter paths that haven't been considered for extension with the current step
  if (process.pathExtensionCounter !== undefined) {
    query.extensionCounter = { $lt: process.pathExtensionCounter };
  }

  // if there is a whitelist, path must have at least one whitelisted predicate in its existing predicates
  if (limType === 'whitelist') {
    query['predicates.elems'] = limPredicates.length === 1
      ? limPredicates[0]
      : { $in: limPredicates };
  }
  // if there is a blacklist, path must have at least one non-blacklisted predicate in its existing predicates
  else if (limType === 'blacklist' && limPredicates.length > 0) {
    if (limPredicates.length === 1) {
      query['predicates.elems'] = { $ne: limPredicates[0] };
    } else {
      query.$expr = {
        $not: {
          $setIsSubset: ['$predicates.elems', limPredicates]
        }
      };
    }
  }

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
  let lastSeenCreatedAt: Date | null = null;
  let lastSeenId: Types.ObjectId | null = null;
  let hasMore = true;
  const query = genTraversalPathQuery(process);

  // Get total number of paths to process
  const beforeCount = await TraversalPath.countDocuments({ processId: process.pid });
  const initPathsCount = await TraversalPath.countDocuments(query);

  let processedPaths = 0;
  const startTime = Date.now();
  let batchCounter = 0;

  while (hasMore) {
    batchCounter++;
    const batchStartTime = Date.now();
    const curPathsCount = await TraversalPath.countDocuments(query);

    const cursorCondition: FilterQuery<TraversalPathDocument> = lastSeenCreatedAt && lastSeenId
      ? {
        createdAt: { $gte: lastSeenCreatedAt },
        _id: { $gt: lastSeenId }
      }
      : {};

    // find a batch of active paths that can be extended
    const paths = await TraversalPath.find({ ...query, ...cursorCondition })
      .sort({ createdAt: 1, _id: 1 })
      .limit(batchSize);

    if (paths.length === 0) {
      hasMore = false;
      break;
    }

    const lastPath = paths[paths.length - 1];
    lastSeenCreatedAt = lastPath.createdAt ?? null;
    lastSeenId = lastPath._id as Types.ObjectId;

    const percentage = Math.round((processedPaths / curPathsCount) * 100);
    const elapsedTime = (Date.now() - startTime) / 1000;

    log.info(
      `Extending batch of ${paths.length} existing paths for process ${process.pid} (${processedPaths}/${curPathsCount} - ${percentage}%)`
    );

    await extendPathsWithExistingTriples(process, paths);
    processedPaths += paths.length;

    // Mark all paths in this batch as considered for extension
    const pathIds = paths.map((p) => p._id);
    await TraversalPath.updateMany(
      { _id: { $in: pathIds } },
      { $set: { extensionCounter: process.pathExtensionCounter } }
    );

    const batchTime = (Date.now() - batchStartTime) / 1000;
    log.info(
      `Batch ${batchCounter} completed in ${batchTime.toFixed(2)}s (Total elapsed: ${elapsedTime.toFixed(2)}s)`
    );

    // add a 1s delay between batches to reduce DB load
    log.debug('Waiting 1s before processing the next batch...');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    log.silly('Continuing to next batch...');
  }

  const finalPathsCount = await TraversalPath.countDocuments({ processId: process.pid });

  const totalTime = (Date.now() - startTime) / 1000;
  log.info(
    `Finished extending existing paths for process ${process.pid}. Total time: ${totalTime.toFixed(2)}s. Created ${finalPathsCount - beforeCount} new paths from ${processedPaths} processed paths.`
  );
}

/**
 * Helper function to insert process-triple associations in bulk.
 * @param pid Process ID
  * @param procTriples Set of triple IDs to associate with the process
  * @param procStep Current step number of the process
  */
async function insertProcTriples(pid: string, procTriples: TypedTripleId[], procStep: number) {
  if (procTriples.length > 0) {
    await ProcessTriple.upsertMany(
      procTriples.map(t => ({
        processId: pid,
        triple: new Types.ObjectId(t.id),
        tripleType: t.type,
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
): Promise<TraversalPathDocument[] | EndpointPathDocument[]> {
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
  let lastPathCreatedAt: Date | null = null;
  let lastPathId: Types.ObjectId | null = null;

  let newPaths = [];
  // process paths in batches to avoid using up too much memory
  while (hasMorePaths) {
    const pathCursorCondition: FilterQuery<TraversalPathClass> = lastPathCreatedAt && lastPathId
      ? {
        createdAt: { $gte: lastPathCreatedAt },
        _id: { $gt: lastPathId }
      }
      : {};

    const paths =
      pathType === 'traversal'
        ? await TraversalPath.find({ ...pathQuery, ...pathCursorCondition })
          .sort({ createdAt: 1, _id: 1 })
          .limit(batchSize)
        : await EndpointPath.find({ ...pathQuery, ...pathCursorCondition })
          .sort({ createdAt: 1, _id: 1 })
          .limit(batchSize);

    log.info(`extendProcessPaths: Found ${paths.length} paths for headUrl: ${headUrl}`);

    if (!paths.length) {
      log.info(`No active paths found for process ${process.pid} with head URL: ${headUrl}`);
      hasMorePaths = false;
      break;
    }

    const lastPath = paths[paths.length - 1];
    lastPathCreatedAt = lastPath.createdAt ?? null;
    lastPathId = lastPath._id as Types.ObjectId;

    let hasMoreTriples = true;
    let lastTripleCreatedAt: Date | null = null;
    let lastTripleId: Types.ObjectId | null = null;
    // process triples in batches to avoid using up too much memory
    while (hasMoreTriples) {
      const tripleCursorCondition: FilterQuery<TraversalPathClass> = lastTripleCreatedAt && lastTripleId
        ? {
          createdAt: { $gte: lastTripleCreatedAt },
          _id: { $gt: lastTripleId }
        }
        : {};

      const triples = await NamedNodeTriple.find({ nodes: headUrl, ...tripleCursorCondition })
        .sort({ createdAt: 1, _id: 1 })
        .limit(batchSize);

      log.info(`extendProcessPaths: Found ${triples.length} triples with nodes: ${headUrl}`);

      if (!triples.length) {
        log.info(`No triples found connected to head URL: ${headUrl}`);
        hasMoreTriples = false;
        break;
      }

      const lastTriple = triples[triples.length - 1];
      lastTripleCreatedAt = lastTriple.createdAt ?? null;
      lastTripleId = lastTriple._id as Types.ObjectId;

      // extend each path with the new triples and gather new paths and proc-triple associations
      for (const path of paths) {
        const res = await path.genExtended(triples, process);
        log.silly('Extended paths:', res.extendedPaths);
        // make db operations immediately for each path to avoid keeping too many new paths in memory
        if (res.extendedPaths.length) {
          await insertProcTriples(process.pid, res.procTriples, process.steps.length);
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
