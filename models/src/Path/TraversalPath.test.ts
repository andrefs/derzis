import { describe, it, expect, vi } from 'vitest';
import { TraversalPathClass } from './TraversalPath';
import {
  StepClass,
  PredicateLimitationClass,
  BranchFactorClass,
  PredLimitation
} from '../Process/aux-classes';
import { buildLimsByType } from '../Process';
import { Head } from './Path';
import { Triple } from '../Triple/Triple';
import { TripleType } from '@derzis/common';
import { Types } from 'mongoose';
import config from '@derzis/config';

const LITERAL_PREDS = [
  'http://www.w3.org/2000/01/rdf-schema#label',
  'http://www.w3.org/2000/01/rdf-schema#comment'
];

describe('TraversalPathClass.genExistingTriplesFilter', () => {
  const createMockPath = (overrides: {
    headUrl?: string;
    predicatesElems?: string[];
    triples?: any[];
    predicatesCount?: number;
  }) => {
    const path = new TraversalPathClass();
    path.processId = 'test-pid';
    path.seed = { url: 'http://example.com/seed' };
    path.head = {
      url: overrides.headUrl ?? 'http://example.com/head',
      status: 'unvisited',
      domain: { origin: 'http://example.com', isUnvisited: true },
      type: 'url'
    } as Head;
    path.predicates = { count: 0, elems: [] };
    path.nodes = { count: 1, elems: ['http://example.com/node1'] };
    path.triples = [];
    return path;
  };

  describe('TraversalPathClass.genDirectionFilter', () => {
    const createMockPath = (headUrl: string = 'http://example.com/head') => {
      const path = new TraversalPathClass();
      path.processId = 'test-pid';
      path.seed = { url: 'http://example.com/seed' };
      path.head = {
        url: headUrl,
        status: 'unvisited',
        domain: { origin: 'http://example.com', isUnvisited: true },
        type: 'url'
      } as Head;
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
          new Map([['p1', bf]])
        );

        expect(result).toHaveProperty('$or');
        expect(result.$or).toHaveLength(2);
        expect(result.$or).toContainEqual({ predicate: 'p1', subject: 'http://head.org' });
        expect(result.$or).toContainEqual({ predicate: { $nin: LITERAL_PREDS } });
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
          new Map([['p1', bf]])
        );

        expect(result).toHaveProperty('$or');
        expect(result.$or).toHaveLength(2);
        expect(result.$or).toContainEqual({ predicate: 'p1', object: 'http://head.org' });
        expect(result.$or).toContainEqual({ predicate: { $nin: LITERAL_PREDS } });
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
          new Map([['p1', bf]])
        );

        expect(result).toEqual({ predicate: { $nin: ['p1', ...LITERAL_PREDS] } });
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
            ['allowed-p1', bf],
            ['not-allowed-p2', bf]
          ])
        );

        expect(result).toHaveProperty('$or');
        expect(result.$or).toHaveLength(2);
        expect(result.$or).toContainEqual({
          predicate: 'allowed-p1',
          subject: 'http://example.com/head'
        });
        expect(result.$or).toContainEqual({ predicate: { $nin: LITERAL_PREDS } });
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
            ['blocked-p1', bf],
            ['allowed-p2', bf]
          ])
        );

        expect(result).toHaveProperty('$or');
        expect(result.$or).toHaveLength(2);
        expect(result.$or).toContainEqual({
          predicate: 'allowed-p2',
          subject: 'http://example.com/head'
        });
        expect(result.$or).toContainEqual({ predicate: { $nin: LITERAL_PREDS } });
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
          new Map([['p1', bf]])
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
          new Map([['p1', bf]])
        );

        expect(result).toHaveProperty('predicate');
        expect(result.predicate).toEqual({ $in: ['p1', ...LITERAL_PREDS] });
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
          new Map([['p1', bf]])
        );

        expect(result).toHaveProperty('predicate', { $nin: ['p1', ...LITERAL_PREDS] });
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
          new Map([['p1', bf]])
        );

        expect(result).toHaveProperty('$or');
        expect(result.$or).toHaveLength(2);
        expect(result.$or).toContainEqual({ predicate: 'p1', subject: 'http://head.org' });
        expect(result.$or).toContainEqual({ predicate: { $nin: LITERAL_PREDS } });
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
            ['p1', bf],
            ['p2', bf]
          ])
        );

        expect(result).toHaveProperty('$or');
        expect(result.$or).toHaveLength(2);
        expect(result.$or).toContainEqual({
          predicate: { $in: ['p1', 'p2'] },
          subject: 'http://head.org'
        });
        expect(result.$or).toContainEqual({ predicate: { $nin: LITERAL_PREDS } });
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
          new Map([['other-p2', bf]])
        );

        expect(result).toEqual({ predicate: { $nin: ['allowed-p1', ...LITERAL_PREDS] } });
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
        new Map([['p1', bf]])
      );

      expect(result).toHaveProperty('$or');
      expect(result.$or).toHaveLength(2);
    });
  });

  describe('return value based on or array length', () => {
    it('returns empty object when all predicate sets are empty', () => {
      const path = createMockPath({ headUrl: 'http://example.com/head' });

      const result = path.genDirectionFilter(new Set(), new Set(), 'blacklist', true, new Map());

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
        new Map([['p1', bf]])
      );

      expect(result).toHaveProperty('$or');
      expect(result.$or).toHaveLength(2);
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
          ['subj-pred', bfSubj],
          ['obj-pred', bfObj]
        ])
      );

      expect(result).toHaveProperty('$or');
      expect(result.$or).toHaveLength(3);
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
          ['subj-pred', bfSubj],
          ['nodir-pred', bfNoDir]
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
          ['obj-pred', bfObj],
          ['nodir-pred', bfNoDir]
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
          ['subj-pred', bfSubj],
          ['obj-pred', bfObj],
          ['nodir-pred', bfNoDir]
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
        new Map([['other-pred', bf]])
      );

      expect(result).toEqual({ predicate: { $nin: ['only-allowed', ...LITERAL_PREDS] } });
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
        new Map([['blocked-pred', bf]])
      );

      expect(result).toEqual({ predicate: { $nin: LITERAL_PREDS } });
    });
  });
});

describe('TraversalPathClass.isExtensionValid', () => {
  const createMockPath = (overrides: {
    headUrl?: string;
    nodesElems?: string[];
    nodesCount?: number;
  }) => {
    const path = new TraversalPathClass();
    path.processId = 'test-pid';
    path.seed = { url: 'http://example.com/seed' };
    path.head = {
      url: overrides.headUrl ?? 'http://example.com/head',
      status: 'unvisited',
      domain: { origin: 'http://example.com', isUnvisited: true },
      type: 'url'
    } as Head;
    path.predicates = { count: 0, elems: [] };
    path.nodes = {
      count: overrides.nodesCount ?? overrides.nodesElems?.length ?? 1,
      elems: overrides.nodesElems ?? ['http://example.com/node1']
    };
    path.triples = [];
    return path;
  };

  const createMockTriple = (subject: string, object: string, predicate: string) => {
    return { subject, object, predicate, type: TripleType.NAMED_NODE } as any;
  };

  describe('returns false', () => {
    it('when subject equals object (same subject and object)', () => {
      const path = createMockPath({ headUrl: 'http://example.com/head' });
      const triple = createMockTriple('http://same.org', 'http://same.org', 'http://pred.org');

      const result = path.isExtensionValid(triple);

      expect(result).toBe(false);
    });

    it('when predicate equals head URL', () => {
      const path = createMockPath({ headUrl: 'http://example.com/head' });
      const triple = createMockTriple(
        'http://subj.org',
        'http://obj.org',
        'http://example.com/head'
      );

      const result = path.isExtensionValid(triple);

      expect(result).toBe(false);
    });

    it('when new head URL already exists in nodes', () => {
      const path = createMockPath({
        headUrl: 'http://example.com/head',
        nodesElems: ['http://node1.org', 'http://existing-node.org']
      });
      // head is example.com/head, triple has subject as head, so newHead = object
      const triple = createMockTriple(
        'http://example.com/head',
        'http://existing-node.org',
        'http://pred.org'
      );

      const result = path.isExtensionValid(triple);

      expect(result).toBe(false);
    });

    it('when new head URL already exists in nodes (reverse direction)', () => {
      const path = createMockPath({
        headUrl: 'http://example.com/head',
        nodesElems: ['http://node1.org', 'http://existing-node.org']
      });
      // head is example.com/head, triple has object as head, so newHead = subject
      const triple = createMockTriple(
        'http://existing-node.org',
        'http://example.com/head',
        'http://pred.org'
      );

      const result = path.isExtensionValid(triple);

      expect(result).toBe(false);
    });
  });

  describe('returns true', () => {
    it('when triple is valid for extension (subject matches head)', () => {
      const path = createMockPath({
        headUrl: 'http://example.com/head',
        nodesElems: ['http://node1.org']
      });
      const triple = createMockTriple(
        'http://example.com/head',
        'http://new-node.org',
        'http://pred.org'
      );

      const result = path.isExtensionValid(triple);

      expect(result).toBe(true);
    });

    it('when triple is valid for extension (object matches head)', () => {
      const path = createMockPath({
        headUrl: 'http://example.com/head',
        nodesElems: ['http://node1.org']
      });
      const triple = createMockTriple(
        'http://new-node.org',
        'http://example.com/head',
        'http://pred.org'
      );

      const result = path.isExtensionValid(triple);

      expect(result).toBe(true);
    });

    it('when new head URL is not in nodes', () => {
      const path = createMockPath({
        headUrl: 'http://example.com/head',
        nodesElems: ['http://node1.org', 'http://node2.org']
      });
      const triple = createMockTriple(
        'http://example.com/head',
        'http://brand-new.org',
        'http://pred.org'
      );

      const result = path.isExtensionValid(triple);

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
    path.seed = { url: 'http://example.com/seed' };
    path.head = {
      url: 'http://example.com/head',
      status: 'unvisited',
      domain: { origin: 'http://example.com', isUnvisited: true },
      type: 'url'
    } as Head;
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

describe('TraversalPathClass.genPredicatesFilter', () => {
  const LITERAL_PREDS = [
    'http://www.w3.org/2000/01/rdf-schema#label',
    'http://www.w3.org/2000/01/rdf-schema#comment'
  ];

  const createMockPath = (predicatesElems: string[] = []) => {
    const path = new TraversalPathClass();
    path.processId = 'test-pid';
    path.seed = { url: 'http://example.com/seed' };
    path.head = {
      url: 'http://example.com/head',
      status: 'unvisited',
      domain: { origin: 'http://example.com', isUnvisited: true },
      type: 'url'
    } as Head;
    path.predicates = { count: predicatesElems.length, elems: predicatesElems };
    path.nodes = { count: 1, elems: ['http://example.com/node1'] };
    path.triples = [];
    return path;
  };

  const createPredLimitation = (predicate: string, lims: string[]): PredLimitation => {
    const pl = new PredLimitation();
    pl.predicate = predicate;
    pl.lims = lims as any;
    return pl;
  };

  describe('when path is NOT full', () => {
    it('with require-future, adds required predicates to allowed', () => {
      const path = createMockPath([]);
      const result = path.genPredicatesFilter(
        [createPredLimitation('http://pred1.org', ['require-future'])],
        false
      );

      expect(result).not.toBeNull();
      expect(result?.allowed).toContain('http://pred1.org');
    });

    it('with disallow-future, adds disallowed predicates to notAllowed', () => {
      const path = createMockPath([]);
      const result = path.genPredicatesFilter(
        [createPredLimitation('http://bad.org', ['disallow-future'])],
        false
      );

      expect(result).not.toBeNull();
      expect(result?.notAllowed).toContain('http://bad.org');
    });

    it('always adds literal predicates to allowed with require-future', () => {
      const path = createMockPath([]);
      const result = path.genPredicatesFilter(
        [createPredLimitation(LITERAL_PREDS[0], ['require-future'])],
        false
      );

      expect(result?.allowed).toContain(LITERAL_PREDS[0]);
      expect(result?.allowed).toContain(LITERAL_PREDS[1]);
    });
  });

  describe('when path IS full', () => {
    it('with require-future, only allows predicates already in path that are required', () => {
      const path = createMockPath(['http://existing.org', 'http://required.org']);
      const result = path.genPredicatesFilter(
        [createPredLimitation('http://required.org', ['require-future'])],
        true
      );

      expect(result).not.toBeNull();
      expect(result?.allowed).toContain('http://required.org');
    });

    it('with disallow-future, allows predicates in path that are not disallowed', () => {
      const path = createMockPath(['http://good.org', 'http://bad.org']);
      const result = path.genPredicatesFilter(
        [createPredLimitation('http://bad.org', ['disallow-future'])],
        true
      );

      expect(result).not.toBeNull();
      expect(result?.allowed).toContain('http://good.org');
      expect(result?.allowed).not.toContain('http://bad.org');
    });
  });

  describe('returns null', () => {
    it('when path is full and allowed is empty with disallow-future', () => {
      const path = createMockPath([]);
      const result = path.genPredicatesFilter(
        [createPredLimitation('http://bad.org', ['disallow-future'])],
        true
      );

      // When path is full and path has no predicates, returns null
      expect(result).toBeNull();
    });
  });

  describe('with empty predLimitations', () => {
    it('returns filter allowing all predicates', () => {
      const path = createMockPath([]);
      const result = path.genPredicatesFilter([], false);

      expect(result).not.toBeNull();
      expect(result?.predFilter).toEqual({});
    });
  });

  describe('with multiple predLimitations', () => {
    it('handles multiple predicates with different lims', () => {
      const path = createMockPath([]);
      const result = path.genPredicatesFilter(
        [
          createPredLimitation('http://required.org', ['require-future']),
          createPredLimitation('http://blocked.org', ['disallow-future'])
        ],
        false
      );

      expect(result).not.toBeNull();
      expect(result?.allowed).toContain('http://required.org');
      expect(result?.notAllowed).toContain('http://blocked.org');
    });

    it('handles same predicate with multiple lims', () => {
      const path = createMockPath(['http://both.org']);
      // Predicate has both require-future and disallow-past
      const result = path.genPredicatesFilter(
        [createPredLimitation('http://both.org', ['require-future', 'disallow-past'])],
        true
      );

      // Full path with require-future - predicate is in path, so allowed
      expect(result).not.toBeNull();
      expect(result?.allowed).toContain('http://both.org');
    });

    it('handles require-past constraint', () => {
      const path = createMockPath(['http://exists.org']);
      // require-past is handled in query, not here - but predLimitations with only require-past should return empty filter
      const result = path.genPredicatesFilter(
        [createPredLimitation('http://exists.org', ['require-past'])],
        false
      );

      // No future constraints, so returns empty filter (all predicates allowed)
      expect(result?.predFilter).toEqual({});
    });

    it('handles disallow-past constraint', () => {
      const path = createMockPath(['http://exists.org']);
      // disallow-past is handled in query, not here - but predLimitations with only disallow-past should return empty filter
      const result = path.genPredicatesFilter(
        [createPredLimitation('http://exists.org', ['disallow-past'])],
        false
      );

      // No future constraints, so returns empty filter (all predicates allowed)
      expect(result?.predFilter).toEqual({});
    });

    it('handles combination of require-past and require-future on same predicate', () => {
      const path = createMockPath(['http://both.org']);
      const result = path.genPredicatesFilter(
        [createPredLimitation('http://both.org', ['require-past', 'require-future'])],
        false
      );

      // Non-full path with require-future - predicate is allowed
      expect(result?.allowed).toContain('http://both.org');
    });

    it('handles combination of disallow-past and disallow-future on same predicate', () => {
      const path = createMockPath([]);
      const result = path.genPredicatesFilter(
        [createPredLimitation('http://blocked.org', ['disallow-past', 'disallow-future'])],
        false
      );

      // Non-full path with disallow-future - predicate is not allowed
      expect(result?.notAllowed).toContain('http://blocked.org');
    });
  });
});

describe('TraversalPathClass.isExtensionAllowedByPath', () => {
  const createMockPath = (predicatesElems: string[] = []) => {
    const path = new TraversalPathClass();
    path.processId = 'test-pid';
    path.seed = { url: 'http://example.com/seed' };
    path.head = {
      url: 'http://example.com/head',
      status: 'unvisited',
      domain: { origin: 'http://example.com', isUnvisited: true },
      type: 'url'
    } as Head;
    path.predicates = { count: predicatesElems.length, elems: predicatesElems };
    path.nodes = { count: 1, elems: ['http://example.com/node1'] };
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

  const createPredLimitation = (predicate: string, lims: string[]): PredLimitation => {
    const pl = new PredLimitation();
    pl.predicate = predicate;
    pl.lims = lims as any;
    return pl;
  };

  it('returns true when all path predicates match a require-past pattern', () => {
    const path = createMockPath(['http://p1.org', 'http://p2.org']);
    const currentStep = createMockProcess(5, 3);
    currentStep.predLimitations = [
      createPredLimitation('http://p1.org', ['require-past']),
      createPredLimitation('http://p2.org', ['require-past'])
    ];
    const limsByType = buildLimsByType(currentStep.predLimitations);

    const result = path.isExtensionAllowedByPath(currentStep, limsByType);

    expect(result).toBe(true);
  });

  it('returns false when a path predicate does not match any require-past pattern', () => {
    const path = createMockPath(['http://valid.org', 'http://invalid.org']);
    const currentStep = createMockProcess(5, 3);
    currentStep.predLimitations = [createPredLimitation('http://valid.org', ['require-past'])];
    const limsByType = buildLimsByType(currentStep.predLimitations);

    const result = path.isExtensionAllowedByPath(currentStep, limsByType);

    expect(result).toBe(false);
  });

  it('returns true when require-past patterns are a superset and all path predicates match', () => {
    const path = createMockPath(['http://p1.org']);
    const currentStep = createMockProcess(5, 2);
    currentStep.predLimitations = [
      createPredLimitation('http://p1.org', ['require-past']),
      createPredLimitation('http://p2.org', ['require-past'])
    ];
    const limsByType = buildLimsByType(currentStep.predLimitations);

    const result = path.isExtensionAllowedByPath(currentStep, limsByType);

    expect(result).toBe(true);
  });

  it('returns true when there is no require-past constraint', () => {
    const path = createMockPath(['http://anything.org']);
    const currentStep = createMockProcess(5, 2);
    currentStep.predLimitations = [];
    const limsByType = buildLimsByType(currentStep.predLimitations);

    const result = path.isExtensionAllowedByPath(currentStep, limsByType);

    expect(result).toBe(true);
  });
});

describe('TraversalPathClass blank node extension', () => {
  it('extends through blank node and includes blank node in nodes.elems without counting it', async () => {
    const originalAllowBlankNodes = config.allowBlankNodes;
    config.allowBlankNodes = true;
    try {
      const path = new TraversalPathClass();
      path.processId = 'test-pid';
      path.seed = { url: 'http://seed.example.com' };
      path.head = {
        type: 'url',
        url: 'http://head.example.com',
        status: 'unvisited',
        domain: { origin: 'http://head.example.com', isUnvisited: true }
      } as Head;
      path.nodes = { count: 1, elems: ['http://head.example.com'] };
      path.predicates = { count: 0, elems: [] };
      path.triples = [];
      path.extensionCounter = 0;

      const blankNodeTriple = {
        _id: { toString: () => 'blankTripleId' } as any,
        subject: 'http://head.example.com',
        predicate: 'http://example.com/p1',
        object: { id: '_:b1' },
        type: TripleType.BLANK_NODE
      } as any;

      const outgoingTriple = {
        _id: { toString: () => 'outgoingTripleId' } as any,
        subject: '_:b1',
        predicate: 'http://example.com/p2',
        object: 'http://newhead.example.com',
        type: TripleType.NAMED_NODE,
        directionOk: () => true
      } as any;

      vi.spyOn(Triple, 'find').mockResolvedValue([outgoingTriple] as any);

      const process: any = {
        currentStep: {
          followDirection: false,
          predLimitations: [],
          maxPathLength: 10,
          maxPathProps: 5
        },
        curPredsBranchFactor: () => new Map()
      };

      const result = await path.genExtendedPaths(process, [blankNodeTriple]);

      expect(result.extendedPaths).toHaveLength(1);
      const ep = result.extendedPaths[0];
      // nodes.elems should include blank node id and new head url
      expect(ep.nodes.elems).toContain('_:b1');
      expect(ep.nodes.elems).toContain('http://newhead.example.com');
      // procTriples should include both triples with correct types
      expect(result.procTriples).toContainEqual({ id: 'blankTripleId', type: TripleType.BLANK_NODE });
      expect(result.procTriples).toContainEqual({ id: 'outgoingTripleId', type: TripleType.NAMED_NODE });
    } finally {
      config.allowBlankNodes = originalAllowBlankNodes;
    }
  });
});
