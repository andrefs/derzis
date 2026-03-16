import {
  TraversalPath,
  type TraversalPathDocument,
  EndpointPath,
  type EndpointPathDocument,
  type PathSkeleton,
  type TraversalPathSkeleton,
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
 * Validates the process for conversion and handles early exits.
 * @param pid - The Process ID to validate.
 * @returns The validated Process document or null if validation fails.
 */
async function validateProcessForConversion(pid: string): Promise<ProcessClass | null> {
  const process = await Process.findOne({ pid });
  if (!process) {
    log.warn(`Process ${pid} not found for conversion`);
    return null;
  }

  if (process.curPathType !== PathType.TRAVERSAL) {
    log.info(`Process ${pid} already ${process.curPathType}, skipping conversion`);
    return null;
  }

  return process;
}

/**
 * Fetches a batch of traversal paths for the given process.
 * @param pid - The Process ID.
 * @param lastSeenId - The last seen ObjectId for pagination (null for first batch).
 * @param batchSize - The number of paths to fetch in this batch.
 * @param maxPathLength - Maximum path length filter (nodes.count < maxPathLength).
 * @param maxPathProps - Maximum predicate count filter (predicates.count <= maxPathProps).
 * @returns Array of traversal path lean documents.
 */
async function fetchTraversalPathsBatch(
  pid: string,
  lastSeenId: Types.ObjectId | null,
  batchSize: number,
  maxPathLength: number,
  maxPathProps: number
): Promise<any[]> {
  const query: QueryFilter<TraversalPathDocument> = {
    processId: pid,
    status: 'active',
    'nodes.count': { $lt: maxPathLength },
    'predicates.count': { $lte: maxPathProps }
  };

  if (lastSeenId) {
    query._id = { $gt: lastSeenId };
  }

  return await TraversalPath.find(query).sort({ _id: 1 }).limit(batchSize).lean();
}

/**
 * Groups traversal paths by head identifier and collects seed -> min distance mappings.
 * @param traversalPaths - Array of traversal path documents to group.
 * @returns Map of head identifiers to group data containing type, identifier, and seedMap.
 */
function groupTraversalPathsByHead(
  traversalPaths: TraversalPathDocument[]
): Map<string, { type: string; identifier: string; seedMap: Map<string, number> }> {
  // Group by head identifier and collect seed -> min distance
  // For URL heads: group by head.url
  // For LITERAL heads: group by literal:${value}:${datatype}:${language}
  const headGroups = new Map<
    string,
    { type: string; identifier: string; seedMap: Map<string, number> }
  >();

  for (const tp of traversalPaths as any[]) {
    const headType = tp.head.type;
    let identifier: string;
    let seedUrl: string;
    let nodesCount = tp.nodes.count;

    if (headType === HEAD_TYPE.URL) {
      identifier = tp.head.url;
      seedUrl = tp.seed.url;
    } else if (headType === HEAD_TYPE.LITERAL) {
      const value = tp.head.value || '';
      const datatype = tp.head.datatype || '';
      const language = tp.head.language || '';
      identifier = `literal:${value}:${datatype}:${language}`;
      seedUrl = tp.seed.url;
    } else {
      log.warn(`Unknown head type during conversion: ${headType}, skipping`);
      continue;
    }

    let group = headGroups.get(identifier);
    if (!group) {
      group = { type: headType, identifier, seedMap: new Map<string, number>() };
      headGroups.set(identifier, group);
    }
    const existing = group.seedMap.get(seedUrl);
    if (existing === undefined || nodesCount < existing) {
      group.seedMap.set(seedUrl, nodesCount);
    }
  }

  return headGroups;
}

/**
 * Processes a single head group to create or update EndpointPath documents.
 * @param group - The head group data containing type, identifier, and seedMap.
 * @param pid - The Process ID.
 * @param domainCache - Cache for domain information to avoid recomputation.
 * @returns Array of traversal path IDs that were processed (for cleanup).
 */
async function processHeadGroup(
  group: { type: string; identifier: string; seedMap: Map<string, number> },
  pid: string,
  domainCache: Map<string, { origin: string; isUnvisited: boolean }>
): Promise<Types.ObjectId[]> {
  const { type: headType, identifier, seedMap } = group;

  let domain: { origin: string; isUnvisited: boolean } | undefined;
  let literalHead:
    | { type: string; value: string; datatype?: string; language?: string }
    | undefined;

  if (headType === HEAD_TYPE.URL) {
    // Get or compute domain
    let cachedDomain = domainCache.get(identifier);
    if (!cachedDomain) {
      try {
        const origin = new URL(identifier).origin;
        cachedDomain = { origin, isUnvisited: true };
        domainCache.set(identifier, cachedDomain);
      } catch (err) {
        log.warn(`Invalid head URL during conversion, skipping: ${identifier}`);
        return [];
      }
    }
    domain = cachedDomain;
  } else if (headType === HEAD_TYPE.LITERAL) {
    // Parse literal identifier: literal:${value}:${datatype}:${language}
    const parts = identifier.slice(8).split(':'); // Remove 'literal:' prefix
    literalHead = {
      type: HEAD_TYPE.LITERAL,
      value: parts[0] || '',
      datatype: parts[1] || undefined,
      language: parts[2] || undefined
    };
  }

  const seedPaths = Array.from(seedMap.entries()).map(([seed, minLength]) => ({
    seed,
    minLength
  }));
  const shortestPathLength = Math.min(...seedMap.values());

  // Build query based on head type
  const query: Record<string, unknown> = {
    processId: pid,
    'head.type': headType
  };
  if (headType === HEAD_TYPE.URL) {
    (query as any)['head.url'] = identifier;
  } else {
    // For literal heads, match by value, datatype, and language
    const literalKey = identifier.slice(8); // Remove 'literal:' prefix
    const parts = literalKey.split(':');
    (query as any)['head.value'] = parts[0];
    if (parts[1]) (query as any)['head.datatype'] = parts[1];
    if (parts[2]) (query as any)['head.language'] = parts[2];
  }

  // Upsert EndpointPath with optimistic locking
  let attempts = 0;
  const maxAttempts = 3;
  let success = false;

  while (attempts < maxAttempts && !success) {
    attempts++;
    const existing = await EndpointPath.findOne(query)
      .select('_id updatedAt seedPaths shortestPathLength head')
      .exec();

    if (existing) {
      // Merge with existing seedPaths
      const existingSeedMap = new Map(existing.seedPaths.map((sp: any) => [sp.seed, sp.minLength]));
      for (const [seed, minLength] of seedMap.entries()) {
        const cur = existingSeedMap.get(seed);
        if (cur === undefined || minLength < cur) {
          existingSeedMap.set(seed, minLength);
        }
      }
      const mergedSeedPaths = Array.from(existingSeedMap.entries()).map(([seed, minLength]) => ({
        seed,
        minLength
      }));
      const finalShortest = Math.min(shortestPathLength, existing.shortestPathLength);

      const updateSet: Record<string, unknown> = {
        type: 'endpoint',
        shortestPathLength: finalShortest,
        seedPaths: mergedSeedPaths,
        extensionCounter: 0,
        updatedAt: new Date()
      };

      if (headType === HEAD_TYPE.URL) {
        updateSet['head.type'] = 'url';
        // Only set status if existing head has it (URL heads have status, literals don't)
        if (existing.head && (existing.head as any).status) {
          updateSet['head.status'] = (existing.head as any).status;
        }
        if (domain) {
          updateSet['head.domain.origin'] = domain.origin;
        }
      } else {
        updateSet['head.type'] = HEAD_TYPE.LITERAL;
        if (literalHead) {
          updateSet['head.value'] = literalHead.value;
          if (literalHead.datatype) {
            updateSet['head.datatype'] = literalHead.datatype;
          }
          if (literalHead.language) {
            updateSet['head.language'] = literalHead.language;
          }
        }
      }

      const res = await EndpointPath.updateOne(
        { _id: existing._id, updatedAt: existing.updatedAt },
        { $set: updateSet }
      );

      if (res.matchedCount === 0) continue;
      success = true;
    } else {
      // Create new EndpointPath
      const head: Record<string, unknown> = {};
      if (headType === HEAD_TYPE.URL && domain) {
        head.type = HEAD_TYPE.URL;
        head.url = identifier;
        head.domain = { origin: domain.origin, isUnvisited: domain.isUnvisited };
      } else if (headType === HEAD_TYPE.LITERAL && literalHead) {
        head.type = HEAD_TYPE.LITERAL;
        head.value = literalHead.value;
        if (literalHead.datatype) head.datatype = literalHead.datatype;
        if (literalHead.language) head.language = literalHead.language;
      }

      await new EndpointPath({
        processId: pid,
        head,
        status: 'active',
        type: 'endpoint',
        shortestPathLength,
        seedPaths,
        extensionCounter: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      }).save();
      success = true;
    }
  }

  if (!success) {
    log.warn(`Failed to create/update endpoint path for ${identifier} after retries`);
  }

  // Note: This function doesn't return traversal IDs since those are collected separately
  // The caller is responsible for collecting traversal path IDs for cleanup
  return [];
}

/**
 * Updates the process curPathType to ENDPOINT.
 * @param pid - The Process ID.
 */
async function updateProcessPathType(pid: string): Promise<void> {
  const process = await Process.findOne({ pid });
  if (process) {
    process.curPathType = PathType.ENDPOINT;
    await process.save();
  }
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
  domainBlacklist: string[] = [],
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

  // Filter out blacklisted domains
  const originFilter =
    domainBlacklist.length > 0
      ? eligibleOrigins.filter((o) => !domainBlacklist.includes(o))
      : eligibleOrigins;
  if (!originFilter.length) {
    return [];
  }

  const baseQuery = {
    processId: process.pid,
    'head.domain.isUnvisited': true,
    'head.status': 'unvisited',
    'head.type': HEAD_TYPE.URL,
    'head.domain.origin': { $in: originFilter },
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

function buildBaseQuery(process: ProcessClass): Record<string, unknown> {
  return {
    'head.type': HEAD_TYPE.URL,
    'head.domain.isUnvisited': false,
    'head.status': 'unvisited',
    processId: process.pid,
    status: 'active'
  };
}

function buildPathTypeFilter(process: ProcessClass, pathType: PathType): Record<string, unknown> {
  if (pathType === PathType.TRAVERSAL) {
    return genTraversalPathQuery(process);
  } else {
    return {
      shortestPathLength: { $lt: process.currentStep.maxPathLength }
    };
  }
}

function mergePathQueryWithCursor(
  pathFilter: Record<string, unknown>,
  cursorCondition: Record<string, unknown>
): Record<string, unknown> {
  const merged = {
    ...pathFilter,
    ...cursorCondition
  };

  if (pathFilter.$or && cursorCondition.$or) {
    merged.$and = [{ $or: pathFilter.$or as any[] }, { $or: cursorCondition.$or as any[] }];
    delete merged.$or;
  }

  return merged;
}

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
    ...buildBaseQuery(process),
    'head.domain.origin': originFilter
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

    // Merge $or from traversalQuery (predicate filters) with cursorCondition (pagination)
    // Both may have $or keys - need to combine them, not overwrite
    const mergedQuery: Record<string, unknown> = mergePathQueryWithCursor(
      { ...baseQuery, ...traversalQuery },
      cursorCondition
    );

    const paths = await TraversalPath.find(mergedQuery)
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

export function buildStepPathQuery(
  process: ProcessClass,
  pathType: PathType
): QueryFilter<TraversalPathDocument> | QueryFilter<EndpointPathDocument> {
  const baseQuery = buildBaseQuery(process);
  const pathTypeFilter = buildPathTypeFilter(process, pathType);

  // Merge base query with path type filter (no cursor)
  const merged = {
    ...baseQuery,
    ...pathTypeFilter
  };

  // Handle potential $or conflicts between baseQuery and pathTypeFilter
  // (though unlikely since baseQuery doesn't typically have $or)
  if (baseQuery.$or && pathTypeFilter.$or) {
    merged.$and = [{ $or: baseQuery.$or as any[] }, { $or: pathTypeFilter.$or as any[] }];
    delete merged.$or;
  }

  return merged;
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
  const predLimitations = process.currentStep.predLimitations || [];
  const maxPathProps = process.currentStep.maxPathProps;

  const query: QueryFilter<TraversalPathDocument> = {
    processId: process.pid,
    status: 'active',
    'head.type': HEAD_TYPE.URL,
    'nodes.count': { $lt: process.currentStep.maxPathLength },
    'predicates.count': { $lte: maxPathProps }
  };

  if (process.pathExtensionCounter !== undefined) {
    query.extensionCounter = { $lt: process.pathExtensionCounter };
  }

  // Extract constraints by type
  const requirePast: string[] = [];
  const disallowPast: string[] = [];
  const requireFuture: string[] = [];
  const disallowFuture: string[] = [];

  for (const pl of predLimitations) {
    if (pl.lims.includes('require-past')) requirePast.push(pl.predicate);
    if (pl.lims.includes('disallow-past')) disallowPast.push(pl.predicate);
    if (pl.lims.includes('require-future')) requireFuture.push(pl.predicate);
    if (pl.lims.includes('disallow-future')) disallowFuture.push(pl.predicate);
  }

  // For full paths, apply require-future and disallow-future constraints
  const hasFutureConstraints = requireFuture.length > 0 || disallowFuture.length > 0;

  if (hasFutureConstraints) {
    // If require-future exists, it takes precedence (already restricts to those predicates)
    // Otherwise use disallow-future if it exists
    let fullPathFilter: object;
    if (requireFuture.length > 0) {
      fullPathFilter = {
        'predicates.elems': requireFuture.length === 1 ? requireFuture[0] : { $in: requireFuture }
      };
    } else {
      fullPathFilter = {
        $expr: { $not: { $setIsSubset: ['$predicates.elems', disallowFuture] } }
      };
    }

    query.$or = [
      { 'predicates.count': { $lt: maxPathProps } },
      {
        'predicates.count': maxPathProps,
        ...fullPathFilter
      }
    ];
  }

  // Past constraints apply regardless of fullness
  if (requirePast.length > 0 && disallowPast.length > 0) {
    // Both require-past and disallow-past: need $and to combine
    const requireFilter = requirePast.length === 1 ? requirePast[0] : { $all: requirePast };
    const disallowFilter =
      disallowPast.length === 1 ? { $ne: disallowPast[0] } : { $nin: disallowPast };

    query.$and = [{ 'predicates.elems': requireFilter }, { 'predicates.elems': disallowFilter }];
  } else if (requirePast.length > 0) {
    query['predicates.elems'] = requirePast.length === 1 ? requirePast[0] : { $all: requirePast };
  } else if (disallowPast.length > 0) {
    query['predicates.elems'] =
      disallowPast.length === 1 ? { $ne: disallowPast[0] } : { $nin: disallowPast };
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
                'head.status': existingHead.status,
                'head.domain.origin': domain.origin,
                'head.domain.isUnvisited': domain.isUnvisited,
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
            head: {
              type: 'url',
              url: headUrl,
              domain: {
                origin: domain.origin,
                isUnvisited: domain.isUnvisited ?? false
              }
            },
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
  convertToEndpoint?: boolean;
}

/**
 * Determines the path type for a process, falling back to global config.
 * @param process - The ProcessClass instance.
 * @returns The PathType for the process.
 */
function getPathType(process: ProcessClass): PathType {
  return process.curPathType ?? PathType.TRAVERSAL;
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
  triples?: TripleDocument[],
  convertToEndpoint?: boolean
) {
  const pathType = convertToEndpoint ? PathType.ENDPOINT : getPathType(process);
  for (const path of pathsBatch) {
    const result = await path.genExtendedPaths(process, triples);

    if (result.extendedPaths.length > 0) {
      let pathsToCreate = result.extendedPaths;
      if (convertToEndpoint) {
        pathsToCreate = convertToEndpointSkeletons(pathsToCreate, path);
      }
      await insertProcTriples(process.pid, result.procTriples, process.steps.length);
      await createNewPaths(pathsToCreate, pathType);
      await deleteOldPaths(new Set([path._id]), convertToEndpoint ? PathType.TRAVERSAL : pathType);
    }
  }
}

/**
 * Converts TraversalPathSkeleton objects to EndpointPathSkeleton when converting from traversal to endpoint.
 * @param skeletons - Array of path skeletons (may be TraversalPathSkeleton or EndpointPathSkeleton)
 * @param parentPath - The parent path from which these were extended
 * @returns Array of EndpointPathSkeleton
 */
function convertToEndpointSkeletons(
  skeletons: PathSkeleton[],
  parentPath: TraversalPathDocument | EndpointPathDocument
): EndpointPathSkeleton[] {
  return skeletons.map((s) => {
    if ('seedPaths' in s) {
      return s as EndpointPathSkeleton;
    }
    const tp = s as TraversalPathSkeleton & { seed: { url: string } };
    const pathLength = (tp.nodes?.count ?? 0) + 1;
    return {
      processId: tp.processId,
      head: tp.head,
      type: PathType.ENDPOINT,
      status: 'active',
      shortestPathLength: pathLength,
      seedPaths: [{ seed: tp.seed.url, minLength: pathLength }]
    } as EndpointPathSkeleton;
  });
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
export async function extendPaths({
  pid,
  triples,
  headUrl,
  paths,
  convertToEndpoint
}: ExtendPathsArgs) {
  // If no pid, get all process IDs and recurse for each
  if (!pid) {
    const pids = await Process.distinct('pid');
    for (const p of pids) {
      await extendPaths({ pid: p, triples, headUrl, paths, convertToEndpoint });
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
  const pathGen = triples
    ? queryPathsForTriples(process, triples, batchSize)
    : headUrl
      ? queryPathsForHeadUrl(process, headUrl, batchSize)
      : null;

  // For full extend, we need a separate generator since it's a different code path
  const fullPathGen = !triples && !headUrl ? queryAllExtendablePaths(process, batchSize) : null;

  while (needsMoreWork && iteration < 100) {
    iteration++;
    let pathsToProcess: (TraversalPathDocument | EndpointPathDocument)[] = [];

    if (paths) {
      // Direct list provided
      pathsToProcess = paths;
      needsMoreWork = false;
    } else if (pathGen) {
      // Reuse same generator - pagination cursor is preserved internally
      pathsToProcess = await collectBatch(pathGen, batchSize);
      if (pathsToProcess.length === 0) {
        needsMoreWork = false;
      }
    } else if (fullPathGen) {
      // Full extend - reuse same generator for pagination
      pathsToProcess = await collectBatch(fullPathGen, batchSize);
      if (pathsToProcess.length === 0) {
        needsMoreWork = false;
      }
    }

    if (pathsToProcess.length === 0) {
      break;
    }

    await extendPathsBatch(process, pathsToProcess, triples, convertToEndpoint);
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

/**
 * Converts all active TraversalPaths for a process to EndpointPaths.
 * Aggregates by head.url, merges seed distances (taking min), marks traversal paths deleted,
 * and updates process curPathType to ENDPOINT.
 * Uses batching to avoid loading all paths into memory at once.
 * @param pid - The Process ID to convert.
 */
export async function convertTraversalToEndpointPaths(pid: string): Promise<void> {
  // Validate process and handle early exits
  const process = await validateProcessForConversion(pid);
  if (!process) {
    return;
  }

  // Configuration
  const BATCH_SIZE = 100;
  const maxPathLength = process.currentStep.maxPathLength;
  const maxPathProps = process.currentStep.maxPathProps;
  const traversalIdsToDelete: Types.ObjectId[] = [];
  const domainCache = new Map<string, { origin: string; isUnvisited: boolean }>();

  // Process traversal paths in batches
  let hasMorePaths = true;
  let lastSeenId: Types.ObjectId | null = null;
  let totalHeadGroups = 0;

  while (hasMorePaths) {
    // Fetch a batch of traversal paths
    const batch = await fetchTraversalPathsBatch(
      pid,
      lastSeenId,
      BATCH_SIZE,
      maxPathLength,
      maxPathProps
    );

    if (batch.length === 0) {
      hasMorePaths = false;
      break;
    }

    // Group the batch of paths by head identifier
    const batchHeadGroups = groupTraversalPathsByHead(batch);

    // Process each head group in this batch immediately
    for (const [, group] of batchHeadGroups.entries()) {
      await processHeadGroup(group, pid, domainCache);
    }

    totalHeadGroups += batchHeadGroups.size;

    // Collect traversal path IDs for cleanup
    const batchTraversalIds = (batch as any[]).map((tp) => tp._id);
    traversalIdsToDelete.push(...batchTraversalIds);

    // Check if we need to fetch more batches
    hasMorePaths = batch.length === BATCH_SIZE;
    if (hasMorePaths) {
      lastSeenId = batch[batch.length - 1]._id;
    }
  }

  // If no paths were found, exit early
  if (traversalIdsToDelete.length === 0) {
    log.info(`No active traversal paths to convert for process ${pid}`);
    return;
  }

  // Mark traversal paths as deleted
  if (traversalIdsToDelete.length > 0) {
    await TraversalPath.updateMany(
      { _id: { $in: traversalIdsToDelete } },
      { $set: { status: 'deleted' } }
    );
  }

  const ratio =
    totalHeadGroups > 0 ? (traversalIdsToDelete.length / totalHeadGroups).toFixed(2) : '0';
  log.info(
    `Converted ${traversalIdsToDelete.length} TraversalPaths into ${totalHeadGroups} EndpointPaths (1:${ratio} ratio) for process ${pid}`
  );
}

export async function deleteRemainingTraversalPaths(pid: string): Promise<number> {
  const result = await TraversalPath.updateMany(
    { processId: pid, status: 'active' },
    { $set: { status: 'deleted' } }
  );
  return result.modifiedCount;
}
