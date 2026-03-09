import {
  TraversalPath,
  type TraversalPathDocument,
  EndpointPath,
  type EndpointPathDocument,
  type PathSkeleton,
  type EndpointPathSkeleton,
  HEAD_TYPE,
  UrlHead,
  Path,
  PathClass
} from '../Path';
import { Process, ProcessClass } from './Process';
import { createLogger } from '@derzis/common/server';
import { ProcessTriple } from '../ProcessTriple';
import { Resource } from '../Resource';
const log = createLogger('ProcessPaths');
import { type QueryFilter, Types } from 'mongoose';
import { type TripleClass, type TripleDocument } from '../Triple';
import { PathType, type TypedTripleId } from '@derzis/common';
import { Domain } from '../Domain';
import config from '@derzis/config';

/**
 * Type guard to check if a head is a UrlHead
 */
function isUrlHead(head: PathClass['head']): head is UrlHead {
  return head.type === HEAD_TYPE.URL;
}

/**
 * Get locked domain filter to exclude from path selection.
 */
async function getLockedDomainFilter(domainBlacklist: string[] = []) {
  const lockedDomains = await Domain.find({
    status: { $in: ['checking', 'labelFetching', 'crawling'] }
  })
    .select('origin')
    .lean();
  const lockedOrigins = [...lockedDomains.map((d) => d.origin), ...domainBlacklist];

  if (!lockedOrigins.length) {
    return {};
  }

  if (lockedOrigins.length === 1) {
    return { 'head.domain.origin': { $ne: lockedOrigins[0] } };
  }

  return { 'head.domain.origin': { $nin: lockedOrigins } };
}

/**
 * Get paths for a process that are ready for robots checking, based on the head domain status and path limits.
 * @param process ProcessClass instance
 * @param pathType Type of paths to retrieve ('traversal' or 'endpoint')
 * @param lastSeenCreatedAt Cursor for pagination - return paths with createdAt greater than this value
 * @param lastSeenId Cursor for pagination - return paths with _id greater than this value (for ties)
 * @param lastSeenLength Cursor for pagination - return paths with nodes.count greater than this value (for traversal)
 * @param lastSeenShortestPathLength Cursor for pagination - return paths with shortestPathLength greater than this value (for endpoint)
 * @param limit Maximum number of paths to return
 * @returns Array of TraversalPathClass or EndpointPathClass documents with only head domain origin selected
 */
export async function getPathsForRobotsChecking(
  process: ProcessClass,
  pathType: PathType,
  lastSeenCreatedAt: Date | null = null,
  lastSeenId: Types.ObjectId | null = null,
  lastSeenLength: number | null = null,
  lastSeenShortestPathLength: number | null = null,
  limit = 20
): Promise<(TraversalPathDocument | EndpointPathDocument)[]> {
  // Only include paths from domains that are 'unvisited' (eligible for robots checking)
  // Note: No need to exclude 'locked' domains via $nin - domains with status 'unvisited'
  // are already disjoint from 'checking', 'labelFetching', 'crawling'
  const unvisitedDomains = await Domain.find({ status: 'unvisited' }).select('origin').lean();
  const eligibleOrigins = unvisitedDomains.map((d) => d.origin);
  if (!eligibleOrigins.length) {
    return [];
  }

  const baseQuery = {
    processId: process.pid,
    'head.domain.isUnvisited': true,
    'head.status': 'unvisited',
    'head.type': HEAD_TYPE.URL,
    'head.domain.origin': { $in: eligibleOrigins },
    status: 'active'
  };
  const select = 'head.domain head.type createdAt _id nodes.count shortestPathLength';

  // Build cursor condition for compound sort: { length, createdAt, _id }
  let cursorCondition: Record<string, unknown> = {};
  if (
    pathType === PathType.TRAVERSAL &&
    lastSeenLength !== null &&
    lastSeenCreatedAt &&
    lastSeenId
  ) {
    cursorCondition = {
      $or: [
        { 'nodes.count': { $gt: lastSeenLength } },
        { 'nodes.count': lastSeenLength, createdAt: { $gt: lastSeenCreatedAt } },
        { 'nodes.count': lastSeenLength, createdAt: lastSeenCreatedAt, _id: { $gt: lastSeenId } }
      ]
    };
  } else if (
    pathType === PathType.ENDPOINT &&
    lastSeenShortestPathLength !== null &&
    lastSeenCreatedAt &&
    lastSeenId
  ) {
    cursorCondition = {
      $or: [
        { shortestPathLength: { $gt: lastSeenShortestPathLength } },
        { shortestPathLength: lastSeenShortestPathLength, createdAt: { $gt: lastSeenCreatedAt } },
        {
          shortestPathLength: lastSeenShortestPathLength,
          createdAt: lastSeenCreatedAt,
          _id: { $gt: lastSeenId }
        }
      ]
    };
  } else if (lastSeenCreatedAt && lastSeenId) {
    cursorCondition = {
      createdAt: { $gte: lastSeenCreatedAt },
      _id: { $gt: lastSeenId }
    };
  }

  if (pathType === PathType.TRAVERSAL) {
    const paths = await TraversalPath.find({
      ...baseQuery,
      ...cursorCondition,
      'nodes.count': { $lt: process.currentStep.maxPathLength },
      'predicates.count': { $lte: process.currentStep.maxPathProps }
    })
      .sort({ 'nodes.count': 1, createdAt: 1, _id: 1 })
      .limit(limit)
      .select(select);
    return paths;
  } else {
    const paths = await EndpointPath.find({
      ...baseQuery,
      ...cursorCondition,
      shortestPathLength: { $lt: process.currentStep.maxPathLength }
    })
      .sort({ shortestPathLength: 1, createdAt: 1, _id: 1 })
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
 * @param lastSeenLength Cursor for pagination - return paths with nodes.count greater than this value (for traversal)
 * @param lastSeenShortestPathLength Cursor for pagination - return paths with shortestPathLength greater than this value (for endpoint)
 * @param limit Maximum number of paths to return
 * @returns Array of TraversalPathClass or EndpointPathClass documents with only head domain origin and head url selected
 */
export async function getPathsForDomainCrawl(
  process: ProcessClass,
  pathType: PathType,
  domainBlacklist: string[] = [],
  lastSeenCreatedAt: Date | null = null,
  lastSeenId: Types.ObjectId | null = null,
  lastSeenLength: number | null = null,
  lastSeenShortestPathLength: number | null = null,
  limit = 20
): Promise<(TraversalPathDocument | EndpointPathDocument)[]> {
  // Only include paths from domains that are 'ready' (eligible for crawling)
  const readyDomains = await Domain.find({ status: 'ready' }).select('origin').lean();
  const eligibleOrigins = readyDomains.map((d) => d.origin);
  if (!eligibleOrigins.length) {
    return [];
  }

  // Build origin filter: $in eligible origins, optionally excluding user-provided blacklist
  // Note: No need to exclude 'locked' domains via $nin - domains with status 'ready'
  // are already disjoint from 'checking', 'labelFetching', 'crawling'
  const originFilter =
    domainBlacklist.length > 0
      ? { $in: eligibleOrigins.filter((o) => !domainBlacklist.includes(o)) }
      : { $in: eligibleOrigins };

  const baseQuery = {
    'head.type': HEAD_TYPE.URL,
    'head.domain.isUnvisited': false,
    'head.status': 'unvisited',
    'head.domain.origin': originFilter,
    processId: process.pid,
    status: 'active'
  };
  const select =
    'head.status head.type head.domain head.url createdAt _id nodes.count shortestPathLength';

  // Build cursor condition for compound sort: { length, createdAt, _id }
  let cursorCondition: Record<string, unknown> = {};
  if (
    pathType === PathType.TRAVERSAL &&
    lastSeenLength !== null &&
    lastSeenCreatedAt &&
    lastSeenId
  ) {
    cursorCondition = {
      $or: [
        { 'nodes.count': { $gt: lastSeenLength } },
        { 'nodes.count': lastSeenLength, createdAt: { $gt: lastSeenCreatedAt } },
        { 'nodes.count': lastSeenLength, createdAt: lastSeenCreatedAt, _id: { $gt: lastSeenId } }
      ]
    };
  } else if (
    pathType === PathType.ENDPOINT &&
    lastSeenShortestPathLength !== null &&
    lastSeenCreatedAt &&
    lastSeenId
  ) {
    cursorCondition = {
      $or: [
        { shortestPathLength: { $gt: lastSeenShortestPathLength } },
        { shortestPathLength: lastSeenShortestPathLength, createdAt: { $gt: lastSeenCreatedAt } },
        {
          shortestPathLength: lastSeenShortestPathLength,
          createdAt: lastSeenCreatedAt,
          _id: { $gt: lastSeenId }
        }
      ]
    };
  } else if (lastSeenCreatedAt && lastSeenId) {
    cursorCondition = {
      createdAt: { $gte: lastSeenCreatedAt },
      _id: { $gt: lastSeenId }
    };
  }

  if (pathType === PathType.TRAVERSAL) {
    const traversalQuery = genTraversalPathQuery(process);

    const paths = await TraversalPath.find({
      ...baseQuery,
      ...traversalQuery,
      ...cursorCondition
    })
      .sort({ 'nodes.count': 1, createdAt: 1, _id: 1 })
      .limit(limit)
      .select(select);
    return paths;
  } else {
    const paths = await EndpointPath.find({
      ...baseQuery,
      shortestPathLength: { $lt: process.currentStep.maxPathLength },
      ...cursorCondition
    })
      .sort({ shortestPathLength: 1, createdAt: 1, _id: 1 })
      .limit(limit)
      .select(select);
    return paths;
  }
}

export async function hasPathsDomainRobotsChecking(process: ProcessClass): Promise<boolean> {
  // Get domains currently checking robots.txt
  const domains = await Domain.find({ status: 'checking' }).select('origin').lean();
  if (domains.length === 0) return false;

  // Count how many active paths have head domains that are currently being checked for robots.txt
  // Using base Path model (all paths for this process are of the same type configured in process)
  const pathsCount = await Path.countDocuments({
    processId: process.pid,
    status: 'active',
    'head.type': HEAD_TYPE.URL,
    'head.domain.origin': { $in: domains.map((d) => d.origin) }
  });
  return !!pathsCount;
}

export async function hasPathsHeadBeingCrawled(process: ProcessClass): Promise<boolean> {
  // Check if any active path's head domain is currently in 'crawling' status.
  const domains = await Domain.find({ status: 'crawling' }).select('origin').lean();
  if (domains.length === 0) return false;

  const pathsCount = await Path.countDocuments({
    processId: process.pid,
    status: 'active',
    'head.type': HEAD_TYPE.URL,
    'head.domain.origin': { $in: domains.map((d) => d.origin) }
  });
  return !!pathsCount;
}

/**
 * Generate a MongoDB query to find active paths for a process that can be extended based on the current step limits.
 * @param process ProcessClass instance
 * @returns MongoDB query object
 */
export function genTraversalPathQuery(process: ProcessClass): QueryFilter<TraversalPathDocument> {
  const limType = process.currentStep.predLimit?.limType;
  const limPredicates = process.currentStep.predLimit?.limPredicates || [];
  const maxPathProps = process.currentStep.maxPathProps;

  const query: QueryFilter<TraversalPathDocument> = {
    processId: process.pid,
    status: 'active',
    'head.type': HEAD_TYPE.URL,
    'nodes.count': { $lt: process.currentStep.maxPathLength },
    'predicates.count': { $lte: maxPathProps }
  };

  // Filter paths that haven't been considered for extension with the current step
  if (process.pathExtensionCounter !== undefined) {
    query.extensionCounter = { $lt: process.pathExtensionCounter };
  }

  // if there is a whitelist, path must have at least one whitelisted predicate in its existing predicates
  if (limType === 'whitelist') {
    query['predicates.elems'] =
      limPredicates.length === 1 ? limPredicates[0] : { $in: limPredicates };
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
 * Helper function to insert process-triple associations in bulk.
 * @param pid Process ID
 * @param procTriples Set of triple IDs to associate with the process
 * @param procStep Current step number of the process
 */
async function insertProcTriples(pid: string, procTriples: TypedTripleId[], procStep: number) {
  if (procTriples.length > 0) {
    await ProcessTriple.upsertMany(
      procTriples.map((t) => ({
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
  if (pathsToCreate.length === 0) {
    log.silly('No new paths to create.');
    return [];
  }

  await setNewPathHeadStatus(pathsToCreate);

  if (pathType === PathType.TRAVERSAL) {
    return TraversalPath.create(pathsToCreate);
  }

  // EndpointPath: handle duplicates for URL heads with optimistic locking.
  // Separate URL heads (need duplicate handling) from literal heads (simple insert).
  const urlGroups = new Map<string, Map<string, EndpointPathSkeleton[]>>();
  const literalPaths: EndpointPathSkeleton[] = [];

  for (const p of pathsToCreate as EndpointPathSkeleton[]) {
    const head = p.head;
    if (isUrlHead(head)) {
      const processId = p.processId;
      const headUrl = head.url;

      let byUrl = urlGroups.get(processId) || new Map<string, EndpointPathSkeleton[]>();
      const group = byUrl.get(headUrl) || [];
      group.push(p);
      byUrl.set(headUrl, group);
      urlGroups.set(processId, byUrl);
    } else {
      literalPaths.push(p);
    }
  }

  const created: EndpointPathDocument[] = [];

  // Process URL heads with duplicate detection and merging
  for (const [processId, byUrl] of urlGroups.entries()) {
    for (const [headUrl, group] of byUrl.entries()) {
      const head0 = group[0].head as UrlHead;
      const domain = head0.domain;

      // Merge incoming seedPaths and shortest distance
      const incomingSeedMap = new Map<string, number>();
      let incomingShortest = Infinity;
      for (const p of group) {
        for (const sp of p.seedPaths) {
          const cur = incomingSeedMap.get(sp.seed);
          if (cur === undefined || sp.minLength < cur) incomingSeedMap.set(sp.seed, sp.minLength);
        }
        incomingShortest = Math.min(incomingShortest, p.shortestPathLength);
      }

      let attempts = 0;
      const maxAttempts = 3;
      let success = false;

      while (attempts < maxAttempts && !success) {
        attempts++;
        const existing = await EndpointPath.findOne({
          processId,
          'head.type': HEAD_TYPE.URL,
          'head.url': headUrl
        })
          .select('_id updatedAt seedPaths shortestPathLength head')
          .exec();

        if (existing) {
          const existingHead = existing.head as UrlHead;
          // Merge incoming with existing
          const mergedSeedMap = new Map<string, number>(incomingSeedMap);
          for (const sp of existing.seedPaths) {
            const cur = mergedSeedMap.get(sp.seed);
            if (cur === undefined || sp.minLength < cur) mergedSeedMap.set(sp.seed, sp.minLength);
          }
          const finalSeedPaths = Array.from(mergedSeedMap).map(([seed, minLength]) => ({
            seed,
            minLength
          }));
          const finalShortest = Math.min(incomingShortest, existing.shortestPathLength);

          const res = await EndpointPath.updateOne(
            { _id: existing._id, updatedAt: existing.updatedAt },
            {
              $set: {
                'head.type': 'url',
                'head.status': existingHead.status === 'error' ? 'unvisited' : existingHead.status,
                'head.domain.origin': domain.origin,
                type: 'endpoint',
                shortestPathLength: finalShortest,
                seedPaths: finalSeedPaths,
                extensionCounter: 0,
                updatedAt: new Date()
              }
            }
          );

          if (res.matchedCount === 0) continue; // retry
          success = true;
        } else {
          await new EndpointPath({
            processId,
            head: { type: 'url', url: headUrl, domain },
            status: 'active',
            type: 'endpoint',
            shortestPathLength: incomingShortest,
            seedPaths: Array.from(incomingSeedMap).map(([seed, minLength]) => ({
              seed,
              minLength
            })),
            extensionCounter: 0,
            createdAt: new Date(),
            updatedAt: new Date()
          }).save();
          success = true;
        }
      }

      if (!success) {
        log.warn('Failed to createEndpointPath after retries', { processId, headUrl });
        continue;
      }

      // Fetch saved path for return
      const saved = await EndpointPath.findOne({ processId, 'head.url': headUrl }).exec();
      if (saved) created.push(saved);
    }
  }

  // Bulk-insert literal heads normally (no duplicate handling)
  if (literalPaths.length > 0) {
    const inserted = await EndpointPath.create(literalPaths);
    created.push(...inserted);
  }

  return created;
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
      'head.type': HEAD_TYPE.URL,
      'head.status': 'done'
    };
    const pathUpdate = { $set: { status: 'deleted' } };

    // mark old paths as deleted if their head status is 'done'

    if (pathType === PathType.TRAVERSAL) {
      await TraversalPath.updateMany(pathQuery, pathUpdate);
    } else {
      await EndpointPath.updateMany(pathQuery, pathUpdate);
    }
  } else {
    log.silly('No old paths to delete.');
  }
}

/**
 * Set the head status of new paths based on existing Resource statuses.
 * @param newPaths Array of TraversalPathSkeleton objects to update.
 */
async function setNewPathHeadStatus(newPaths: PathSkeleton[]): Promise<void> {
  // Only process paths with URL heads (not literal heads)
  const urlPaths = newPaths.filter((p) => p.head.type === HEAD_TYPE.URL) as (PathSkeleton & {
    head: UrlHead;
  })[];
  const headUrls = urlPaths.map((p) => p.head.url);

  if (!headUrls.length) {
    return;
  }

  const resources = await Resource.find({ url: { $in: headUrls } })
    .select('url status')
    .lean();
  const resourceMap: { [url: string]: 'unvisited' | 'done' | 'crawling' | 'error' } = {};
  for (const r of resources) {
    resourceMap[r.url] = r.status;
  }

  const domains = await Domain.find({ origin: { $in: Object.keys(resourceMap) } })
    .select('origin status')
    .lean();
  const domainsUnvisited = new Set(
    domains.filter((d) => d.status === 'unvisited').map((d) => d.origin)
  );

  for (const np of urlPaths) {
    np.head.status = resourceMap[np.head.url] || 'unvisited';
    np.head.domain.isUnvisited = domainsUnvisited.has(np.head.domain.origin);
  }
}

// ============================================================================
// New consolidated path extension API
// ============================================================================

interface ExtendPathsArgs {
  pid?: string;
  headUrl?: string;
  triples?: TripleDocument[];
  paths?: (TraversalPathDocument | EndpointPathDocument)[];
}

/**
 * Determines the path type for a process, falling back to global config.
 * @param process - The ProcessClass instance.
 * @returns The PathType for the process.
 */
function getPathType(process: ProcessClass): PathType {
  return process.pathType ?? config.manager.pathType;
}

/**
 * Marks a batch of paths as considered by setting their extensionCounter to the process's counter.
 * @param process - The ProcessClass instance.
 * @param paths - Array of path documents to mark.
 */
async function markPathsConsidered(
  process: ProcessClass,
  paths: (TraversalPathDocument | EndpointPathDocument)[]
) {
  if (paths.length === 0 || process.pathExtensionCounter === undefined) {
    return;
  }
  const pathIds = paths.map((p) => p._id);
  await Path.updateMany(
    { _id: { $in: pathIds } },
    { $set: { extensionCounter: process.pathExtensionCounter } }
  );
}

/**
 * Async generator that yields paths with a specific head URL in batches.
 * @param process - The ProcessClass instance.
 * @param headUrl - The head URL to match.
 * @param batchSize - Maximum number of paths per batch (default 100).
 * @yields TraversalPathDocument or EndpointPathDocument matching the criteria.
 */
async function* queryPathsForHeadUrl(
  process: ProcessClass,
  headUrl: string,
  batchSize = 100
): AsyncGenerator<TraversalPathDocument | EndpointPathDocument> {
  const pathType = getPathType(process);
  if (pathType === PathType.TRAVERSAL) {
    yield* queryTraversalPathsForHeadUrl(process, headUrl, batchSize);
  } else {
    yield* queryEndpointPathsForHeadUrl(process, headUrl, batchSize);
  }
}

/**
 * Async generator that yields TraversalPath documents for a specific head URL.
 * @param process - The ProcessClass instance.
 * @param headUrl - The head URL to query paths for.
 * @param batchSize - Maximum number of paths per batch (default 100).
 * @yields TraversalPathDocument with the given head URL.
 */
async function* queryTraversalPathsForHeadUrl(
  process: ProcessClass,
  headUrl: string,
  batchSize = 100
): AsyncGenerator<TraversalPathDocument> {
  const baseQuery: Record<string, unknown> = {
    processId: process.pid,
    status: 'active',
    'head.type': HEAD_TYPE.URL,
    'head.url': headUrl,
    'nodes.count': { $lt: process.currentStep.maxPathLength }
  };

  let lastCreatedAt: Date | null = null;
  let lastId: Types.ObjectId | null = null;
  let hasMore = true;

  while (hasMore) {
    let cursor: Record<string, unknown> =
      lastCreatedAt && lastId ? { createdAt: { $gte: lastCreatedAt }, _id: { $gt: lastId } } : {};

    const paths = await TraversalPath.find({
      ...baseQuery,
      ...cursor
    } as QueryFilter<TraversalPathDocument>)
      .sort({ 'nodes.count': 1, createdAt: 1, _id: 1 })
      .limit(batchSize);

    if (paths.length === 0) {
      hasMore = false;
      break;
    }

    const last = paths[paths.length - 1];
    lastCreatedAt = last.createdAt ?? null;
    lastId = last._id as Types.ObjectId;

    yield* paths;

    if (paths.length < batchSize) {
      hasMore = false;
    }
  }
}

/**
 * Async generator that yields EndpointPath documents for a specific head URL.
 * @param process - The ProcessClass instance.
 * @param headUrl - The head URL to query paths for.
 * @param batchSize - Maximum number of paths per batch (default 100).
 * @yields EndpointPathDocument with the given head URL.
 */
async function* queryEndpointPathsForHeadUrl(
  process: ProcessClass,
  headUrl: string,
  batchSize = 100
): AsyncGenerator<EndpointPathDocument> {
  const baseQuery: Record<string, unknown> = {
    processId: process.pid,
    status: 'active',
    'head.type': HEAD_TYPE.URL,
    'head.url': headUrl,
    shortestPathLength: { $lt: process.currentStep.maxPathLength }
  };

  let lastCreatedAt: Date | null = null;
  let lastId: Types.ObjectId | null = null;
  let hasMore = true;

  while (hasMore) {
    let cursor: Record<string, unknown> =
      lastCreatedAt && lastId ? { createdAt: { $gte: lastCreatedAt }, _id: { $gt: lastId } } : {};

    const paths = await EndpointPath.find({
      ...baseQuery,
      ...cursor
    } as QueryFilter<EndpointPathDocument>)
      .sort({ shortestPathLength: 1, createdAt: 1, _id: 1 })
      .limit(batchSize);

    if (paths.length === 0) {
      hasMore = false;
      break;
    }

    const last = paths[paths.length - 1];
    lastCreatedAt = last.createdAt ?? null;
    lastId = last._id as Types.ObjectId;

    yield* paths;

    if (paths.length < batchSize) {
      hasMore = false;
    }
  }
}

/**
 * Async generator that yields all extendable paths for a process.
 * Dispatches to type-specific generator based on process pathType.
 * @param process - The ProcessClass instance.
 * @param batchSize - Maximum number of paths per batch (default 100).
 * @yields TraversalPathDocument or EndpointPathDocument that are extendable.
 */
async function* queryAllExtendablePaths(
  process: ProcessClass,
  batchSize = 100
): AsyncGenerator<TraversalPathDocument | EndpointPathDocument> {
  const pathType = getPathType(process);
  if (pathType === PathType.TRAVERSAL) {
    yield* queryAllExtendableTraversalPaths(process, batchSize);
  } else {
    yield* queryAllExtendableEndpointPaths(process, batchSize);
  }
}

/**
 * Async generator that yields all extendable TraversalPath documents for a process.
 * Uses genTraversalPathQuery to apply full constraints (limits, predicate constraints, etc.).
 * @param process - The ProcessClass instance.
 * @param batchSize - Maximum number of paths per batch (default 100).
 * @yields TraversalPathDocument that are extendable.
 */
async function* queryAllExtendableTraversalPaths(
  process: ProcessClass,
  batchSize = 100
): AsyncGenerator<TraversalPathDocument> {
  const baseQuery = {
    status: 'active',
    'head.status': 'done',
    ...genTraversalPathQuery(process)
  };
  let lastLength: number | null = null;
  let lastCreatedAt: Date | null = null;
  let lastId: Types.ObjectId | null = null;
  let hasMore = true;

  while (hasMore) {
    let cursor: Record<string, unknown> = {};
    if (lastLength !== null && lastCreatedAt && lastId) {
      cursor = {
        $or: [
          { 'nodes.count': { $gt: lastLength } },
          { 'nodes.count': lastLength, createdAt: { $gt: lastCreatedAt } },
          { 'nodes.count': lastLength, createdAt: lastCreatedAt, _id: { $gt: lastId } }
        ]
      };
    } else if (lastCreatedAt && lastId) {
      cursor = { createdAt: { $gte: lastCreatedAt }, _id: { $gt: lastId } };
    }

    const paths = await TraversalPath.find({
      ...baseQuery,
      ...cursor
    } as QueryFilter<TraversalPathDocument>)
      .sort({ 'nodes.count': 1, createdAt: 1, _id: 1 })
      .limit(batchSize);

    if (paths.length === 0) {
      hasMore = false;
      break;
    }

    const last = paths[paths.length - 1];
    lastCreatedAt = last.createdAt ?? null;
    lastId = last._id as Types.ObjectId;
    lastLength = last.nodes.count;

    yield* paths;

    if (paths.length < batchSize) {
      hasMore = false;
    }
  }
}

/**
 * Async generator that yields all extendable EndpointPath documents for a process.
 * Only paths with shortestPathLength less than maxPathLength are returned.
 * Respects extensionCounter for incremental extension.
 * @param process - The ProcessClass instance.
 * @param batchSize - Maximum number of paths per batch (default 100).
 * @yields EndpointPathDocument that are extendable.
 */
async function* queryAllExtendableEndpointPaths(
  process: ProcessClass,
  batchSize = 100
): AsyncGenerator<EndpointPathDocument> {
  let lastLength: number | null = null;
  let lastCreatedAt: Date | null = null;
  let lastId: Types.ObjectId | null = null;
  let hasMore = true;

  while (hasMore) {
    const baseQuery: QueryFilter<EndpointPathDocument> = {
      processId: process.pid,
      status: 'active',
      'head.status': 'done',
      'head.type': HEAD_TYPE.URL,
      shortestPathLength: { $lt: process.currentStep.maxPathLength }
    };

    if (process.pathExtensionCounter !== undefined) {
      baseQuery.extensionCounter = { $lt: process.pathExtensionCounter };
    }

    let cursor: Record<string, unknown> = {};
    if (lastLength !== null && lastCreatedAt && lastId) {
      cursor = {
        $or: [
          { shortestPathLength: { $gt: lastLength } },
          { shortestPathLength: lastLength, createdAt: { $gt: lastCreatedAt } },
          { shortestPathLength: lastLength, createdAt: lastCreatedAt, _id: { $gt: lastId } }
        ]
      };
    } else if (lastCreatedAt && lastId) {
      cursor = { createdAt: { $gte: lastCreatedAt }, _id: { $gt: lastId } };
    }

    const paths = await EndpointPath.find({
      ...baseQuery,
      ...cursor
    } as QueryFilter<EndpointPathDocument>)
      .sort({ shortestPathLength: 1, createdAt: 1, _id: 1 })
      .limit(batchSize);

    if (paths.length === 0) {
      hasMore = false;
      break;
    }

    const last = paths[paths.length - 1];
    lastCreatedAt = last.createdAt ?? null;
    lastId = last._id as Types.ObjectId;
    lastLength = last.shortestPathLength;

    yield* paths;

    if (paths.length < batchSize) {
      hasMore = false;
    }
  }
}

/**
 * Async generator that yields paths whose head.url appears in the given triples.
 * For each triple, both subject and object URLs (if strings) are considered.
 * @param process - The ProcessClass instance.
 * @param triples - Array of TripleDocument to extract node URLs from.
 * @param batchSize - Maximum number of paths per batch (default 100).
 * @yields TraversalPathDocument or EndpointPathDocument with matching head.
 */
async function* queryPathsForTriples(
  process: ProcessClass,
  triples: TripleClass[],
  batchSize = 100
): AsyncGenerator<TraversalPathDocument | EndpointPathDocument> {
  const pathType = getPathType(process);

  const nodeUrls = new Set<string>();
  for (const t of triples) {
    const anyT = t as any;
    if (typeof anyT.subject === 'string') nodeUrls.add(anyT.subject);
    if (typeof anyT.object === 'string') nodeUrls.add(anyT.object);
  }

  if (nodeUrls.size === 0) {
    return;
  }

  let lastCreatedAt: Date | null = null;
  let lastId: Types.ObjectId | null = null;
  let hasMore = true;

  while (hasMore) {
    const cursor: Record<string, unknown> =
      lastCreatedAt && lastId ? { createdAt: { $gte: lastCreatedAt }, _id: { $gt: lastId } } : {};

    const baseQuery: Record<string, unknown> = {
      processId: process.pid,
      status: 'active',
      'head.type': HEAD_TYPE.URL,
      'head.url': { $in: Array.from(nodeUrls) }
    };

    const paths: (TraversalPathDocument | EndpointPathDocument)[] = await (
      pathType === PathType.TRAVERSAL
        ? TraversalPath.find({ ...baseQuery, ...cursor } as QueryFilter<TraversalPathDocument>)
        : EndpointPath.find({ ...baseQuery, ...cursor } as QueryFilter<EndpointPathDocument>)
    )
      .sort({ createdAt: 1, _id: 1 })
      .limit(batchSize);

    if (paths.length === 0) {
      hasMore = false;
      break;
    }

    const last: TraversalPathDocument | EndpointPathDocument = paths[paths.length - 1];
    lastCreatedAt = last.createdAt ?? null;
    lastId = last._id as Types.ObjectId;

    yield* paths;

    if (paths.length < batchSize) {
      hasMore = false;
    }
  }
}

// Helper: collect up to batchSize items from a generator
async function collectBatch<T>(generator: AsyncGenerator<T>, batchSize: number): Promise<T[]> {
  const result: T[] = [];
  for await (const item of generator) {
    result.push(item);
    if (result.length >= batchSize) {
      break;
    }
  }
  return result;
}

/**
 * Processes a batch of paths, extending them with existing triples.
 * For each path that yields new extended paths:
 *   - Inserts process triples
 *   - Creates new paths in the database
 *   - Deletes old paths
 * @param process - The ProcessClass instance.
 * @param pathsBatch - Array of path documents to process.
 * @param triples - Optional triples to use for extension (defaults to fetching from DB).
 */
async function extendPathsBatch(
  process: ProcessClass,
  pathsBatch: (TraversalPathDocument | EndpointPathDocument)[],
  triples?: TripleDocument[]
) {
  const pathType = getPathType(process);
  for (const path of pathsBatch) {
    const result = await path.genExtendedPaths(process, triples);

    if (result.extendedPaths.length > 0) {
      await insertProcTriples(process.pid, result.procTriples, process.steps.length);
      await createNewPaths(result.extendedPaths, pathType);
      await deleteOldPaths(new Set([path._id]), pathType);
    }
  }
}

/**
 * Main consolidated function to extend paths.
 * Supports four modes:
 *   - Full extend (no headUrl/triples/paths): extends all extendable paths for a process, respecting extensionCounter.
 *   - headUrl provided: extends paths with that head URL.
 *   - triples provided: extends paths whose head.url appears in the triples.
 *   - paths provided: one-off extension of the given paths.
 * Uses batched queries and loops until no more paths are found.
 * @param args - ExtendPathsArgs with optional pid, headUrl, triples, paths.
 */
export async function extendPaths({ pid, triples, headUrl, paths }: ExtendPathsArgs) {
  // If no pid, get all process IDs and recurse for each
  if (!pid) {
    const pids = await Process.distinct('pid');
    for (const p of pids) {
      await extendPaths({ pid: p, triples, headUrl, paths });
    }
    return;
  }

  // Get process
  const process = await Process.findOne({ pid });
  if (!process) {
    log.warn(`Process ${pid} not found`);
    return;
  }

  const isFullExtend = !paths && !headUrl && !triples;
  if (isFullExtend && process.status !== 'extending') {
    log.warn(`Process ${process.pid} is not in 'extending' status. Skipping.`);
    return;
  }

  const batchSize = 100;
  let totalProcessed = 0;
  let iteration = 0;
  let needsMoreWork = true;

  // Create generator outside loop to preserve pagination cursor across iterations
  const generator = triples
    ? queryPathsForTriples(process, triples, batchSize)
    : headUrl
      ? queryPathsForHeadUrl(process, headUrl, batchSize)
      : null;

  // For full extend, we need a separate generator since it's a different code path
  const fullGenerator = !triples && !headUrl ? queryAllExtendablePaths(process, batchSize) : null;

  while (needsMoreWork && iteration < 100) {
    iteration++;
    let pathsToProcess: (TraversalPathDocument | EndpointPathDocument)[] = [];

    if (paths) {
      // Direct list provided
      pathsToProcess = paths;
      needsMoreWork = false;
    } else if (generator) {
      // Reuse same generator - pagination cursor is preserved internally
      pathsToProcess = await collectBatch(generator, batchSize);
      if (pathsToProcess.length === 0) {
        needsMoreWork = false;
      }
    } else if (fullGenerator) {
      // Full extend - reuse same generator for pagination
      pathsToProcess = await collectBatch(fullGenerator, batchSize);
      if (pathsToProcess.length === 0) {
        needsMoreWork = false;
      }
    }

    if (pathsToProcess.length === 0) {
      break;
    }

    await extendPathsBatch(process, pathsToProcess, triples);
    totalProcessed += pathsToProcess.length;

    if (isFullExtend) {
      await markPathsConsidered(process, pathsToProcess);
    }

    log.info(
      `extendPaths iteration ${iteration}: processed ${pathsToProcess.length} paths (total: ${totalProcessed}) for process ${pid}`
    );
  }

  log.info(
    `extendPaths complete for process ${pid}: processed ${totalProcessed} paths in ${iteration} iterations`
  );
}
