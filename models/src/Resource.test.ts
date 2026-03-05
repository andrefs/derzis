import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Resource } from './Resource';
import { EndpointPath } from './Path/EndpointPath';
import { TraversalPath } from './Path/TraversalPath';
import { PathType } from '@derzis/common';
import config from '@derzis/config';

describe('Resource.insertSeedPaths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset config pathType to default (endpoint)
    config.manager.pathType = PathType.ENDPOINT;
  });

  describe('EndpointPath', () => {
    beforeEach(() => {
      config.manager.pathType = PathType.ENDPOINT;
      vi.spyOn(EndpointPath, 'create').mockResolvedValue([]);
      vi.spyOn(Resource, 'addEpPaths').mockResolvedValue({ dom: null });
    });

    it('should call EndpointPath.create with correctly shaped documents', async () => {
      const seeds = [
        {
          url: 'http://example.com/seed1',
          domain: 'http://example.com',
          status: 'unvisited' as const
        }
      ];
      const pid = 'test-process';

      await (Resource as any).insertSeedPaths(pid, seeds);

      expect(EndpointPath.create).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            processId: pid,
            seed: { url: seeds[0].url },
            head: expect.objectContaining({
              url: seeds[0].url,
              status: seeds[0].status,
              domain: seeds[0].domain
            }),
            status: 'active',
            frontier: true,
            shortestPath: expect.objectContaining({
              length: 1,
              seed: seeds[0].url
            }),
            seedPaths: expect.objectContaining({
              [seeds[0].url]: 1
            })
          })
        ])
      );
    });

    it('should set head.domain as a string, not an object', async () => {
      const seeds = [
        {
          url: 'http://dbpedia.org/resource/Cheese',
          domain: 'http://dbpedia.org',
          status: 'unvisited' as const
        }
      ];
      await (Resource as any).insertSeedPaths('pid', seeds);

      const passedDoc = (EndpointPath.create as any).mock.calls[0][0][0];
      expect(typeof passedDoc.head.domain).toBe('string');
      expect(passedDoc.head.domain).toBe('http://dbpedia.org');
    });

    it('should set shortestPath with seed (string) not seeds (array)', async () => {
      const seeds = [
        {
          url: 'http://example.com/seed',
          domain: 'http://example.com',
          status: 'unvisited' as const
        }
      ];
      await (Resource as any).insertSeedPaths('pid', seeds);

      const passedDoc = (EndpointPath.create as any).mock.calls[0][0][0];
      expect(passedDoc.shortestPath).toHaveProperty('seed');
      expect(passedDoc.shortestPath.seed).toBe(seeds[0].url);
      expect(passedDoc.shortestPath).not.toHaveProperty('seeds');
    });

     it('should not have minPath property', async () => {
       const seeds = [
         {
           url: 'http://example.com/seed',
           domain: 'http://example.com',
           status: 'unvisited' as const
         }
       ];
       await (Resource as any).insertSeedPaths('pid', seeds);

       const passedDoc = (EndpointPath.create as any).mock.calls[0][0][0];
       expect(passedDoc).not.toHaveProperty('minPath');
     });

     it('should set shortestPathLength to 1 for seed paths', async () => {
       const seeds = [
         {
           url: 'http://example.com/seed',
           domain: 'http://example.com',
           status: 'unvisited' as const
         }
       ];
       await (Resource as any).insertSeedPaths('pid', seeds);

       const passedDoc = (EndpointPath.create as any).mock.calls[0][0][0];
       expect(passedDoc.shortestPathLength).toBe(1);
     });
   });

  describe('TraversalPath', () => {
    beforeEach(() => {
      config.manager.pathType = PathType.TRAVERSAL;
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
              domain: seeds[0].domain
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

    it('should include head.domain as string for TraversalPath', async () => {
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
      expect(typeof passedDoc.head.domain).toBe('string');
      expect(passedDoc.head.domain).toBe('http://example.com');
    });

    it('should include full nodes structure with elems and count', async () => {
      const seeds = [
        {
          url: 'http://example.com/seed',
          domain: 'http://example.com',
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
          domain: 'http://example.com',
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
          domain: 'http://example.com',
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
