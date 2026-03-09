import type { Types, Document, UpdateQuery, AnyBulkWriteOperation } from 'mongoose';
import { PathType, TripleType, urlValidator, WorkerError } from '@derzis/common';
import { Domain, DomainClass } from './Domain';
import {
  TraversalPath,
  EndpointPath,
  type TraversalPathDocument,
  type EndpointPathDocument,
  EndpointPathClass,
  HEAD_TYPE,
  UrlHead
} from './Path';
import { NamedNodeTriple, type NamedNodeTripleClass } from './Triple';
import type {
  CrawlResourceResult,
  CrawlResourceResultDetails,
  FetchLabelsResourceResult,
  FetchLabelsResourceResultDetails,
  SimpleTriple
} from '@derzis/common';
import config from '@derzis/config';
import { createLogger } from '@derzis/common/server';
const log = createLogger('Resource');

import {
  prop,
  index,
  type ReturnModelType,
  getModelForClass,
  PropType
} from '@typegoose/typegoose';

class CrawlId {
  @prop({ type: Date })
  public domainTs!: Date;

  @prop({ type: Number })
  public counter!: number;
}

@index({ url: 1, status: 1 })
@index({ domain: 1, status: 1 })
@index({ url: 1 }, { unique: true })
@index({ status: 1 })
@index({ domain: 1, status: 1, url: 1 })
class ResourceClass {
  createdAt!: Date;
  updatedAt!: Date;

  @prop({ required: true, validate: urlValidator, type: String })
  public url!: string;

  @prop({ required: true, validate: urlValidator, type: String })
  public domain!: string;

  @prop({
    enum: ['unvisited', 'done', 'crawling', 'error'],
    default: 'unvisited',
    type: String
  })
  public status!: 'unvisited' | 'done' | 'crawling' | 'error';

  @prop({ ref: 'NamedNodeTripleClass', default: [], Type: [NamedNodeTriple] }, PropType.ARRAY)
  public triples?: Types.DocumentArray<NamedNodeTripleClass>;

  @prop({ type: Number })
  public jobId?: number;

  @prop({ type: CrawlId })
  public crawlId?: CrawlId;

  public static async addMany(
    this: ReturnModelType<typeof ResourceClass>,
    resources: { url: string; domain: string }[]
  ) {
    let insertedDocs: ResourceClass[] = [];
    const existingDocs: Partial<ResourceClass>[] = [];

    await this.insertMany(resources, { ordered: false })
      .then((docs) => (insertedDocs = docs.map((d) => d.toObject())))
      .catch((err) => {
        for (const e of err.writeErrors) {
          if (e.err.code && e.err.code === 11000) {
            existingDocs.push(resources[e.err.index]);
          }
          // TO DO handle other errors
        }
        insertedDocs = err.insertedDocs;
      });

    if (insertedDocs.length) {
      const domainsSet = new Set<string>(resources.map((r) => r.domain));
      await Domain.upsertMany(Array.from(domainsSet));
    }

    return insertedDocs;
  }

  /**
   * Adds resources from an array of triples by extracting unique subjects and objects.
   * @param triples - An array of SimpleTriple objects containing subject and object URLs.
   * @returns A promise that resolves to the added resources.
   */
  public static async addFromTriples(
    this: ReturnModelType<typeof ResourceClass>,
    triples: SimpleTriple[]
  ) {
    const resources: { [pos: string]: boolean } = {};
    for (const t of triples) {
      resources[t.subject] = true;
      if (t.type === TripleType.NAMED_NODE) {
        resources[t.object] = true;
      }
    }

    return await this.addMany(
      Object.keys(resources).map((u) => ({
        url: u,
        domain: new URL(u).origin
      }))
    );
  }

  /**
   * Marks a resource as crawled, updating its status and related domain/path stats.
   * @param url - The URL of the resource to mark as crawled.
   * @param details - Details about the crawl result.
   * @param error - Optional error information if the crawl failed.
   * @returns An object containing updated domain crawl information.
   */
  public static async markAsCrawled(
    this: ReturnModelType<typeof ResourceClass>,
    url: string,
    jobResult: CrawlResourceResult | FetchLabelsResourceResult,
    error?: WorkerError
  ) {
    // Resource
    const oldRes = await this.findOneAndUpdate(
      { url },
      {
        status: error ? 'error' : 'done',
        crawlId:
          jobResult.jobType === 'resourceCrawl'
            ? jobResult.details.crawlId
            : jobResult.details.labelFetchId
      },
      { returnDocument: 'before' }
    );

    if (config.manager.pathType === PathType.TRAVERSAL) {
      // TraversalPath
      await TraversalPath.updateMany(
        {
          'head.url': url,
          'head.type': HEAD_TYPE.URL
        },
        {
          $set: {
            'head.status': error ? 'error' : 'done'
          }
        }
      );
    } else {
      // EndpointPath
      await EndpointPath.updateMany(
        {
          'head.url': url,
          'head.type': HEAD_TYPE.URL
        },
        {
          $set: {
            'head.status': error ? 'error' : 'done'
          }
        }
      );
    }

    // Domain
    const baseFilter = { origin: new URL(url).origin };

    let update: UpdateQuery<DomainClass> = {};
    if (oldRes) {
      update['$inc'] = {
        'crawl.queued': -1,
        'crawl.ongoing': -1
      };
    }

    if (error) {
      update['$inc'] = update['$inc'] || {};
      update['$inc']['crawl.failed'] = 1;

      if (error.errorType === 'request_timeout') {
        update['$inc']['warnings.E_RESOURCE_TIMEOUT'] = 1;
        update['$push'] = update['$push'] || {};
        update['$push'].lastWarnings = {
          $each: [{ errType: 'E_RESOURCE_TIMEOUT' }],
          $slice: -10
        };
      } else if (error.errorType === 'host_not_found') {
        update['$inc']['warnings.E_DOMAIN_NOT_FOUND'] = 1;
        update['$push'] = update['$push'] || {};
        update['$push'].lastWarnings = {
          $each: [{ errType: 'E_DOMAIN_NOT_FOUND' }],
          $slice: -10
        };
      } else if (
        error.errorType === 'connection_reset' ||
        error.errorType === 'too_many_redirects' ||
        error.errorType === 'unsupported_mime_type'
      ) {
        update['$inc']['warnings.E_RESOURCE_ISSUE'] = 1;
        update['$push'] = update['$push'] || {};
        update['$push'].lastWarnings = {
          $each: [{ errType: 'E_RESOURCE_ISSUE' }],
          $slice: -10
        };
      } else {
        update['$inc']['warnings.E_UNKNOWN'] = 1;
        update['$push'] = update['$push'] || {};
        update['$push'].lastWarnings = {
          $each: [{ errType: 'E_UNKNOWN' }],
          $slice: -10
        };
      }
    } else {
      update['$inc'] = update['$inc'] || {};
      update['$inc']['crawl.success'] = 1;
    }

    const d = await Domain.findOneAndUpdate(baseFilter, update, { returnDocument: 'after' })!;
    return {
      domain: await Domain.setNextCrawlAllowed(url, jobResult.details.ts, d!.crawl.delay)
    };
  }

  public static async insertSeeds(
    this: ReturnModelType<typeof ResourceClass>,
    urls: string[],
    pid: string
  ) {
    const upserts = urls.map((u: string) => ({
      updateOne: {
        filter: { url: u },
        update: {
          $setOnInsert: {
            url: u,
            domain: new URL(u).origin
          }
        },
        upsert: true,
        setDefaultsOnInsert: true
      }
    }));

    const res = await this.bulkWrite(upserts);
    const domains = new Set<string>(urls.map((u: string) => new URL(u).origin));
    await Domain.upsertMany(Array.from(domains));
    const seedResources = await this.find({ url: { $in: urls } }).select('url domain status');

    return this.insertSeedPaths(pid, seedResources);
  }

  /**
   * Inserts seed paths for a given process ID and an array of seed resources, creating either traversal or endpoint paths based on the configuration.
   * @param pid - The process ID to associate with the seed paths.
   * @param seeds - An array of ResourceDocument objects representing the seed resources.
   * @returns An object containing the results of the path insertions and related updates.
   */
  public static async insertSeedPaths(
    this: ReturnModelType<typeof ResourceClass>,
    pid: string,
    seeds: ResourceDocument[]
  ) {
    // Traversal paths
    if (config.manager.pathType === PathType.TRAVERSAL) {
      const paths = seeds.map((s) => ({
        processId: pid,
        seed: { url: s.url },
        head: {
          url: s.url,
          status: s.status,
          type: HEAD_TYPE.URL,
          domain: s.domain
        },
        status: 'active',
        nodes: {
          elems: [s.url],
          count: 1
        },
        predicates: {
          elems: [],
          count: 0
        },
        triples: []
      }));

      const insPaths = await TraversalPath.create(paths);
      return this.addTvPaths(insPaths);
    }
    // Endpoint paths
    else {
      try {
        const bulkOps = seeds.map((s) => ({
          updateOne: {
            filter: {
              processId: pid,
              'head.type': HEAD_TYPE.URL,
              'head.url': s.url
            },
            update: {
              $setOnInsert: {
                processId: pid,
                head: {
                  type: HEAD_TYPE.URL,
                  url: s.url,
                  status: s.status,
                  domain: s.domain
                },
                status: 'active' as const,
                shortestPathLength: 1,
                seedPaths: [{ seed: s.url, minLength: 1 }]
              }
            },
            upsert: true
          }
        }));

        let result;
        try {
          log.warn('Attempting to insert/update EndpointPath seeds with bulkWrite', JSON.stringify({ bulkOps }));
          result = await EndpointPath.bulkWrite(bulkOps as any, { ordered: false });
          log.silly('Inserted/updated EndpointPath seeds', { upsertedCount: result.upsertedCount });

          // Check for validation errors in result (Mongoose includes them even when not thrown)
          if ((result as any).mongoose?.validationErrors?.length) {
            log.error('BulkWrite result contains validation errors!', {
              validationErrors: (result as any).mongoose.validationErrors
            });
          }
        } catch (error: any) {
          if (error.code !== 11000) {
            log.error('Failed to upsert EndpointPath seed documents', {
              error,
              seedUrls: seeds.map((s) => s.url)
            });
            throw error;
          }
          log.warn('Duplicate key error on EndpointPath seeds, recovering partial results', {
            seedUrls: seeds.map((s) => s.url)
          });
          result = error.result;
        }

        const insertedIndices = new Set<number>();
        if (result.upsertedIds) {
          for (const key of Object.keys(result.upsertedIds)) {
            insertedIndices.add(Number(key));
          }
        }

        const domainCounts = new Map<string, number>();
        bulkOps.forEach((_op, idx) => {
          if (insertedIndices.has(idx)) {
            const s = seeds[idx];
            domainCounts.set(s.domain, (domainCounts.get(s.domain) || 0) + 1);
          }
        });

        let domainOps: any[] = [];
        if (domainCounts.size > 0) {
          domainOps = Array.from(domainCounts.entries()).map(([origin, count]) => ({
            updateOne: {
              filter: { origin },
              update: { $inc: { 'crawl.pathHeads': count } }
            }
          }));
          await Domain.bulkWrite(domainOps);
        }

        return { ep: result, dom: { modifiedCount: domainOps.length } };
      } catch (error) {
        log.error('Failed to insert EndpointPath seed documents', {
          error,
          seedUrls: seeds.map((s) => s.url)
        });
        throw error;
      }
    }
  }

  /**
   * Adds endpoint paths to the related domains, updating their crawl statistics.
   * @param paths - An array of EndpointPathDocument objects to add to the domains.
   * @returns An object containing the results of the domain updates.
   **/
  public static async addEpPaths(
    this: ReturnModelType<typeof ResourceClass>,
    paths: EndpointPathClass[]
  ) {
    const urlPaths = paths.filter((p) => p.head.type === HEAD_TYPE.URL) as (EndpointPathClass & {
      head: UrlHead;
    })[];
    if (!urlPaths.length) {
      return { dom: null };
    }

    const dom = await Domain.bulkWrite(
      urlPaths.map((p) => ({
        updateOne: {
          filter: { origin: p.head.domain.origin },
          update: { $inc: { 'crawl.pathHeads': 1 } }
        }
      }))
    );
    return { dom };
  }

  /**
   * Adds traversal paths to the resources, updating their head counts and minimum path lengths.
   * Also updates the related domain crawl statistics.
   * @param paths - An array of TraversalPathDocument objects to add to the resources.
   * @returns An object containing the results of the resource and domain updates.
   */
  public static async addTvPaths(
    this: ReturnModelType<typeof ResourceClass>,
    paths: TraversalPathDocument[]
  ) {
    const urlPaths = paths.filter(
      (p) => p.head.type === HEAD_TYPE.URL
    ) as (TraversalPathDocument & { head: UrlHead })[];

    if (!urlPaths.length) {
      return { res: null, dom: null };
    }

    const res = await this.bulkWrite(
      urlPaths.map((p) => ({
        updateOne: {
          filter: { url: p.head.url },
          update: {
            $addToSet: { paths: p._id },
            $inc: { headCount: 1 },
            $min: {
              minPathLength: p.nodes.count
            }
          }
        }
      }))
    );
    const dom = await Domain.bulkWrite(
      urlPaths.map((p) => ({
        updateOne: {
          filter: { origin: p.head.domain },
          update: { $inc: { 'crawl.pathHeads': 1 } }
        }
      }))
    );
    return { res, dom };
  }

  public static async getUnvisited(
    this: ReturnModelType<typeof ResourceClass>,
    domain: string,
    exclude: string[],
    limit: number
  ) {
    return await Resource.find({
      domain,
      status: 'unvisited',
      url: { $nin: exclude }
    })
      .limit(limit - exclude.length)
      .select('url')
      .lean();
  }
}

const Resource = getModelForClass(ResourceClass, {
  schemaOptions: { timestamps: true, collection: 'resources' }
});
type ResourceDocument = ResourceClass & Document;

export { Resource, ResourceClass, type ResourceDocument };
