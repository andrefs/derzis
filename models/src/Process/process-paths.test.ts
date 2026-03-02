import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  genTraversalPathQuery,
  hasPathsDomainRobotsChecking,
  hasPathsHeadBeingCrawled
} from './process-paths';
import { StepClass, PredicateLimitationClass } from './aux-classes';
import { QueryFilter } from 'mongoose';
import type { TraversalPathDocument } from '../Path/TraversalPath';
import type { ProcessClass } from './Process';
import { Path, HEAD_TYPE } from '../Path/Path';
import { Domain } from '../Domain';

type TraversalPathQueryWithExpr = QueryFilter<TraversalPathDocument> & {
  $expr: {
    $not: {
      $setIsSubset: unknown[];
    };
  };
};

describe('genTraversalPathQuery', () => {
  const createMockProcess = (overrides: {
    pid?: string;
    maxPathLength?: number;
    maxPathProps?: number;
    predLimit?: PredicateLimitationClass;
  }) => {
    const step = new StepClass();
    step.maxPathLength = overrides.maxPathLength ?? 4;
    step.maxPathProps = overrides.maxPathProps ?? 1;
    if (overrides.predLimit !== undefined) {
      step.predLimit = overrides.predLimit;
    }
    step.seeds = [];
    step.followDirection = false;
    step.resetErrors = false;

    return {
      pid: overrides.pid ?? 'test-pid',
      currentStep: step,
    } as ProcessClass;
  };

  describe('when there is no predicate limit', () => {
    it('returns base query with predicates.count <= maxPathProps', () => {
      const process = createMockProcess({
        pid: 'test-pid',
        maxPathLength: 4,
        maxPathProps: 1,
        predLimit: undefined,
      });

      const query = genTraversalPathQuery(process);

      expect(query).toEqual({
        processId: 'test-pid',
        status: 'active',
        'head.type': 'url',
        'nodes.count': { $lt: 4 },
        'predicates.count': { $lte: 1 },
      });
    });

    it('handles different maxPathProps values', () => {
      const process = createMockProcess({
        maxPathLength: 5,
        maxPathProps: 3,
        predLimit: undefined,
      });

      const query = genTraversalPathQuery(process);

      expect(query['predicates.count']).toEqual({ $lte: 3 });
    });
  });

  describe('when there is a whitelist predicate limit', () => {
    it('returns query with predicates.elems $in and predicates.count $lte', () => {
      const predLimit = new PredicateLimitationClass();
      predLimit.limType = 'whitelist';
      predLimit.limPredicates = ['http://pred1.org', 'http://pred2.org'];

      const process = createMockProcess({
        maxPathProps: 2,
        predLimit,
      });

      const query = genTraversalPathQuery(process) as TraversalPathQueryWithExpr;

      expect(query['predicates.elems']).toEqual({ $in: ['http://pred1.org', 'http://pred2.org'] });
      expect(query['predicates.count']).toEqual({ $lte: 2 });
    });

    it('uses direct equality for single whitelist predicate', () => {
      const predLimit = new PredicateLimitationClass();
      predLimit.limType = 'whitelist';
      predLimit.limPredicates = ['http://only-one.org'];

      const process = createMockProcess({
        maxPathProps: 2,
        predLimit,
      });

      const query = genTraversalPathQuery(process) as TraversalPathQueryWithExpr;

      expect(query['predicates.elems']).toBe('http://only-one.org');
      expect(query['predicates.count']).toEqual({ $lte: 2 });
    });

    it('applies predicate filter and count limit at top level (no $or)', () => {
      const predLimit = new PredicateLimitationClass();
      predLimit.limType = 'whitelist';
      predLimit.limPredicates = ['http://pred1.org'];

      const process = createMockProcess({
        maxPathProps: 2,
        predLimit,
      });

      const query = genTraversalPathQuery(process) as TraversalPathQueryWithExpr;

      expect(query.$or).toBeUndefined();
      expect(query['predicates.elems']).toEqual('http://pred1.org');
      expect(query['predicates.count']).toEqual({ $lte: 2 });
    });
  });

  describe('when there is a blacklist predicate limit', () => {
    it('returns query with $expr $not $setIsSubset and predicates.count $lte', () => {
      const predLimit = new PredicateLimitationClass();
      predLimit.limType = 'blacklist';
      predLimit.limPredicates = ['http://blocked1.org', 'http://blocked2.org'];

      const process = createMockProcess({
        maxPathLength: 4,
        maxPathProps: 2,
        predLimit,
      });

      const query = genTraversalPathQuery(process) as TraversalPathQueryWithExpr;

      expect(query.processId).toBe('test-pid');
      expect(query.status).toBe('active');
      expect(query['nodes.count']).toEqual({ $lt: 4 });
      expect(query['predicates.count']).toEqual({ $lte: 2 });
      expect(query.$expr).toBeDefined();
      expect(query.$expr.$not).toBeDefined();
      expect(query.$expr.$not.$setIsSubset).toEqual(['$predicates.elems', ['http://blocked1.org', 'http://blocked2.org']]);
    });

    it('uses $ne for single blacklist predicate', () => {
      const predLimit = new PredicateLimitationClass();
      predLimit.limType = 'blacklist';
      predLimit.limPredicates = ['http://blocked.org'];

      const process = createMockProcess({
        maxPathProps: 2,
        predLimit,
      });

      const query = genTraversalPathQuery(process) as TraversalPathQueryWithExpr;

      expect(query['predicates.elems']).toEqual({ $ne: 'http://blocked.org' });
      expect(query['predicates.count']).toEqual({ $lte: 2 });
    });

    it('applies predicate filter and count limit at top level (no $or)', () => {
      const predLimit = new PredicateLimitationClass();
      predLimit.limType = 'blacklist';
      predLimit.limPredicates = ['http://blocked1.org', 'http://blocked2.org'];

      const process = createMockProcess({
        maxPathProps: 2,
        predLimit,
      });

      const query = genTraversalPathQuery(process) as TraversalPathQueryWithExpr;

      expect(query.$or).toBeUndefined();
      expect(query.$expr).toBeDefined();
      expect(query['predicates.count']).toEqual({ $lte: 2 });
    });
  });

  describe('edge cases', () => {
    it('handles empty limPredicates array for blacklist - no filter added', () => {
      const predLimit = new PredicateLimitationClass();
      predLimit.limType = 'blacklist';
      predLimit.limPredicates = [];

      const process = createMockProcess({
        maxPathProps: 2,
        predLimit,
      });

      const query = genTraversalPathQuery(process);

      // With empty blacklist, no predicates are blocked - no filter should be added
      expect(query['predicates.elems']).toBeUndefined();
      expect(query.$expr).toBeUndefined();
    });

    it('handles empty limPredicates array for whitelist - matches nothing', () => {
      const predLimit = new PredicateLimitationClass();
      predLimit.limType = 'whitelist';
      predLimit.limPredicates = [];

      const process = createMockProcess({
        maxPathProps: 2,
        predLimit,
      });

      const query = genTraversalPathQuery(process);

      // With empty whitelist, $in: [] matches nothing
      expect(query['predicates.elems']).toEqual({ $in: [] });
    });

    it('includes processId in all queries', () => {
      const process = createMockProcess({ pid: 'unique-pid-123' });

      const query = genTraversalPathQuery(process);

      expect(query.processId).toBe('unique-pid-123');
    });

    it('uses correct nodes.count based on maxPathLength', () => {
      const process = createMockProcess({ maxPathLength: 10 });

      const query = genTraversalPathQuery(process);

      expect(query['nodes.count']).toEqual({ $lt: 10 });
    });
  });

  describe('hasPathsDomainRobotsChecking', () => {
    const mockDomains = [{ origin: 'http://example.com' }, { origin: 'http://test.com' }];
    const mockProcess = (
      pid: string = 'test-pid',
      pathType: 'traversal' | 'endpoint' = 'traversal'
    ): ProcessClass => ({
      pid,
      config: { manager: { pathType } },
    });

    beforeEach(() => {
      Domain.find.mockResolvedValue(mockDomains);
      vi.clearAllMocks();
    });

    it('returns true when endpoint paths match domain filter', async () => {
      const process = mockProcess('pid-1', 'endpoint');
      Path.countDocuments.mockResolvedValueOnce(5);

      const result = await hasPathsDomainRobotsChecking(process);
      expect(result).toBe(true);
      expect(Path.countDocuments).toHaveBeenCalledWith({
        processId: 'pid-1',
        status: 'active',
        'head.type': 'url',
        'head.domain': { $in: mockDomains.map(d => d.origin) },
      });
    });

    it('returns true when traversal paths match domain filter', async () => {
      const process = mockProcess('pid-2', 'traversal');
      Path.countDocuments.mockResolvedValueOnce(3);

      const result = await hasPathsDomainRobotsChecking(process);
      expect(result).toBe(true);
    });

    it('returns false when no paths match domain filter', async () => {
      const process = mockProcess('pid-3', 'endpoint');
      Path.countDocuments.mockResolvedValueOnce(0);

      const result = await hasPathsDomainRobotsChecking(process);
      expect(result).toBe(false);
    });

    it('returns false when no domains are checking (early return)', async () => {
      Domain.find.mockResolvedValue([]);
      const process = mockProcess('pid-4', 'traversal');

      const result = await hasPathsDomainRobotsChecking(process);
      expect(result).toBe(false);
      expect(Path.countDocuments).not.toHaveBeenCalled();
    });
  });

  describe('hasPathsHeadBeingCrawled', () => {
    const mockCrawlingDomains = [{ origin: 'http://crawling1.com' }, { origin: 'http://crawling2.com' }];
    const mockProcess = (
      pid: string = 'test-pid',
      pathType: 'traversal' | 'endpoint' = 'traversal'
    ): ProcessClass => ({
      pid,
      config: { manager: { pathType } },
    });

    beforeEach(() => {
      Domain.find.mockResolvedValue(mockCrawlingDomains);
      vi.clearAllMocks();
    });

    it('returns true when endpoint paths have head in crawling domains', async () => {
      const process = mockProcess('pid-1', 'endpoint');
      Path.countDocuments.mockResolvedValueOnce(2);

      const result = await hasPathsHeadBeingCrawled(process);
      expect(result).toBe(true);
      expect(Path.countDocuments).toHaveBeenCalledWith({
        processId: 'pid-1',
        status: 'active',
        'head.type': HEAD_TYPE.URL,
        'head.domain': { $in: mockCrawlingDomains.map(d => d.origin) },
      });
    });

    it('returns true when traversal paths have head in crawling domains', async () => {
      const process = mockProcess('pid-2', 'traversal');
      Path.countDocuments.mockResolvedValueOnce(1);

      const result = await hasPathsHeadBeingCrawled(process);
      expect(result).toBe(true);
      expect(Path.countDocuments).toHaveBeenCalledWith({
        processId: 'pid-2',
        status: 'active',
        'head.type': HEAD_TYPE.URL,
        'head.domain': { $in: mockCrawlingDomains.map(d => d.origin) },
      });
    });

    it('returns false when no paths have head in crawling domains', async () => {
      const process = mockProcess('pid-3', 'endpoint');
      Path.countDocuments.mockResolvedValueOnce(0);

      const result = await hasPathsHeadBeingCrawled(process);
      expect(result).toBe(false);
    });

    it('returns false when no domains are crawling (early return)', async () => {
      Domain.find.mockResolvedValue([]);
      const process = mockProcess('pid-4', 'traversal');

      const result = await hasPathsHeadBeingCrawled(process);
      expect(result).toBe(false);
      expect(Path.countDocuments).not.toHaveBeenCalled();
    });
  });
});
});
