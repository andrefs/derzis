import { ProcessClass } from './Process';
import { BranchFactorClass, SeedPosRatioClass } from './aux-classes';
import { ProcessTriple, ProcessTripleClass } from '../ProcessTriple';
import { Resource } from '../Resource';
import { TraversalPath } from '../Path';
import { LiteralTriple, LiteralTripleClass, NamedNodeTriple, NamedNodeTripleClass, TripleClass, Triple, TripleType } from '../Triple';
import { type DocumentType } from '@typegoose/typegoose';
import { SimpleTriple, TripleType as CommonTripleType } from '@derzis/common';

export async function* getTriples(process: ProcessClass): AsyncGenerator<SimpleTriple> {
  const procTriples = await ProcessTriple.find({ processId: process.pid }).populate({
    path: 'triple',
    model: (doc: ProcessTripleClass) => doc.tripleType === CommonTripleType.NAMED_NODE ? NamedNodeTriple : LiteralTriple
  });

  for (const procTriple of procTriples) {
    if (procTriple.triple) {
      const triple = procTriple.triple as TripleClass;
      if (triple.type === CommonTripleType.NAMED_NODE) {
        const t = triple as NamedNodeTripleClass;
        yield {
          subject: t.subject,
          predicate: t.predicate,
          object: t.object,
          type: CommonTripleType.NAMED_NODE
        };
      } else {
        const t = triple as LiteralTripleClass;
        yield {
          subject: t.subject,
          predicate: t.predicate,
          object: t.object,
          type: CommonTripleType.LITERAL
        };
      }
    }
  }
}

export async function* getTriplesJson(
  process: ProcessClass,
  includeCreatedAt: boolean = false
): AsyncGenerator<string> {
  for await (const t of getTriples(process)) {
    const obj = includeCreatedAt
      ? t
      : { subject: t.subject, predicate: t.predicate, object: t.object };
    yield JSON.stringify(obj);
  }
}

export async function* getDomainsJson(process: ProcessClass) {
  for await (const d of getAllDomains(process)) {
    console.log('XXXXXXXXXXXX', d);
    yield JSON.stringify(d.origin);
  }
}

export async function* getResourcesJson(process: ProcessClass) {
  for await (const r of getAllResources(process)) {
    yield JSON.stringify(r._id);
  }
}

export async function getResourceCount(process: ProcessClass) {
  const res = await ProcessTriple.aggregate(
    [
      {
        $match: {
          processId: process.pid
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
  return res.length > 0 ? res[0].count : 0;
}

export async function* getAllResources(process: ProcessClass) {
  const res = ProcessTriple.aggregate(
    [
      // get all process triples matching this process
      {
        $match: {
          processId: process.pid
        }
      },
      // group by triple to avoid duplicates
      { $group: { _id: '$triple' } },
      // get actual triples
      {
        $lookup: {
          from: 'triples',
          localField: '_id',
          foreignField: '_id',
          as: 'ts'
        }
      },
      // flatten array
      {
        $unwind: {
          path: '$ts',
          preserveNullAndEmptyArrays: true
        }
      },
      // get sources (resources) from triples
      { $project: { sources: '$ts.sources' } },
      // flatten sources array
      {
        $unwind: {
          path: '$sources',
          preserveNullAndEmptyArrays: true
        }
      },
      // group by source to avoid duplicates
      { $group: { _id: '$sources' } }
    ],
    { maxTimeMS: 60000, allowDiskUse: true }
  ).cursor({ batchSize: 100 });
  for await (const r of res) {
    yield r;
  }
}

export async function* getAllDomains(process: ProcessClass) {
  const res = ProcessTriple.aggregate(
    [
      {
        $match: {
          processId: process.pid
        }
      },
      {
        $group: {
          _id: '$triple'
        }
      },
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
      {
        $project: {
          sources: '$ts.sources'
        }
      },
      {
        $unwind: {
          path: '$sources',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $group: {
          _id: '$sources'
        }
      },
      {
        $lookup: {
          from: 'resources',
          localField: '_id',
          foreignField: 'url',
          as: 'rs'
        }
      },
      {
        $unwind: {
          path: '$rs',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $group: {
          _id: '$rs.url',
          domain: {
            $first: '$rs.domain'
          }
        }
      },
      {
        $lookup: {
          from: 'domains',
          localField: 'domain',
          foreignField: 'origin',
          as: 'ds'
        }
      },
      {
        $unwind: {
          path: '$ds',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $group: {
          _id: '$ds._id',
          origin: {
            $first: '$ds.origin'
          }
        }
      }
    ],
    { maxTimeMS: 60000, allowDiskUse: true }
  ).cursor({ batchSize: 100 });
  for await (const d of res) {
    yield d;
  }
}

/**
 * Get info about a process including counts of resources, triples, domains, paths, and timing metrics
 * @param {DocumentType<ProcessClass>} process - the process to get info for
 * @returns {Promise<object>} - an object containing info about the process
 */
export async function getInfo(process: DocumentType<ProcessClass>) {
  const baseFilter = { processId: process.pid };
  const lastResource = await Resource.findOne().sort({ updatedAt: -1 }); // TODO these should be process specific
  const lastLT = await LiteralTriple.findOne().sort({ updatedAt: -1 });
  const lastNNT = await NamedNodeTriple.findOne().sort({ updatedAt: -1 });
  const lastTriple = [lastLT, lastNNT].reduce((latest, t) => {
    if (!t) return latest;
    return !latest || (t.updatedAt ?? new Date(0)) > (latest.updatedAt ?? new Date(0)) ? t : latest;
  }, null as (LiteralTripleClass | NamedNodeTripleClass | null));
  const lastPath = await TraversalPath.findOne({ status: 'active' }).sort({ updatedAt: -1 });
  const last = Math.max(
    lastResource?.updatedAt?.getTime() || 0,
    lastTriple?.updatedAt?.getTime() || 0,
    lastPath?.updatedAt?.getTime() || 0
  );

  const totalPaths = await TraversalPath.countDocuments({
    'seed.url': { $in: process.currentStep.seeds },
    status: 'active'
  }).lean();
  const avgPathLength = totalPaths
    ? await TraversalPath.aggregate([
      { $match: { 'seed.url': { $in: process.currentStep.seeds }, status: 'active' } },
      { $group: { _id: null, avgLength: { $avg: '$nodes.count' } } }
    ]).then((res) => res[0]?.avgLength || 0)
    : 0;

  const avgPathProps = totalPaths
    ? await TraversalPath.aggregate([
      { $match: { 'seed.url': { $in: process.currentStep.seeds }, status: 'active' } },
      { $group: { _id: null, avgProps: { $avg: '$predicates.count' } } }
    ]).then((res) => res[0]?.avgProps || 0)
    : 0;

  const timeToLastResource = lastResource
    ? (lastResource!.updatedAt.getTime() - process.createdAt!.getTime()) / 1000
    : null;
  const timeRunning = last ? (last - process.createdAt!.getTime()) / 1000 : null;

  return {
    resources: {
      total: await getResourceCount(process),
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
      total: (await Array.fromAsync(getAllDomains(process))).length
      //beingCrawled: (
      //  await Domain.find({ ...baseFilter, status: 'crawling' })
      //    .select('origin')
      //    .lean()
      //).map((d) => d.origin),
      //ready: await Domain.countDocuments({
      //  ...baseFilter,
      //  status: 'ready'
      //}).lean(), // TODO add index
      //crawling: await Domain.countDocuments({
      //  ...baseFilter,
      //  status: 'crawling'
      //}).lean(), // TODO add index
      //error: await Domain.countDocuments({
      //  ...baseFilter,
      //  status: 'error'
      //}).lean() // TODO add index
    },
    paths: {
      total: await TraversalPath.countDocuments({
        'seed.url': { $in: process.currentStep.seeds }
      }).lean(),
      deleted: await TraversalPath.countDocuments({
        'seed.url': { $in: process.currentStep.seeds },
        status: 'deleted'
      }).lean(), // TODO add index
      active: await TraversalPath.countDocuments({
        'seed.url': { $in: process.currentStep.seeds },
        status: 'active'
      }).lean(), // TODO add index
      avgPathLength,
      avgPathProps
    },
    createdAt: process.createdAt,
    timeToLastResource: timeToLastResource || '',
    timeRunning: timeRunning || '',
    currentStep: process.currentStep,
    steps: process.steps,
    notification: process.notification,
    status: process.status
  };
}

/**
 * Get predicates branching factor and seed position ratio for the current step as a map
 * @returns {Map<string, {bf: number, spr: number}> | undefined} - map of predicate URL to branching factor and seeds position ratio
 */
export function curPredsDirMetrics(
  process: ProcessClass
): Map<string, { bf: BranchFactorClass; spr: SeedPosRatioClass }> | undefined {
  return process.currentStep.predsDirMetrics?.reduce((map, obj) => {
    if (!obj.branchFactor || !obj.seedPosRatio) {
      return map;
    }
    map.set(obj.url, {
      // TODO should this return decomposed metrics instead of ratio?
      bf: obj.branchFactor,
      spr: obj.seedPosRatio
    });
    return map;
  }, new Map<string, { bf: BranchFactorClass; spr: SeedPosRatioClass }>());
}


