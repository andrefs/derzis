import { Triple } from '../Triple';
import { ProcessTriple } from '../ProcessTriple';
import { createLogger } from '@derzis/common';
const log = createLogger('models:process-metrics');

export interface PredicateMetrics {
  url: string;
  count: number;
  subjCov: number;
  objCov: number;
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

export async function calcProcMetrics(pid: string, seeds: string[]): Promise<ProcessMetrics> {
  const predicateCounts = await getPredicateCounts(pid);

  const predicates: PredicateMetrics[] = [];

  for (const pred of predicateCounts) {
    const url = pred._id;
    const count = pred.count;

    const subjCov = await getSeedCoverage(pid, url, 'subject', seeds);
    const objCov = await getSeedCoverage(pid, url, 'object', seeds);
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
  const result = await ProcessTriple.aggregate([
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

  const result = await ProcessTriple.aggregate([
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
    { $group: { _id: `$${field}` } },
    { $count: 'coverage' }
  ]);

  log.info(`getSeedCoverage result: ${JSON.stringify(result)}`);
  return result[0]?.coverage || 0;
}

export async function getBranchingFactor(
  pid: string,
  predicate: string
): Promise<{ subj: number; obj: number }> {
  const result = await ProcessTriple.aggregate([
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
    { $match: { 'tripleData.predicate': predicate } },
    {
      $group: {
        _id: null,
        distinctSubjects: { $addToSet: '$tripleData.subject' },
        distinctObjects: { $addToSet: '$tripleData.object' }
      }
    },
    {
      $project: {
        _id: 0,
        subj: { $size: '$distinctSubjects' },
        obj: { $size: '$distinctObjects' }
      }
    }
  ]);

  return result[0] || { subj: 0, obj: 0 };
}

export async function getGlobalMetrics(pid: string): Promise<GlobalMetrics> {
  const [triplesResult, subjectsResult, objectsResult, resourcesResult] = await Promise.all([
    ProcessTriple.countDocuments({ processId: pid }),
    ProcessTriple.aggregate([
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
    ProcessTriple.aggregate([
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
    ProcessTriple.aggregate([
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
