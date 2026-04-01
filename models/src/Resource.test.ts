import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Resource } from './Resource';
import { EndpointPath } from './Path/EndpointPath';
import { TraversalPath } from './Path/TraversalPath';
import { Domain } from './Domain';
import { Process } from './Process';
import { PathType } from '@derzis/common';
import config from '@derzis/config';

describe('Resource.insertSeedPaths', () => {
  describe('EndpointPath', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockBulkWrite: any;

    beforeEach(() => {
      config.manager.pathType = PathType.ENDPOINT;

      // Mock Process.findOne
      vi.spyOn(Process, 'findOne').mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue({ curPathType: PathType.ENDPOINT })
        })
      } as any);

      // Mock Domain.find
      vi.spyOn(Domain, 'find').mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([
            { origin: 'http://example.com', status: 'unvisited' },
            { origin: 'http://dbpedia.org', status: 'unvisited' }
          ])
        })
      } as any);

      // Mock EndpointPath.bulkWrite
      mockBulkWrite = vi.fn().mockResolvedValue({
        result: {},
        insertedCount: 0,
        matchedCount: 0,
        modifiedCount: 0,
        deletedCount: 0,
        upsertedCount: 1,
        upsertedIds: new Map()
      });
      vi.spyOn(EndpointPath, 'bulkWrite').mockImplementation(mockBulkWrite as any);

      // Mock Domain.bulkWrite
      vi.spyOn(Domain, 'bulkWrite').mockResolvedValue({ modifiedCount: 1 } as any);
    });

    it('should call EndpointPath.bulkWrite with upsert operations', async () => {
      const seeds = [
        {
          url: 'http://example.com/seed1',
          domain: 'http://example.com',
          status: 'unvisited' as const,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];
      const pid = 'test-process';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- test data doesn't need full ResourceDocument
      await Resource.insertSeedPaths(pid, seeds as any);

      expect(mockBulkWrite).toHaveBeenCalledWith(
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
          status: 'unvisited' as const,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- test data doesn't need full ResourceDocument
      await Resource.insertSeedPaths('pid', seeds as any);

      const ops = mockBulkWrite.mock.calls[0][0];
      const update = ops[0].updateOne.update.$setOnInsert;
      expect(update.head.domain).toEqual({ origin: 'http://dbpedia.org', isUnvisited: true });
    });

    it('should set seedPaths with seed property', async () => {
      const seeds = [
        {
          url: 'http://example.com/seed',
          domain: { origin: 'http://example.com', isUnvisited: true },
          status: 'unvisited' as const,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- test data doesn't need full ResourceDocument
      await Resource.insertSeedPaths('pid', seeds as any);

      const ops = mockBulkWrite.mock.calls[0][0];
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
          status: 'unvisited' as const,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- test data doesn't need full ResourceDocument
      await Resource.insertSeedPaths('pid', seeds as any);

      const ops = mockBulkWrite.mock.calls[0][0];
      const update = ops[0].updateOne.update.$setOnInsert;
      expect(update).not.toHaveProperty('minPath');
    });

    it('should set shortestPathLength to 1 for seed paths', async () => {
      const seeds = [
        {
          url: 'http://example.com/seed',
          domain: { origin: 'http://example.com', isUnvisited: true },
          status: 'unvisited' as const,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- test data doesn't need full ResourceDocument
      await Resource.insertSeedPaths('pid', seeds as any);

      const ops = mockBulkWrite.mock.calls[0][0];
      const update = ops[0].updateOne.update.$setOnInsert;
      expect(update.shortestPathLength).toBe(1);
    });
  });

  describe('TraversalPath', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockCreate: any;

    beforeEach(() => {
      config.manager.pathType = PathType.TRAVERSAL;

      // Mock Process.findOne
      vi.spyOn(Process, 'findOne').mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue({ curPathType: PathType.TRAVERSAL })
        })
      } as any);

      // Mock Domain.find
      vi.spyOn(Domain, 'find').mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([{ origin: 'http://example.com', status: 'unvisited' }])
        })
      } as any);

      // Mock TraversalPath.create
      mockCreate = vi.fn().mockResolvedValue([]);
      vi.spyOn(TraversalPath, 'create').mockImplementation(mockCreate as any);

      // Mock Resource.addTvPaths
      vi.spyOn(Resource, 'addTvPaths').mockResolvedValue({ res: null, dom: null });
    });

    it('should call TraversalPath.create when pathType is traversal', async () => {
      const seeds = [
        {
          url: 'http://example.com/seed',
          domain: 'http://example.com',
          status: 'unvisited' as const,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];
      const pid = 'test-pid';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- test data doesn't need full ResourceDocument
      await Resource.insertSeedPaths(pid, seeds as any);

      expect(mockCreate).toHaveBeenCalledWith(
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
          status: 'unvisited' as const,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- test data doesn't need full ResourceDocument
      await Resource.insertSeedPaths('pid', seeds as any);

      const passedDoc = mockCreate.mock.calls[0][0][0];
      expect(passedDoc.head).toHaveProperty('domain');
      expect(passedDoc.head.domain).toEqual({ origin: 'http://example.com', isUnvisited: true });
    });

    it('should include full nodes structure with elems and count', async () => {
      const seeds = [
        {
          url: 'http://example.com/seed',
          domain: { origin: 'http://example.com', isUnvisited: true },
          status: 'unvisited' as const,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- test data doesn't need full ResourceDocument
      await Resource.insertSeedPaths('pid', seeds as any);

      const passedDoc = mockCreate.mock.calls[0][0][0];
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
          status: 'unvisited' as const,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- test data doesn't need full ResourceDocument
      await Resource.insertSeedPaths('pid', seeds as any);

      const passedDoc = mockCreate.mock.calls[0][0][0];
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
          status: 'unvisited' as const,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- test data doesn't need full ResourceDocument
      await Resource.insertSeedPaths('pid', seeds as any);

      const passedDoc = mockCreate.mock.calls[0][0][0];
      expect(Array.isArray(passedDoc.triples)).toBe(true);
      expect(passedDoc.triples).toHaveLength(0);
    });
  });
});
