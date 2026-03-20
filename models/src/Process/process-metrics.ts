import { Triple } from '../Triple';
import { ProcessTriple } from '../ProcessTriple';
import { createLogger } from '@derzis/common';
const log = createLogger('models:process-metrics');

export interface PredicateMetrics {
  url: string;
  count: number;
  subjCov: number | null;
  objCov: number | null;
  branchFactor: {
    subj: number;
    obj: number;
  };
}

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

export async function calcProcMetrics(
  pid: string,
  seeds: string[],
  noSeedCovCalc: boolean = false
): Promise<ProcessMetrics> {
  const predicateCounts = await getPredicateCounts(pid);

  const predicates: PredicateMetrics[] = [];

  for (const pred of predicateCounts) {
    const url = pred._id;
    const count = pred.count;

    let subjCov: number | null = null;
    let objCov: number | null = null;

    if (!noSeedCovCalc) {
      subjCov = await getSeedCoverage(pid, url, 'subject', seeds);
      objCov = await getSeedCoverage(pid, url, 'object', seeds);
    }

    const bf = await getBranchingFactor(pid, url);

    log.info(
      `Metrics for predicate ${url}: count=${count}, subjCov=${subjCov}, objCov=${objCov}, subj=${bf.subj}, obj=${bf.obj}`
    );

    predicates.push({
      url,
      count,
      subjCov,
      objCov,
      branchFactor: bf
    });
  }

  const globalMetrics = await getGlobalMetrics(pid);

  return { predicates, globalMetrics };
}

export async function getPredicateCounts(pid: string) {
  const result = await ProcessTriple.aggregate<{ _id: string; count: number }>([
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
    { $group: { _id: '$tripleData.predicate', count: { $sum: 1 } } }
  ]);

  return result;
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

  const result = await ProcessTriple.aggregate<{ coverage: number }>([
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
    { $match: { 'tripleData.predicate': predicate, [`tripleData.${field}`]: { $in: seeds } } },
    { $group: { _id: `$tripleData.${field}` } },
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
