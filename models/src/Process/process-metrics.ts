import { Triple } from '../Triple';
import { ProcessTriple } from '../ProcessTriple';
import { createLogger } from '@derzis/common';
import type { PipelineStage } from 'mongoose';
const log = createLogger('models:process-metrics');

export interface PredicateMetrics {
  url: string;
  count: number;
}

export interface SeedPredicateMetrics extends PredicateMetrics {
  subjCov: number | null;
  objCov: number | null;
}

export type OtherPredicateMetrics = PredicateMetrics & {
  branchFactor: {
    subj: number;
    obj: number;
  };
};

export interface GlobalMetrics {
  totalSubjects: number;
  totalObjects: number;
  totalTriples: number;
  totalResources: number;
}

export interface ProcessMetrics {
  predicates: PredicateMetrics[];
  globalMetrics: GlobalMetrics;
}

export async function calcProcSeedPredMetrics(
  pid: string,
  seeds: string[]
): Promise<SeedPredicateMetrics[]> {
  const sps = await getSeedPredicates(pid, seeds);
  console.log(`Unique predicates connected to seeds in process ${pid}: ${JSON.stringify(sps)}`);
  const seedPredCounts = await getPredicateCounts(pid, sps);
  console.log(
    `Predicate counts for process ${pid} and predicates ${JSON.stringify(sps)}: ${JSON.stringify(seedPredCounts)}`
  );
  const seedPredMetrics: SeedPredicateMetrics[] = [];
  for (const url of sps) {
    const count = seedPredCounts[url] || 0;
    const subjCov = await getSeedCoverage(pid, url, 'subject', seeds);
    const objCov = await getSeedCoverage(pid, url, 'object', seeds);

    seedPredMetrics.push({
      url,
      count,
      subjCov,
      objCov
    });
  }

  return seedPredMetrics;
}

export async function calcPredMetrics(
  pid: string,
  predicates: string[]
): Promise<OtherPredicateMetrics[]> {
  const predicateCounts = await getPredicateCounts(pid, predicates);
  const res = [];

  for (const [url, count] of Object.entries(predicateCounts)) {
    const bf = await getBranchingFactor(pid, url);

    log.info(`Metrics for predicate ${url}: count=${count},  subj=${bf.subj}, obj=${bf.obj}`);

    res.push({
      url,
      count,
      branchFactor: bf
    });
  }

  return res;
}

export async function calcProcGlobalMetrics(pid: string): Promise<GlobalMetrics> {
  const globalMetrics = await getGlobalMetrics(pid);
  log.info(`Global metrics for process ${pid}: ${JSON.stringify(globalMetrics)}`);
  return globalMetrics;
}

/**
 * Get unique predicates associated with the given seeds in the process using server-side aggregation
 * @param pid Process ID
 * @param seeds Array of seed URIs
 * @returns Array of unique predicate URLs that are connected to the seeds in the process
 * This function performs a MongoDB aggregation to find triples where the subject or object matches any of the seeds,
 * then looks up the associated process triples to filter by process ID, and finally groups by predicate to get unique values.
 */
export async function getSeedPredicates(pid: string, seeds: string[]) {
  const result = await Triple.aggregate<{ _id: string }>([
    {
      $match: {
        $or: [
          { subject: { $in: seeds }, type: 'namedNode' },
          { object: { $in: seeds }, type: 'namedNode' }
        ]
      }
    },
    {
      $lookup: {
        from: 'processTriples',
        localField: '_id',
        foreignField: 'triple',
        as: 'ptData'
      }
    },
    { $match: { 'ptData.processId': pid } },
    { $group: { _id: '$predicate' } }
  ]);

  return result.map((r) => r._id);
}

/**
 * Get counts of triples for each predicate in the process using server-side aggregation
 * @param pid Process ID
 * @returns Array of objects with predicate URL and count of triples
 * Example result: [{ _id: 'http://example.com/predicate1', count: 10 }, { _id: 'http://example.com/predicate2', count: 5 }]
 */
export async function getPredicateCounts(
  pid: string,
  predicates?: string[]
): Promise<{ [predicate: string]: number }> {
  const matchStage: PipelineStage[] = [{ $match: { processId: pid } }];
  if (predicates && predicates.length > 0) {
    matchStage.push({
      $lookup: {
        from: 'triples',
        localField: 'triple',
        foreignField: '_id',
        as: 'tripleData'
      }
    });
    matchStage.push({ $unwind: '$tripleData' });
    matchStage.push({ $match: { 'tripleData.predicate': { $in: predicates } } });
  } else {
    matchStage.push({
      $lookup: {
        from: 'triples',
        localField: 'triple',
        foreignField: '_id',
        as: 'tripleData'
      }
    });
    matchStage.push({ $unwind: '$tripleData' });
  }
  matchStage.push({ $group: { _id: '$tripleData.predicate', count: { $sum: 1 } } });
  const result = await ProcessTriple.aggregate<{ _id: string; count: number }>(matchStage);

  return result.reduce(
    (acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    },
    // eslint-disable-next-line no-restricted-syntax
    {} as { [predicate: string]: number }
  );
}

export async function getSeedCoverage(
  pid: string,
  predicate: string,
  field: 'subject' | 'object',
  seeds: string[]
): Promise<number> {
  if (!seeds || seeds.length === 0) {
    return 0;
  }

  log.info(
    `getSeedCoverage: pid=${pid}, predicate=${predicate}, field=${field}, seeds=${JSON.stringify(seeds)}`
  );

  const fieldFilter = field === 'subject' ? 'subject' : 'object';

  const result = await Triple.aggregate<{ coverage: number }>([
    {
      $match: {
        predicate,
        [fieldFilter]: { $in: seeds },
        type: 'namedNode'
      }
    },
    {
      $lookup: {
        from: 'processTriples',
        localField: '_id',
        foreignField: 'triple',
        as: 'ptData'
      }
    },
    { $match: { 'ptData.processId': pid } },
    { $group: { _id: `$${fieldFilter}` } },
    { $count: 'coverage' }
  ]);

  log.info(`getSeedCoverage result for predicate ${predicate}: ${JSON.stringify(result)}`);
  return result[0]?.coverage || 0;
}

export async function getBranchingFactor(
  pid: string,
  predicate: string
): Promise<{ subj: number; obj: number }> {
  // Use global triples data with server-side aggregation
  // Branching factor is independent of process - uses all triples in database
  const [subjectsResult, objectsResult] = await Promise.all([
    Triple.aggregate<{ count: number }>([
      { $match: { predicate } },
      { $group: { _id: '$subject' } },
      { $count: 'count' }
    ]),
    Triple.aggregate<{ count: number }>([
      { $match: { predicate } },
      { $group: { _id: '$object' } },
      { $count: 'count' }
    ])
  ]);

  return {
    subj: subjectsResult[0]?.count || 0,
    obj: objectsResult[0]?.count || 0
  };
}

export async function getGlobalMetrics(pid: string): Promise<GlobalMetrics> {
  const [triplesResult, subjectsResult, objectsResult, resourcesResult] = await Promise.all([
    ProcessTriple.countDocuments({ processId: pid }),
    ProcessTriple.aggregate<{ totalSubjects: number }>([
      { $match: { processId: pid } },
      {
        $lookup: {
          from: 'triples',
          localField: 'triple',
          foreignField: '_id',
          as: 'tripleData'
        }
      },
      { $unwind: '$tripleData' },
      { $group: { _id: '$tripleData.subject' } },
      { $count: 'totalSubjects' }
    ]),
    ProcessTriple.aggregate<{ totalObjects: number }>([
      { $match: { processId: pid } },
      {
        $lookup: {
          from: 'triples',
          localField: 'triple',
          foreignField: '_id',
          as: 'tripleData'
        }
      },
      { $unwind: '$tripleData' },
      { $group: { _id: '$tripleData.object' } },
      { $count: 'totalObjects' }
    ]),
    ProcessTriple.aggregate<{ totalResources: number }>([
      { $match: { processId: pid } },
      {
        $lookup: {
          from: 'triples',
          localField: 'triple',
          foreignField: '_id',
          as: 'tripleData'
        }
      },
      { $unwind: '$tripleData' },
      { $project: { node: ['$tripleData.subject', '$tripleData.object'] } },
      { $unwind: '$node' },
      { $group: { _id: '$node' } },
      { $count: 'totalResources' }
    ])
  ]);

  return {
    totalTriples: triplesResult,
    totalSubjects: subjectsResult[0]?.totalSubjects || 0,
    totalObjects: objectsResult[0]?.totalObjects || 0,
    totalResources: resourcesResult[0]?.totalResources || 0
  };
}
