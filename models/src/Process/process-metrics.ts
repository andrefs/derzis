import { NamedNodeTriple, LiteralTriple } from '../Triple';
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

    const subjCov = await getDistinctCount({ processId: pid, predicate: url }, 'subject', seeds);
    const objCov = await getDistinctCount({ processId: pid, predicate: url }, 'object', seeds);
    const subjCount = await getDistinctCount({ predicate: url }, 'subject');
    const objCount = await getDistinctCount({ predicate: url }, 'object');

    log.info(
      `Metrics for predicate ${url}: count=${count}, subjCov=${subjCov}, objCov=${objCov}, subjCount=${subjCount}, objCount=${objCount}`
    );

    predicates.push({
      url,
      count,
      subjCov,
      objCov,
      branchFactor: {
        subj: subjCount,
        obj: objCount
      }
    });
  }

  const globalMetrics = await getGlobalMetrics(pid);

  return { predicates, globalMetrics };
}

async function getPredicateCounts(pid: string) {
  const namedNodeCounts = await NamedNodeTriple.aggregate([
    { $match: { processId: pid } },
    { $group: { _id: '$predicate', count: { $sum: 1 } } }
  ]);

  const literalCounts = await LiteralTriple.aggregate([
    { $match: { processId: pid } },
    { $group: { _id: '$predicate', count: { $sum: 1 } } }
  ]);

  const countMap = new Map<string, number>();

  for (const nc of namedNodeCounts) {
    countMap.set(nc._id, (countMap.get(nc._id) || 0) + nc.count);
  }
  for (const lc of literalCounts) {
    countMap.set(lc._id, (countMap.get(lc._id) || 0) + lc.count);
  }

  return Array.from(countMap.entries()).map(([url, count]) => ({ _id: url, count }));
}

async function getDistinctCount(
  match: Record<string, unknown>,
  field: 'subject' | 'object',
  seeds?: string[]
): Promise<number> {
  const query: Record<string, unknown> = { ...match };

  if (seeds && seeds.length > 0) {
    if (field === 'subject') {
      query.subject = { $in: seeds };
    } else {
      query['object'] = { $in: seeds };
    }
  }

  const result = await NamedNodeTriple.aggregate([
    { $match: query },
    { $group: { _id: `$${field}` } },
    { $count: 'count' }
  ]);

  return result[0]?.count || 0;
}

async function getGlobalMetrics(pid: string): Promise<GlobalMetrics> {
  const [subjectsResult, objectsResult, triplesResult, resourcesResult] = await Promise.all([
    NamedNodeTriple.aggregate([
      { $match: { processId: pid } },
      { $group: { _id: '$subject' } },
      { $count: 'totalSubjects' }
    ]),
    NamedNodeTriple.aggregate([
      { $match: { processId: pid } },
      { $group: { _id: '$object' } },
      { $count: 'totalObjects' }
    ]),
    NamedNodeTriple.countDocuments({ processId: pid }),
    NamedNodeTriple.aggregate([
      { $match: { processId: pid } },
      { $project: { node: ['$subject', '$object'] } },
      { $unwind: '$node' },
      { $group: { _id: '$node' } },
      { $count: 'totalResources' }
    ])
  ]);

  return {
    totalSubjects: subjectsResult[0]?.totalSubjects || 0,
    totalObjects: objectsResult[0]?.totalObjects || 0,
    totalTriples: triplesResult,
    totalResources: resourcesResult[0]?.totalResources || 0
  };
}
