import { describe, it, expect } from 'vitest';
import { genTraversalPathQuery } from './process-paths';
import { StepClass, PredicateLimitationClass } from './aux-classes';

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
    } as any;
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
    it('returns $or query with predicates.count < maxPathProps OR predicates.count == maxPathProps with whitelist predicate', () => {
      const predLimit = new PredicateLimitationClass();
      predLimit.limType = 'whitelist';
      predLimit.limPredicates = ['http://pred1.org', 'http://pred2.org'];

      const process = createMockProcess({
        maxPathLength: 4,
        maxPathProps: 2,
        predLimit,
      });

      const query = genTraversalPathQuery(process);

      expect(query.processId).toBe('test-pid');
      expect(query.status).toBe('active');
      expect(query['nodes.count']).toEqual({ $lt: 4 });
      expect(query.$or).toBeDefined();
      expect(query.$or).toHaveLength(2);
    });

    it('uses $in for multiple whitelist predicates', () => {
      const predLimit = new PredicateLimitationClass();
      predLimit.limType = 'whitelist';
      predLimit.limPredicates = ['http://pred1.org', 'http://pred2.org'];

      const process = createMockProcess({
        maxPathProps: 2,
        predLimit,
      });

      const query = genTraversalPathQuery(process) as any;

      const maxPropsClause = query.$or.find((clause: any) => clause['predicates.count'] === 2);
      expect(maxPropsClause['predicates.elems']).toEqual({ $in: ['http://pred1.org', 'http://pred2.org'] });
    });

    it('uses direct equality for single whitelist predicate', () => {
      const predLimit = new PredicateLimitationClass();
      predLimit.limType = 'whitelist';
      predLimit.limPredicates = ['http://only-one.org'];

      const process = createMockProcess({
        maxPathProps: 2,
        predLimit,
      });

      const query = genTraversalPathQuery(process) as any;

      const maxPropsClause = query.$or.find((clause: any) => clause['predicates.count'] === 2);
      expect(maxPropsClause['predicates.elems']).toBe('http://only-one.org');
    });

    it('includes clause for paths with count < maxPathProps', () => {
      const predLimit = new PredicateLimitationClass();
      predLimit.limType = 'whitelist';
      predLimit.limPredicates = ['http://pred1.org'];

      const process = createMockProcess({
        maxPathProps: 2,
        predLimit,
      });

      const query = genTraversalPathQuery(process) as any;

      const lessThanClause = query.$or.find((clause: any) => clause['predicates.count']?.$lt);
      expect(lessThanClause).toBeDefined();
      expect(lessThanClause['predicates.count']).toEqual({ $lt: 2 });
    });
  });

  describe('when there is a blacklist predicate limit', () => {
    it('returns $or query with predicates.count == maxPathProps OR predicates.count <= maxPathProps with $expr $not $setIsSubset', () => {
      const predLimit = new PredicateLimitationClass();
      predLimit.limType = 'blacklist';
      predLimit.limPredicates = ['http://blocked1.org', 'http://blocked2.org'];

      const process = createMockProcess({
        maxPathLength: 4,
        maxPathProps: 2,
        predLimit,
      });

      const query = genTraversalPathQuery(process);

      expect(query.processId).toBe('test-pid');
      expect(query.status).toBe('active');
      expect(query['nodes.count']).toEqual({ $lt: 4 });
      expect(query.$or).toBeDefined();
      expect(query.$or).toHaveLength(2);
    });

    it('uses $ne for single blacklist predicate', () => {
      const predLimit = new PredicateLimitationClass();
      predLimit.limType = 'blacklist';
      predLimit.limPredicates = ['http://blocked.org'];

      const process = createMockProcess({
        maxPathProps: 2,
        predLimit,
      });

      const query = genTraversalPathQuery(process) as any;

      const withPredClause = query.$or.find((clause: any) => clause['predicates.elems']);
      expect(withPredClause['predicates.elems']).toEqual({ $ne: 'http://blocked.org' });
    });

    it('uses $expr $not $setIsSubset for multiple blacklist predicates', () => {
      const predLimit = new PredicateLimitationClass();
      predLimit.limType = 'blacklist';
      predLimit.limPredicates = ['http://blocked1.org', 'http://blocked2.org'];

      const process = createMockProcess({
        maxPathProps: 2,
        predLimit,
      });

      const query = genTraversalPathQuery(process) as any;

      const withPredClause = query.$or.find((clause: any) => clause.$expr);
      expect(withPredClause.$expr).toBeDefined();
      expect(withPredClause.$expr.$not).toBeDefined();
      expect(withPredClause.$expr.$not.$setIsSubset).toEqual(['$predicates.elems', ['http://blocked1.org', 'http://blocked2.org']]);
    });

    it('uses $lte for blacklist paths count (not $lt like whitelist)', () => {
      const predLimit = new PredicateLimitationClass();
      predLimit.limType = 'blacklist';
      predLimit.limPredicates = ['http://blocked.org'];

      const process = createMockProcess({
        maxPathProps: 2,
        predLimit,
      });

      const query = genTraversalPathQuery(process) as any;

      const withPredClause = query.$or.find((clause: any) => clause['predicates.count']?.$lte);
      expect(withPredClause).toBeDefined();
      expect(withPredClause['predicates.count']).toEqual({ $lte: 2 });
    });
  });

  describe('edge cases', () => {
    it('handles empty limPredicates array for blacklist', () => {
      const predLimit = new PredicateLimitationClass();
      predLimit.limType = 'blacklist';
      predLimit.limPredicates = [];

      const process = createMockProcess({
        maxPathProps: 2,
        predLimit,
      });

      const query = genTraversalPathQuery(process) as any;

      // With empty blacklist, should match all (setIsSubset with empty array is always true)
      const withPredClause = query.$or.find((clause: any) => clause.$expr);
      expect(withPredClause.$expr.$not.$setIsSubset).toEqual(['$predicates.elems', []]);
    });

    it('handles empty limPredicates array for whitelist', () => {
      const predLimit = new PredicateLimitationClass();
      predLimit.limType = 'whitelist';
      predLimit.limPredicates = [];

      const process = createMockProcess({
        maxPathProps: 2,
        predLimit,
      });

      const query = genTraversalPathQuery(process) as any;

      expect(query.$or).toBeDefined();
      expect(query.$or).toHaveLength(2);
      const lessThanClause = query.$or.find((c: any) => c['predicates.count']?.$lt);
      expect(lessThanClause['predicates.count']).toEqual({ $lt: 2 });
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
