import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Resource } from './Resource';
import { EndpointPath } from './Path/EndpointPath';
import { TraversalPath } from './Path/TraversalPath';
import { Domain } from './Domain';
import { Process } from './Process';
import { PathType } from '@derzis/common';
import config from '@derzis/config';
import { createMockModel } from './test-utils/mockModel';

describe('Resource.insertSeedPaths', () => {
  describe('EndpointPath', () => {
    let mockProcess: ReturnType<typeof createMockModel<import('./Process').ProcessClass>>;
    let mockDomain: ReturnType<typeof createMockModel<import('./Domain').DomainClass>>;
    let mockEndpointPath: ReturnType<
      typeof createMockModel<import('./Path/EndpointPath').EndpointPathClass>
    >;

    beforeEach(() => {
      config.manager.pathType = PathType.ENDPOINT;

      // Mock Process.findOne
      mockProcess = createMockModel<import('./Process').ProcessClass>();
      const mockSelect = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({ curPathType: PathType.ENDPOINT })
      });
      mockProcess.findOne.mockReturnValue(mockSelect);
      vi.spyOn(Process, 'findOne').mockImplementation(mockProcess.findOne);

      // Mock Domain.find
      mockDomain = createMockModel<import('./Domain').DomainClass>();
      const mockDomainSelect = vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([
          { origin: 'http://example.com', status: 'unvisited' },
          { origin: 'http://dbpedia.org', status: 'unvisited' }
        ])
      });
      mockDomain.find.mockReturnValue(mockDomainSelect);
      vi.spyOn(Domain, 'find').mockImplementation(mockDomain.find);

      // Mock EndpointPath.bulkWrite
      mockEndpointPath = createMockModel<import('./Path/EndpointPath').EndpointPathClass>();
      mockEndpointPath.bulkWrite.mockResolvedValue({
        result: {},
        insertedCount: 0,
        matchedCount: 0,
        modifiedCount: 0,
        deletedCount: 0,
        upsertedCount: 1,
        upsertedIds: new Map()
      });
      vi.spyOn(EndpointPath, 'bulkWrite').mockImplementation(mockEndpointPath.bulkWrite);

      // Mock Domain.bulkWrite
      mockDomain.bulkWrite.mockResolvedValue({ modifiedCount: 1 });
      vi.spyOn(Domain, 'bulkWrite').mockImplementation(mockDomain.bulkWrite);
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

      await Resource.insertSeedPaths(pid, seeds);

      expect(mockEndpointPath.bulkWrite).toHaveBeenCalledWith(
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
      await Resource.insertSeedPaths('pid', seeds);

      const ops = mockEndpointPath.bulkWrite.mock.calls[0][0];
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
      await Resource.insertSeedPaths('pid', seeds);

      const ops = mockEndpointPath.bulkWrite.mock.calls[0][0];
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
      await Resource.insertSeedPaths('pid', seeds);

      const ops = mockEndpointPath.bulkWrite.mock.calls[0][0];
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
      await Resource.insertSeedPaths('pid', seeds);

      const ops = mockEndpointPath.bulkWrite.mock.calls[0][0];
      const update = ops[0].updateOne.update.$setOnInsert;
      expect(update.shortestPathLength).toBe(1);
    });
  });

  describe('TraversalPath', () => {
    let mockProcess: ReturnType<typeof createMockModel<import('./Process').ProcessClass>>;
    let mockDomain: ReturnType<typeof createMockModel<import('./Domain').DomainClass>>;
    let mockTraversalPath: ReturnType<
      typeof createMockModel<import('./Path/TraversalPath').TraversalPathClass>
    >;

    beforeEach(() => {
      config.manager.pathType = PathType.TRAVERSAL;

      // Mock Process.findOne
      mockProcess = createMockModel<import('./Process').ProcessClass>();
      const mockSelect = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({ curPathType: PathType.TRAVERSAL })
      });
      mockProcess.findOne.mockReturnValue(mockSelect);
      vi.spyOn(Process, 'findOne').mockImplementation(mockProcess.findOne);

      // Mock Domain.find
      mockDomain = createMockModel<import('./Domain').DomainClass>();
      const mockDomainSelect = vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([{ origin: 'http://example.com', status: 'unvisited' }])
      });
      mockDomain.find.mockReturnValue(mockDomainSelect);
      vi.spyOn(Domain, 'find').mockImplementation(mockDomain.find);

      // Mock TraversalPath.create
      mockTraversalPath = createMockModel<import('./Path/TraversalPath').TraversalPathClass>();
      mockTraversalPath.create.mockResolvedValue([]);
      vi.spyOn(TraversalPath, 'create').mockImplementation(mockTraversalPath.create);

      // Mock Resource.addTvPaths
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

      await Resource.insertSeedPaths(pid, seeds);

      expect(mockTraversalPath.create).toHaveBeenCalledWith(
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
      await Resource.insertSeedPaths('pid', seeds);

      const passedDoc = mockTraversalPath.create.mock.calls[0][0][0];
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
      await Resource.insertSeedPaths('pid', seeds);

      const passedDoc = mockTraversalPath.create.mock.calls[0][0][0];
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
      await Resource.insertSeedPaths('pid', seeds);

      const passedDoc = mockTraversalPath.create.mock.calls[0][0][0];
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
      await Resource.insertSeedPaths('pid', seeds);

      const passedDoc = mockTraversalPath.create.mock.calls[0][0][0];
      expect(Array.isArray(passedDoc.triples)).toBe(true);
      expect(passedDoc.triples).toHaveLength(0);
    });
  });
});
