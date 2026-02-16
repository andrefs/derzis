import { describe, it, expect } from 'vitest';
import { TraversalPathClass } from './TraversalPath';
import { StepClass, PredicateLimitationClass, BranchFactorClass, SeedPosRatioClass } from '../Process/aux-classes';

describe('TraversalPathClass.genExistingTriplesFilter', () => {
  const createMockPath = (overrides: {
    headUrl?: string;
    predicatesElems?: string[];
    triples?: any[];
    predicatesCount?: number;
  }) => {
    const path = new TraversalPathClass();
    path.processId = 'test-pid';
    path.status = 'active';
    path.seed = { url: 'http://example.com/seed' };
    path.head = { 
      url: overrides.headUrl ?? 'http://example.com/head',
      status: 'unvisited',
      domain: { origin: 'http://example.com', status: 'ready' }
    };
    path.predicates = {
      count: overrides.predicatesCount ?? overrides.predicatesElems?.length ?? 0,
      elems: overrides.predicatesElems ?? []
    };
    path.nodes = {
      count: 1,
      elems: ['http://example.com/node1']
    };
    path.triples = overrides.triples ?? [];
    return path;
  };

  const createMockProcess = (overrides: {
    maxPathProps?: number;
    limType?: 'whitelist' | 'blacklist';
    limPredicates?: string[];
    followDirection?: boolean;
    predsDirMetrics?: Map<string, { bf: BranchFactorClass; spr: SeedPosRatioClass }>;
  }) => {
    const step = new StepClass();
    step.maxPathLength = 4;
    step.maxPathProps = overrides.maxPathProps ?? 1;
    step.followDirection = overrides.followDirection ?? false;
    step.resetErrors = false;
    step.seeds = [];

    const predLimit = new PredicateLimitationClass();
    predLimit.limType = overrides.limType ?? 'blacklist';
    predLimit.limPredicates = overrides.limPredicates ?? [];
    step.predLimit = predLimit;

    const process: any = {
      pid: 'test-pid',
      currentStep: step,
      curPredsDirMetrics: () => overrides.predsDirMetrics
    };
    return process;
  };

  describe('when path is not full and no predicate limit', () => {
    it('returns filter allowing all predicates when limPredicates is empty', () => {
      const path = createMockPath({
        headUrl: 'http://example.com/head',
        predicatesElems: [],
        predicatesCount: 0
      });
      const process = createMockProcess({
        maxPathProps: 2,
        limType: 'blacklist',
        limPredicates: []
      });

      const filter = path.genExistingTriplesFilter(process);

      expect(filter).toBeDefined();
      expect(filter?.nodes).toBe('http://example.com/head');
      expect(filter?.predicate).toBeUndefined();
    });
  });

  describe('when path is not full and limType is whitelist', () => {
    it('returns filter with $in for allowed predicates', () => {
      const path = createMockPath({
        predicatesElems: [],
        predicatesCount: 0
      });
      const process = createMockProcess({
        maxPathProps: 2,
        limType: 'whitelist',
        limPredicates: ['http://pred1.org', 'http://pred2.org']
      });

      const filter = path.genExistingTriplesFilter(process);

      expect(filter).toBeDefined();
      expect(filter?.predicate).toEqual({ $in: ['http://pred1.org', 'http://pred2.org'] });
    });

    it('returns filter with direct equality for single predicate', () => {
      const path = createMockPath({
        predicatesElems: [],
        predicatesCount: 0
      });
      const process = createMockProcess({
        maxPathProps: 2,
        limType: 'whitelist',
        limPredicates: ['http://only-one.org']
      });

      const filter = path.genExistingTriplesFilter(process);

      expect(filter).toBeDefined();
      expect(filter?.predicate).toBe('http://only-one.org');
    });
  });

  describe('when path is not full and limType is blacklist', () => {
    it('returns filter with $nin for blocked predicates', () => {
      const path = createMockPath({
        predicatesElems: [],
        predicatesCount: 0
      });
      const process = createMockProcess({
        maxPathProps: 2,
        limType: 'blacklist',
        limPredicates: ['http://blocked1.org', 'http://blocked2.org']
      });

      const filter = path.genExistingTriplesFilter(process);

      expect(filter).toBeDefined();
      expect(filter?.predicate).toEqual({ $nin: ['http://blocked1.org', 'http://blocked2.org'] });
    });

    it('returns filter with $ne for single blocked predicate', () => {
      const path = createMockPath({
        predicatesElems: [],
        predicatesCount: 0
      });
      const process = createMockProcess({
        maxPathProps: 2,
        limType: 'blacklist',
        limPredicates: ['http://blocked.org']
      });

      const filter = path.genExistingTriplesFilter(process);

      expect(filter).toBeDefined();
      expect(filter?.predicate).toEqual({ $ne: 'http://blocked.org' });
    });
  });

  describe('when path is full and limType is whitelist', () => {
    it('returns filter with predicates that are in both path and whitelist', () => {
      const path = createMockPath({
        predicatesElems: ['http://pred1.org', 'http://pred2.org', 'http://pred3.org'],
        predicatesCount: 3
      });
      const process = createMockProcess({
        maxPathProps: 2,
        limType: 'whitelist',
        limPredicates: ['http://pred1.org', 'http://pred4.org']
      });

      const filter = path.genExistingTriplesFilter(process);

      expect(filter).toBeDefined();
      expect(filter?.predicate).toBe('http://pred1.org');
    });

    it('returns null when path is full and no path predicates are in whitelist', () => {
      const path = createMockPath({
        predicatesElems: ['http://pred2.org'],
        predicatesCount: 1
      });
      const process = createMockProcess({
        maxPathProps: 1,
        limType: 'whitelist',
        limPredicates: ['http://other.org']
      });

      const filter = path.genExistingTriplesFilter(process);

      expect(filter).toBeNull();
    });
  });

  describe('when path is full and limType is blacklist', () => {
    it('returns filter with predicates not in blacklist', () => {
      const path = createMockPath({
        predicatesElems: ['http://pred1.org', 'http://pred2.org'],
        predicatesCount: 2
      });
      const process = createMockProcess({
        maxPathProps: 2,
        limType: 'blacklist',
        limPredicates: ['http://pred1.org']
      });

      const filter = path.genExistingTriplesFilter(process);

      expect(filter).toBeDefined();
      expect(filter?.predicate).toBe('http://pred2.org');
    });

    it('returns filter with allowed predicate when path is full and blacklist has some blocked', () => {
      const path = createMockPath({ predicatesElems: ['p1'] });
      const result = path.genPredicatesFilter('blacklist', ['p2'], true);

      expect(result).not.toBeNull();
      expect(result?.predFilter).toEqual({ predicate: 'p1' });
    });

    it('returns null when path is full and blacklist has predicates', () => {
      const path = createMockPath({ predicatesElems: ['p1'] });
      const result = path.genPredicatesFilter('blacklist', ['p2'], true);

      expect(result).not.toBeNull();
      expect(result?.predFilter).toEqual({ predicate: 'p1' });
    });
  });

  describe('when followDirection is true', () => {
    it('returns combined baseFilter with directionFilter when direction filter is non-empty', () => {
      const path = createMockPath({
        headUrl: 'http://example.com/head',
        predicatesElems: ['http://pred.org'],
        predicatesCount: 1,
        triples: ['triple1', 'triple2']
      });

      const bf = new BranchFactorClass();
      bf.subj = 3;
      bf.obj = 1;

      const process = createMockProcess({
        maxPathProps: 2,
        limType: 'blacklist',
        limPredicates: [],
        followDirection: true,
        predsDirMetrics: new Map([['http://pred.org', { bf, spr: new SeedPosRatioClass() }]])
      });

      const filter = path.genExistingTriplesFilter(process);

      expect(filter).toBeDefined();
      expect(filter?.nodes).toBe('http://example.com/head');
      expect(filter?._id).toEqual({ $nin: ['triple1', 'triple2'] });
      expect(filter?.predicate).toBe('http://pred.org');
      expect(filter?.subject).toBe('http://example.com/head');
    });

    it('does not add direction filter when predicate is not allowed', () => {
      const path = createMockPath({
        headUrl: 'http://example.com/head',
        predicatesElems: [],
        predicatesCount: 0
      });

      const bf = new BranchFactorClass();
      bf.subj = 2;
      bf.obj = 1;

      const process = createMockProcess({
        maxPathProps: 2,
        limType: 'blacklist',
        limPredicates: ['http://pred.org'],
        followDirection: true,
        predsDirMetrics: new Map([['http://pred.org', { bf, spr: new SeedPosRatioClass() }]])
      });

      const filter = path.genExistingTriplesFilter(process);

      expect(filter).toBeDefined();
      expect(filter?.$or).toBeUndefined();
    });

    it('returns empty filter when no predsDirMetrics', () => {
      const path = createMockPath({
        headUrl: 'http://example.com/head',
        predicatesElems: [],
        predicatesCount: 0
      });

      const process = createMockProcess({
        maxPathProps: 2,
        limType: 'blacklist',
        limPredicates: ['http://pred.org'],
        followDirection: true,
        predsDirMetrics: undefined
      });

      const filter = path.genExistingTriplesFilter(process);

      expect(filter).toBeDefined();
      expect(filter?.predicate).toBeDefined();
    });
  });

  describe('base filter behavior', () => {
    it('includes head URL in nodes filter', () => {
      const path = createMockPath({
        headUrl: 'http://unique-head.org/test'
      });
      const process = createMockProcess({});

      const filter = path.genExistingTriplesFilter(process);

      expect(filter?.nodes).toBe('http://unique-head.org/test');
    });

    it('excludes already used triples with $nin', () => {
      const path = createMockPath({
        triples: ['abc123', 'def456']
      });
      const process = createMockProcess({});

      const filter = path.genExistingTriplesFilter(process);

      expect(filter?._id).toEqual({ $nin: ['abc123', 'def456'] });
    });
  });

  describe('edge cases', () => {
    it('returns null when allowed set is empty and path is full with whitelist', () => {
      const path = createMockPath({
        predicatesElems: ['http://notwhitelisted.org'],
        predicatesCount: 1
      });
      const process = createMockProcess({
        maxPathProps: 1,
        limType: 'whitelist',
        limPredicates: ['http://whitelist.org']
      });

      const filter = path.genExistingTriplesFilter(process);

      expect(filter).toBeNull();
    });

    it('handles empty limPredicates array with blacklist', () => {
      const path = createMockPath({});
      const process = createMockProcess({
        limType: 'blacklist',
        limPredicates: []
      });

      const filter = path.genExistingTriplesFilter(process);

      expect(filter).toBeDefined();
    });
  });

  describe('TraversalPathClass.genPredicatesFilter', () => {
  const createMockPath = (predicatesElems: string[] = []) => {
    const path = new TraversalPathClass();
    path.processId = 'test-pid';
    path.status = 'active';
    path.seed = { url: 'http://example.com/seed' };
    path.head = { 
      url: 'http://example.com/head',
      status: 'unvisited',
      domain: { origin: 'http://example.com', status: 'ready' }
    };
    path.predicates = {
      count: predicatesElems.length,
      elems: predicatesElems
    };
    path.nodes = {
      count: 1,
      elems: ['http://example.com/node1']
    };
    path.triples = [];
    return path;
  };

  describe('when path is not full', () => {
    it('adds all whitelist predicates to allowed set', () => {
      const path = createMockPath([]);
      const result = path.genPredicatesFilter('whitelist', ['p1', 'p2'], false);

      expect(result).not.toBeNull();
      expect(result?.allowed.size).toBe(2);
      expect(result?.allowed.has('p1')).toBe(true);
      expect(result?.allowed.has('p2')).toBe(true);
    });

    it('adds all blacklist predicates to notAllowed set', () => {
      const path = createMockPath([]);
      const result = path.genPredicatesFilter('blacklist', ['p1', 'p2'], false);

      expect(result).not.toBeNull();
      expect(result?.notAllowed.size).toBe(2);
      expect(result?.notAllowed.has('p1')).toBe(true);
      expect(result?.notAllowed.has('p2')).toBe(true);
    });

    it('returns $nin filter for notAllowed predicates', () => {
      const path = createMockPath([]);
      const result = path.genPredicatesFilter('blacklist', ['p1', 'p2'], false);

      expect(result?.predFilter).toEqual({ predicate: { $nin: ['p1', 'p2'] } });
    });

    it('returns $ne filter for single notAllowed predicate', () => {
      const path = createMockPath([]);
      const result = path.genPredicatesFilter('blacklist', ['p1'], false);

      expect(result?.predFilter).toEqual({ predicate: { $ne: 'p1' } });
    });

    it('returns $in filter for allowed predicates', () => {
      const path = createMockPath([]);
      const result = path.genPredicatesFilter('whitelist', ['p1', 'p2'], false);

      expect(result?.predFilter).toEqual({ predicate: { $in: ['p1', 'p2'] } });
    });

    it('returns direct equality for single allowed predicate', () => {
      const path = createMockPath([]);
      const result = path.genPredicatesFilter('whitelist', ['p1'], false);

      expect(result?.predFilter).toEqual({ predicate: 'p1' });
    });
  });

  describe('when path is full', () => {
    it('filters path predicates against whitelist', () => {
      const path = createMockPath(['p1', 'p2', 'p3']);
      const result = path.genPredicatesFilter('whitelist', ['p1', 'p4'], true);

      expect(result).not.toBeNull();
      expect(result?.allowed.size).toBe(1);
      expect(result?.allowed.has('p1')).toBe(true);
    });

    it('returns null when no path predicates match whitelist', () => {
      const path = createMockPath(['p2', 'p3']);
      const result = path.genPredicatesFilter('whitelist', ['p1', 'p4'], true);

      expect(result).toBeNull();
    });

    it('filters path predicates against blacklist', () => {
      const path = createMockPath(['p1', 'p2', 'p3']);
      const result = path.genPredicatesFilter('blacklist', ['p1'], true);

      expect(result).not.toBeNull();
      expect(result?.allowed.size).toBe(2);
      expect(result?.allowed.has('p2')).toBe(true);
      expect(result?.allowed.has('p3')).toBe(true);
    });

    it('returns filter when all path predicates are allowed', () => {
      const path = createMockPath(['p1']);
      const result = path.genPredicatesFilter('blacklist', ['p2'], true);

      expect(result).not.toBeNull();
      expect(result?.predFilter).toEqual({ predicate: 'p1' });
    });
  });

  describe('edge cases', () => {
    it('returns null when allowed is empty and path is full with whitelist', () => {
      const path = createMockPath(['p1']);
      const result = path.genPredicatesFilter('whitelist', ['p2'], true);

      expect(result).toBeNull();
    });

    it('handles empty limPredicates array with whitelist', () => {
      const path = createMockPath([]);
      const result = path.genPredicatesFilter('whitelist', [], false);

      expect(result).toBeNull();
    });

    it('handles empty limPredicates array with blacklist', () => {
      const path = createMockPath([]);
      const result = path.genPredicatesFilter('blacklist', [], false);

      expect(result).not.toBeNull();
      expect(result?.predFilter).toEqual({});
    });

    it('returns filter when both allowed and notAllowed are empty', () => {
      const path = createMockPath(['p1']);
      const result = path.genPredicatesFilter('blacklist', [], true);

      expect(result).not.toBeNull();
      expect(result?.predFilter).toEqual({ predicate: 'p1' });
    });
  });
});

describe('TraversalPathClass.genDirectionFilter', () => {
  const createMockPath = (headUrl: string = 'http://example.com/head') => {
    const path = new TraversalPathClass();
    path.processId = 'test-pid';
    path.status = 'active';
    path.seed = { url: 'http://example.com/seed' };
    path.head = { 
      url: headUrl,
      status: 'unvisited',
      domain: { origin: 'http://example.com', status: 'ready' }
    };
    path.predicates = { count: 0, elems: [] };
    path.nodes = { count: 1, elems: [] };
    path.triples = [];
    return path;
  };

  describe('when followDirection is false', () => {
    it('returns empty filter', () => {
      const path = createMockPath();
      const result = path.genDirectionFilter(
        new Set(['p1']),
        new Set(['p2']),
        'blacklist',
        false,
        new Map()
      );

      expect(result).toEqual({});
    });
  });

  describe('when predsDirMetrics is empty', () => {
    it('returns empty filter', () => {
      const path = createMockPath();
      const result = path.genDirectionFilter(
        new Set(['p1']),
        new Set(['p2']),
        'blacklist',
        true,
        undefined
      );

      expect(result).toEqual({});
    });

    it('returns empty filter when Map is empty', () => {
      const path = createMockPath();
      const result = path.genDirectionFilter(
        new Set(['p1']),
        new Set(['p2']),
        'blacklist',
        true,
        new Map()
      );

      expect(result).toEqual({});
    });
  });

  describe('when predicates have directionality', () => {
    it('adds predicates to subjPreds when bfRatio >= 1.2', () => {
      const path = createMockPath('http://head.org');

      const bf = new BranchFactorClass();
      bf.subj = 3;
      bf.obj = 2;

      const result = path.genDirectionFilter(
        new Set(),
        new Set(),
        'blacklist',
        true,
        new Map([['p1', { bf, spr: new SeedPosRatioClass() }]])
      );

      expect(result).toHaveProperty('predicate', 'p1');
      expect(result).toHaveProperty('subject', 'http://head.org');
    });

    it('adds predicates to objPreds when bfRatio <= 0.83', () => {
      const path = createMockPath('http://head.org');

      const bf = new BranchFactorClass();
      bf.subj = 1;
      bf.obj = 2;

      const result = path.genDirectionFilter(
        new Set(),
        new Set(),
        'blacklist',
        true,
        new Map([['p1', { bf, spr: new SeedPosRatioClass() }]])
      );

      expect(result).toHaveProperty('predicate', 'p1');
      expect(result).toHaveProperty('object', 'http://head.org');
    });

    it('adds predicates to noDirPreds when bfRatio is between 0.83 and 1.2 (uses $ne for blacklist)', () => {
      const path = createMockPath();

      const bf = new BranchFactorClass();
      bf.subj = 1;
      bf.obj = 1;

      const result = path.genDirectionFilter(
        new Set(),
        new Set(),
        'blacklist',
        true,
        new Map([['p1', { bf, spr: new SeedPosRatioClass() }]])
      );

      expect(result).toEqual({ predicate: { $ne: 'p1' } });
    });
  });

  describe('with allowed/notAllowed filters', () => {
    it('skips predicates not in allowed set', () => {
      const path = createMockPath();

      const bf = new BranchFactorClass();
      bf.subj = 3;
      bf.obj = 1;

      const result = path.genDirectionFilter(
        new Set(['allowed-p1']),
        new Set(),
        'blacklist',
        true,
        new Map([
          ['allowed-p1', { bf, spr: new SeedPosRatioClass() }],
          ['not-allowed-p2', { bf, spr: new SeedPosRatioClass() }]
        ])
      );

      expect(result).toHaveProperty('predicate', 'allowed-p1');
    });

    it('skips predicates in notAllowed set', () => {
      const path = createMockPath();

      const bf = new BranchFactorClass();
      bf.subj = 3;
      bf.obj = 1;

      const result = path.genDirectionFilter(
        new Set(),
        new Set(['blocked-p1']),
        'blacklist',
        true,
        new Map([
          ['blocked-p1', { bf, spr: new SeedPosRatioClass() }],
          ['allowed-p2', { bf, spr: new SeedPosRatioClass() }]
        ])
      );

      expect(result).toHaveProperty('predicate', 'allowed-p2');
    });

    it('adds allowed predicates without metrics to noDirPreds', () => {
      const path = createMockPath();

      const bf = new BranchFactorClass();
      bf.subj = 3;
      bf.obj = 1;

      const result = path.genDirectionFilter(
        new Set(['p1', 'p2']),
        new Set(),
        'blacklist',
        true,
        new Map([['p1', { bf, spr: new SeedPosRatioClass() }]])
      );

      expect(result).toHaveProperty('$or');
    });
  });

  describe('with whitelist/blacklist limType', () => {
    it('uses direct equality for noDirPreds when limType is whitelist', () => {
      const path = createMockPath();

      const bf = new BranchFactorClass();
      bf.subj = 1;
      bf.obj = 1;

      const result = path.genDirectionFilter(
        new Set(),
        new Set(),
        'whitelist',
        true,
        new Map([['p1', { bf, spr: new SeedPosRatioClass() }]])
      );

      expect(result).toHaveProperty('predicate', 'p1');
    });

    it('uses $ne for noDirPreds when limType is blacklist', () => {
      const path = createMockPath();

      const bf = new BranchFactorClass();
      bf.subj = 1;
      bf.obj = 1;

      const result = path.genDirectionFilter(
        new Set(),
        new Set(),
        'blacklist',
        true,
        new Map([['p1', { bf, spr: new SeedPosRatioClass() }]])
      );

      expect(result).toHaveProperty('predicate', { $ne: 'p1' });
    });
  });

  describe('single vs multiple predicates', () => {
    it('uses direct equality for single predicate in subjPreds', () => {
      const path = createMockPath('http://head.org');

      const bf = new BranchFactorClass();
      bf.subj = 3;
      bf.obj = 1;

      const result = path.genDirectionFilter(
        new Set(),
        new Set(),
        'blacklist',
        true,
        new Map([['p1', { bf, spr: new SeedPosRatioClass() }]])
      );

      expect(result.predicate).toBe('p1');
      expect(result.subject).toBe('http://head.org');
    });

    it('uses $in for multiple predicates in subjPreds', () => {
      const path = createMockPath('http://head.org');

      const bf = new BranchFactorClass();
      bf.subj = 3;
      bf.obj = 1;

      const result = path.genDirectionFilter(
        new Set(),
        new Set(),
        'blacklist',
        true,
        new Map([
          ['p1', { bf, spr: new SeedPosRatioClass() }],
          ['p2', { bf, spr: new SeedPosRatioClass() }]
        ])
      );

      expect(result).toEqual({ predicate: { $in: ['p1', 'p2'] }, subject: 'http://head.org' });
    });
  });

  describe('edge cases', () => {
    it('returns filter with notAllowed predicate when no predicates pass filters', () => {
      const path = createMockPath();

      const bf = new BranchFactorClass();
      bf.subj = 3;
      bf.obj = 1;

      const result = path.genDirectionFilter(
        new Set(['allowed-p1']),
        new Set(),
        'blacklist',
        true,
        new Map([['other-p2', { bf, spr: new SeedPosRatioClass() }]])
      );

      expect(result).toEqual({ predicate: { $ne: 'allowed-p1' } });
    });
  });

    it('returns single clause without $or when only one predicate set has items', () => {
      const path = createMockPath('http://head.org');

      const bf = new BranchFactorClass();
      bf.subj = 3;
      bf.obj = 1;

      const result = path.genDirectionFilter(
        new Set(),
        new Set(),
        'blacklist',
        true,
        new Map([['p1', { bf, spr: new SeedPosRatioClass() }]])
      );

      expect(result).not.toHaveProperty('$or');
      expect(result).toHaveProperty('predicate');
      expect(result).toHaveProperty('subject');
    });
  });

  describe('return value based on or array length', () => {
    it('returns empty object when all predicate sets are empty', () => {
      const path = createMockPath({ headUrl: 'http://example.com/head' });

      const result = path.genDirectionFilter(
        new Set(),
        new Set(),
        'blacklist',
        true,
        new Map()
      );

      expect(result).toEqual({});
    });

    it('returns single clause without $or when only subjPreds has items', () => {
      const path = createMockPath({ headUrl: 'http://head.org' });

      const bf = new BranchFactorClass();
      bf.subj = 3;
      bf.obj = 1;

      const result = path.genDirectionFilter(
        new Set(),
        new Set(),
        'blacklist',
        true,
        new Map([['p1', { bf, spr: new SeedPosRatioClass() }]])
      );

      expect(result).not.toHaveProperty('$or');
      expect(result).toHaveProperty('predicate', 'p1');
      expect(result).toHaveProperty('subject', 'http://head.org');
    });

    it('returns $or when both subjPreds and objPreds have items', () => {
      const path = createMockPath({ headUrl: 'http://head.org' });

      const bfSubj = new BranchFactorClass();
      bfSubj.subj = 3;
      bfSubj.obj = 1;

      const bfObj = new BranchFactorClass();
      bfObj.subj = 1;
      bfObj.obj = 3;

      const result = path.genDirectionFilter(
        new Set(),
        new Set(),
        'blacklist',
        true,
        new Map([
          ['subj-pred', { bf: bfSubj, spr: new SeedPosRatioClass() }],
          ['obj-pred', { bf: bfObj, spr: new SeedPosRatioClass() }]
        ])
      );

      expect(result).toHaveProperty('$or');
      expect(result.$or).toHaveLength(2);
    });

    it('returns $or when subjPreds and noDirPreds have items', () => {
      const path = createMockPath({ headUrl: 'http://head.org' });

      const bfSubj = new BranchFactorClass();
      bfSubj.subj = 3;
      bfSubj.obj = 1;

      const bfNoDir = new BranchFactorClass();
      bfNoDir.subj = 1;
      bfNoDir.obj = 1;

      const result = path.genDirectionFilter(
        new Set(),
        new Set(),
        'blacklist',
        true,
        new Map([
          ['subj-pred', { bf: bfSubj, spr: new SeedPosRatioClass() }],
          ['nodir-pred', { bf: bfNoDir, spr: new SeedPosRatioClass() }]
        ])
      );

      expect(result).toHaveProperty('$or');
      expect(result.$or).toHaveLength(2);
    });

    it('returns $or when objPreds and noDirPreds have items', () => {
      const path = createMockPath({ headUrl: 'http://head.org' });

      const bfObj = new BranchFactorClass();
      bfObj.subj = 1;
      bfObj.obj = 3;

      const bfNoDir = new BranchFactorClass();
      bfNoDir.subj = 1;
      bfNoDir.obj = 1;

      const result = path.genDirectionFilter(
        new Set(),
        new Set(),
        'blacklist',
        true,
        new Map([
          ['obj-pred', { bf: bfObj, spr: new SeedPosRatioClass() }],
          ['nodir-pred', { bf: bfNoDir, spr: new SeedPosRatioClass() }]
        ])
      );

      expect(result).toHaveProperty('$or');
      expect(result.$or).toHaveLength(2);
    });

    it('returns $or when all three predicate sets have items', () => {
      const path = createMockPath({ headUrl: 'http://head.org' });

      const bfSubj = new BranchFactorClass();
      bfSubj.subj = 3;
      bfSubj.obj = 1;

      const bfObj = new BranchFactorClass();
      bfObj.subj = 1;
      bfObj.obj = 3;

      const bfNoDir = new BranchFactorClass();
      bfNoDir.subj = 1;
      bfNoDir.obj = 1;

      const result = path.genDirectionFilter(
        new Set(),
        new Set(),
        'blacklist',
        true,
        new Map([
          ['subj-pred', { bf: bfSubj, spr: new SeedPosRatioClass() }],
          ['obj-pred', { bf: bfObj, spr: new SeedPosRatioClass() }],
          ['nodir-pred', { bf: bfNoDir, spr: new SeedPosRatioClass() }]
        ])
      );

      expect(result).toHaveProperty('$or');
      expect(result.$or).toHaveLength(3);
    });

    it('returns filter with $ne when allowed predicate not in predsDirMetrics (added to noDirPreds)', () => {
      const path = createMockPath({ headUrl: 'http://example.com/head' });

      const bf = new BranchFactorClass();
      bf.subj = 3;
      bf.obj = 1;

      const result = path.genDirectionFilter(
        new Set(['only-allowed']),
        new Set(),
        'blacklist',
        true,
        new Map([['other-pred', { bf, spr: new SeedPosRatioClass() }]])
      );

      expect(result).toEqual({ predicate: { $ne: 'only-allowed' } });
    });

    it('returns empty object when all preds filtered out by notAllowed', () => {
      const path = createMockPath({ headUrl: 'http://example.com/head' });

      const bf = new BranchFactorClass();
      bf.subj = 3;
      bf.obj = 1;

      const result = path.genDirectionFilter(
        new Set(),
        new Set(['blocked-pred']),
        'blacklist',
        true,
        new Map([['blocked-pred', { bf, spr: new SeedPosRatioClass() }]])
      );

      expect(result).toEqual({});
    });
  });
});

describe('TraversalPathClass.shouldCreateNewPath', () => {
  const createMockPath = (overrides: {
    headUrl?: string;
    nodesElems?: string[];
    nodesCount?: number;
  }) => {
    const path = new TraversalPathClass();
    path.processId = 'test-pid';
    path.status = 'active';
    path.seed = { url: 'http://example.com/seed' };
    path.head = { 
      url: overrides.headUrl ?? 'http://example.com/head',
      status: 'unvisited',
      domain: { origin: 'http://example.com', status: 'ready' }
    };
    path.predicates = { count: 0, elems: [] };
    path.nodes = {
      count: overrides.nodesCount ?? overrides.nodesElems?.length ?? 1,
      elems: overrides.nodesElems ?? ['http://example.com/node1']
    };
    path.triples = [];
    return path;
  };

  const createMockTriple = (subject: string, object: string, predicate: string) => {
    return { subject, object, predicate } as any;
  };

  describe('returns false', () => {
    it('when subject equals object (same subject and object)', () => {
      const path = createMockPath({ headUrl: 'http://example.com/head' });
      const triple = createMockTriple('http://same.org', 'http://same.org', 'http://pred.org');

      const result = path.shouldCreateNewPath(triple);

      expect(result).toBe(false);
    });

    it('when predicate equals head URL', () => {
      const path = createMockPath({ headUrl: 'http://example.com/head' });
      const triple = createMockTriple('http://subj.org', 'http://obj.org', 'http://example.com/head');

      const result = path.shouldCreateNewPath(triple);

      expect(result).toBe(false);
    });

    it('when new head URL already exists in nodes', () => {
      const path = createMockPath({ 
        headUrl: 'http://example.com/head',
        nodesElems: ['http://node1.org', 'http://existing-node.org']
      });
      // head is example.com/head, triple has subject as head, so newHead = object
      const triple = createMockTriple('http://example.com/head', 'http://existing-node.org', 'http://pred.org');

      const result = path.shouldCreateNewPath(triple);

      expect(result).toBe(false);
    });

    it('when new head URL already exists in nodes (reverse direction)', () => {
      const path = createMockPath({ 
        headUrl: 'http://example.com/head',
        nodesElems: ['http://node1.org', 'http://existing-node.org']
      });
      // head is example.com/head, triple has object as head, so newHead = subject
      const triple = createMockTriple('http://existing-node.org', 'http://example.com/head', 'http://pred.org');

      const result = path.shouldCreateNewPath(triple);

      expect(result).toBe(false);
    });
  });

  describe('returns true', () => {
    it('when triple is valid for extension (subject matches head)', () => {
      const path = createMockPath({ 
        headUrl: 'http://example.com/head',
        nodesElems: ['http://node1.org']
      });
      const triple = createMockTriple('http://example.com/head', 'http://new-node.org', 'http://pred.org');

      const result = path.shouldCreateNewPath(triple);

      expect(result).toBe(true);
    });

    it('when triple is valid for extension (object matches head)', () => {
      const path = createMockPath({ 
        headUrl: 'http://example.com/head',
        nodesElems: ['http://node1.org']
      });
      const triple = createMockTriple('http://new-node.org', 'http://example.com/head', 'http://pred.org');

      const result = path.shouldCreateNewPath(triple);

      expect(result).toBe(true);
    });

    it('when new head URL is not in nodes', () => {
      const path = createMockPath({ 
        headUrl: 'http://example.com/head',
        nodesElems: ['http://node1.org', 'http://node2.org']
      });
      const triple = createMockTriple('http://example.com/head', 'http://brand-new.org', 'http://pred.org');

      const result = path.shouldCreateNewPath(triple);

      expect(result).toBe(true);
    });
  });
});

describe('TraversalPathClass.tripleIsOutOfBounds', () => {
  const createMockPath = (overrides: {
    nodesCount?: number;
    predicatesElems?: string[];
    predicatesCount?: number;
  }) => {
    const path = new TraversalPathClass();
    path.processId = 'test-pid';
    path.status = 'active';
    path.seed = { url: 'http://example.com/seed' };
    path.head = { 
      url: 'http://example.com/head',
      status: 'unvisited',
      domain: { origin: 'http://example.com', status: 'ready' }
    };
    path.predicates = {
      count: overrides.predicatesCount ?? overrides.predicatesElems?.length ?? 0,
      elems: overrides.predicatesElems ?? []
    };
    path.nodes = {
      count: overrides.nodesCount ?? 1,
      elems: ['http://example.com/node1']
    };
    path.triples = [];
    return path;
  };

  const createMockProcess = (maxPathLength: number, maxPathProps: number) => {
    const step = new StepClass();
    step.maxPathLength = maxPathLength;
    step.maxPathProps = maxPathProps;
    step.seeds = [];
    step.followDirection = false;
    step.resetErrors = false;
    step.predLimit = new PredicateLimitationClass();
    return step;
  };

  const createMockTriple = (predicate: string) => {
    return { 
      subject: 'http://subj.org', 
      object: 'http://obj.org', 
      predicate 
    } as any;
  };

  describe('returns true', () => {
    it('when nodes.count >= maxPathLength', () => {
      const path = createMockPath({ nodesCount: 5 });
      const process = createMockProcess(5, 2);
      const triple = createMockTriple('http://pred.org');

      const result = path.tripleIsOutOfBounds(triple, { currentStep: process } as any);

      expect(result).toBe(true);
    });

    it('when nodes.count > maxPathLength', () => {
      const path = createMockPath({ nodesCount: 6 });
      const process = createMockProcess(5, 2);
      const triple = createMockTriple('http://pred.org');

      const result = path.tripleIsOutOfBounds(triple, { currentStep: process } as any);

      expect(result).toBe(true);
    });

    it('when predicate is not in path and predicates.count >= maxPathProps', () => {
      const path = createMockPath({ 
        nodesCount: 1,
        predicatesElems: ['http://existing-pred.org'],
        predicatesCount: 2
      });
      const process = createMockProcess(10, 2);
      const triple = createMockTriple('http://new-pred.org');

      const result = path.tripleIsOutOfBounds(triple, { currentStep: process } as any);

      expect(result).toBe(true);
    });

    it('when nodes at limit and predicate not in path and predicates at limit', () => {
      const path = createMockPath({ 
        nodesCount: 3,
        predicatesElems: ['http://pred1.org'],
        predicatesCount: 2
      });
      const process = createMockProcess(5, 2);
      const triple = createMockTriple('http://pred2.org');

      const result = path.tripleIsOutOfBounds(triple, { currentStep: process } as any);

      expect(result).toBe(true);
    });
  });

  describe('returns false', () => {
    it('when nodes.count < maxPathLength and predicate is in path', () => {
      const path = createMockPath({ 
        nodesCount: 2,
        predicatesElems: ['http://pred1.org', 'http://pred2.org'],
        predicatesCount: 2
      });
      const process = createMockProcess(5, 2);
      const triple = createMockTriple('http://pred1.org');

      const result = path.tripleIsOutOfBounds(triple, { currentStep: process } as any);

      expect(result).toBe(false);
    });

    it('when nodes.count < maxPathLength and predicate not in path but predicates.count < maxPathProps', () => {
      const path = createMockPath({ 
        nodesCount: 1,
        predicatesElems: ['http://pred1.org'],
        predicatesCount: 1
      });
      const process = createMockProcess(5, 2);
      const triple = createMockTriple('http://new-pred.org');

      const result = path.tripleIsOutOfBounds(triple, { currentStep: process } as any);

      expect(result).toBe(false);
    });

    it('when nodes.count is 0', () => {
      const path = createMockPath({ nodesCount: 0 });
      const process = createMockProcess(5, 2);
      const triple = createMockTriple('http://pred.org');

      const result = path.tripleIsOutOfBounds(triple, { currentStep: process } as any);

      expect(result).toBe(false);
    });

    it('when at boundary: nodes.count = maxPathLength - 1', () => {
      const path = createMockPath({ nodesCount: 4 });
      const process = createMockProcess(5, 2);
      const triple = createMockTriple('http://pred.org');

      const result = path.tripleIsOutOfBounds(triple, { currentStep: process } as any);

      expect(result).toBe(false);
    });

    it('when at boundary: predicates.count = maxPathProps - 1 and predicate not in path', () => {
      const path = createMockPath({ 
        nodesCount: 1,
        predicatesElems: ['http://pred1.org'],
        predicatesCount: 1
      });
      const process = createMockProcess(5, 2);
      const triple = createMockTriple('http://pred2.org');

      const result = path.tripleIsOutOfBounds(triple, { currentStep: process } as any);

      expect(result).toBe(false);
    });

    it('when predicate is in path but predicates.count >= maxPathProps', () => {
      const path = createMockPath({ 
        nodesCount: 1,
        predicatesElems: ['http://existing.org'],
        predicatesCount: 2
      });
      const process = createMockProcess(5, 2);
      const triple = createMockTriple('http://existing.org');

      const result = path.tripleIsOutOfBounds(triple, { currentStep: process } as any);

      expect(result).toBe(false);
    });
  });
});
