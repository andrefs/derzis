import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Resource } from './Resource';
import { EndpointPath } from './Path/EndpointPath';
import { TraversalPath } from './Path/TraversalPath';
import { Domain } from './Domain';
import { Process } from './Process';
import { PathType } from '@derzis/common';
import config from '@derzis/config';

vi.mock('./Process', () => ({
  Process: {
    findOne: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({ curPathType: 'endpoint' })
      })
    })
  }
}));

describe('Resource.insertSeedPaths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset config pathType to default (endpoint)
    config.manager.pathType = PathType.ENDPOINT;
  });

  describe('EndpointPath', () => {
    beforeEach(() => {
      config.manager.pathType = PathType.ENDPOINT;
      vi.spyOn(Process, 'findOne').mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue({ curPathType: PathType.ENDPOINT })
        })
      } as any);
      vi.spyOn(EndpointPath, 'bulkWrite').mockResolvedValue({
        result: {},
        insertedCount: 0,
        matchedCount: 0,
        modifiedCount: 0,
        deletedCount: 0,
        upsertedCount: 1,
        upsertedIds: new Map()
      } as any);
      vi.spyOn(Domain, 'bulkWrite').mockResolvedValue({ modifiedCount: 1 } as any);
    });

    it('should call EndpointPath.bulkWrite with upsert operations', async () => {
      const seeds = [
        {
          url: 'http://example.com/seed1',
          domain: 'http://example.com',
          status: 'unvisited' as const
        }
      ];
      const pid = 'test-process';

      await (Resource as any).insertSeedPaths(pid, seeds);

      expect(EndpointPath.bulkWrite).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            updateOne: expect.objectContaining({
              filter: expect.objectContaining({
                processId: pid,
                'head.type': 'url',
                'head.url': seeds[0].url
              }),
              update: expect.objectContaining({
                $setOnInsert: expect.objectContaining({
                  processId: pid,
                  head: expect.objectContaining({
                    type: 'url',
                    url: seeds[0].url,
                    status: seeds[0].status,
                    domain: { origin: 'http://example.com', isUnvisited: true }
                  }),
                  status: 'active',
                  shortestPathLength: 1,
                  seedPaths: expect.arrayContaining([
                    expect.objectContaining({
                      seed: seeds[0].url,
                      minLength: 1
                    })
                  ])
                })
              }),
              upsert: true
            })
          })
        ]),
        { ordered: false }
      );
    });

    it('should set head.domain as an object with origin property', async () => {
      const seeds = [
        {
          url: 'http://dbpedia.org/resource/Cheese',
          domain: 'http://dbpedia.org',
          status: 'unvisited' as const
        }
      ];
      await (Resource as any).insertSeedPaths('pid', seeds);

      const ops = (EndpointPath.bulkWrite as any).mock.calls[0][0];
      const update = ops[0].updateOne.update.$setOnInsert;
      expect(update.head.domain).toEqual({ origin: 'http://dbpedia.org', isUnvisited: true });
    });

    it('should set seedPaths with seed property', async () => {
      const seeds = [
        {
          url: 'http://example.com/seed',
          domain: { origin: 'http://example.com', isUnvisited: true },
          status: 'unvisited' as const
        }
      ];
      await (Resource as any).insertSeedPaths('pid', seeds);

      const ops = (EndpointPath.bulkWrite as any).mock.calls[0][0];
      const update = ops[0].updateOne.update.$setOnInsert;
      expect(update.seedPaths).toHaveLength(1);
      expect(update.seedPaths[0].seed).toBe(seeds[0].url);
      expect(update.seedPaths[0].minLength).toBe(1);
    });

    it('should not have minPath property', async () => {
      const seeds = [
        {
          url: 'http://example.com/seed',
          domain: { origin: 'http://example.com', isUnvisited: true },
          status: 'unvisited' as const
        }
      ];
      await (Resource as any).insertSeedPaths('pid', seeds);

      const ops = (EndpointPath.bulkWrite as any).mock.calls[0][0];
      const update = ops[0].updateOne.update.$setOnInsert;
      expect(update).not.toHaveProperty('minPath');
    });

    it('should set shortestPathLength to 1 for seed paths', async () => {
      const seeds = [
        {
          url: 'http://example.com/seed',
          domain: { origin: 'http://example.com', isUnvisited: true },
          status: 'unvisited' as const
        }
      ];
      await (Resource as any).insertSeedPaths('pid', seeds);

      const ops = (EndpointPath.bulkWrite as any).mock.calls[0][0];
      const update = ops[0].updateOne.update.$setOnInsert;
      expect(update.shortestPathLength).toBe(1);
    });
  });

  describe('TraversalPath', () => {
    beforeEach(() => {
      config.manager.pathType = PathType.TRAVERSAL;
      vi.spyOn(Process, 'findOne').mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue({ curPathType: PathType.TRAVERSAL })
        })
      } as any);
      vi.spyOn(TraversalPath, 'create').mockResolvedValue([]);
      vi.spyOn(Resource, 'addTvPaths').mockResolvedValue({ res: null, dom: null });
    });

    it('should call TraversalPath.create when pathType is traversal', async () => {
      const seeds = [
        {
          url: 'http://example.com/seed',
          domain: 'http://example.com',
          status: 'unvisited' as const
        }
      ];
      const pid = 'test-pid';

      await (Resource as any).insertSeedPaths(pid, seeds);

      expect(TraversalPath.create).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            processId: pid,
            seed: { url: seeds[0].url },
            head: expect.objectContaining({
              url: seeds[0].url,
              status: seeds[0].status,
              type: 'url',
              domain: { origin: 'http://example.com', isUnvisited: true }
            }),
            status: 'active',
            nodes: expect.objectContaining({
              elems: [seeds[0].url],
              count: 1
            }),
            predicates: expect.objectContaining({
              elems: [],
              count: 0
            }),
            triples: []
          })
        ])
      );
    });

    it('should include head.domain as object for TraversalPath', async () => {
      const seeds = [
        {
          url: 'http://example.com/seed',
          domain: 'http://example.com',
          status: 'unvisited' as const
        }
      ];
      await (Resource as any).insertSeedPaths('pid', seeds);

      const passedDoc = (TraversalPath.create as any).mock.calls[0][0][0];
      expect(passedDoc.head).toHaveProperty('domain');
      expect(passedDoc.head.domain).toEqual({ origin: 'http://example.com', isUnvisited: true });
    });

    it('should include full nodes structure with elems and count', async () => {
      const seeds = [
        {
          url: 'http://example.com/seed',
          domain: { origin: 'http://example.com', isUnvisited: true },
          status: 'unvisited' as const
        }
      ];
      await (Resource as any).insertSeedPaths('pid', seeds);

      const passedDoc = (TraversalPath.create as any).mock.calls[0][0][0];
      expect(passedDoc.nodes).toEqual({
        elems: [seeds[0].url],
        count: 1
      });
    });

    it('should include full predicates structure with elems and count', async () => {
      const seeds = [
        {
          url: 'http://example.com/seed',
          domain: { origin: 'http://example.com', isUnvisited: true },
          status: 'unvisited' as const
        }
      ];
      await (Resource as any).insertSeedPaths('pid', seeds);

      const passedDoc = (TraversalPath.create as any).mock.calls[0][0][0];
      expect(passedDoc.predicates).toEqual({
        elems: [],
        count: 0
      });
    });

    it('should include triples array', async () => {
      const seeds = [
        {
          url: 'http://example.com/seed',
          domain: { origin: 'http://example.com', isUnvisited: true },
          status: 'unvisited' as const
        }
      ];
      await (Resource as any).insertSeedPaths('pid', seeds);

      const passedDoc = (TraversalPath.create as any).mock.calls[0][0][0];
      expect(Array.isArray(passedDoc.triples)).toBe(true);
      expect(passedDoc.triples).toHaveLength(0);
    });
  });
});
