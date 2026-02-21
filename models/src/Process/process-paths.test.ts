import { describe, it, expect } from 'vitest';
import { genTraversalPathQuery } from './process-paths';
import { StepClass, PredicateLimitationClass } from './aux-classes';
import { QueryFilter } from 'mongoose';
import type { TraversalPathDocument } from '../Path/TraversalPath';
import type { ProcessClass } from './Process';

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
});
