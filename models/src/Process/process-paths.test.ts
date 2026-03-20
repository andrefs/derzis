// @ts-nocheck
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  genTraversalPathQuery,
  buildStepPathQuery,
  hasPathsDomainRobotsChecking,
  hasPathsHeadBeingCrawled
} from './process-paths';
import { StepClass, PredicateLimitationClass, PredLimitation } from './aux-classes';
import { QueryFilter } from 'mongoose';
import type { TraversalPathDocument } from '../Path/TraversalPath';
import type { ProcessClass } from './Process';
import { Path, HEAD_TYPE } from '../Path/Path';
import { Domain } from '../Domain';
import { Types } from 'mongoose';
import { PathType } from '@derzis/common';

type TraversalPathQueryWithExpr = QueryFilter<TraversalPathDocument> & {
  $expr: {
    $not: {
      $setIsSubset: unknown[];
    };
  };
};

// Mock implementations using vi.mock
vi.mock('../Path/TraversalPath', () => {
  const createChainableMock = <T>(result: T) => {
    return {
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          then: (onfulfilled: (v: T) => unknown) => Promise.resolve(result).then(onfulfilled)
        })
      })
    };
  };

  class MockTraversalPathClass {
    _id = new Types.ObjectId();
    processId = 'test-pid';
    status = 'active';
    createdAt = new Date();
    extensionCounter = 0;
    nodes = { count: 1, elems: [] as unknown[] };
    predicates = { count: 0, elems: [] as unknown[] };
    head = {
      type: 'url' as const,
      url: 'http://test.com',
      status: 'unvisited' as const,
      domain: { origin: 'http://test.com', isUnvisited: true }
    };
    seed = { url: 'http://example.com/seed' };

    extendWithExistingTriples(proc: unknown) {
      return Promise.resolve({ extendedPaths: [], procTriples: [] });
    }
  }

  MockTraversalPathClass.countDocuments = vi.fn();
  MockTraversalPathClass.find = vi.fn(() => createChainableMock([]));
  MockTraversalPathClass.updateMany = vi.fn();

  return {
    TraversalPath: MockTraversalPathClass as unknown,
    TraversalPathClass: MockTraversalPathClass as unknown
  };
});

vi.mock('../Path/EndpointPath', () => {
  const createChainableMock = <T>(result: T) => {
    return {
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          then: (onfulfilled: (v: T) => unknown) => Promise.resolve(result).then(onfulfilled)
        })
      })
    };
  };

  class MockEndpointPathClass {
    _id = new Types.ObjectId();
    processId = 'test-pid';
    status = 'active';
    createdAt = new Date();
    extensionCounter = 0;
    shortestPath = { length: 1, seed: { url: 'http://test.com' } };
    seedPaths: Record<string, number> = {};
    head = {
      type: 'url' as const,
      url: 'http://test.com',
      status: 'unvisited' as const,
      domain: { origin: 'http://test.com', isUnvisited: true }
    };
    seed = { url: 'http://example.com/seed' };

    extendWithExistingTriples(proc: unknown) {
      return Promise.resolve({ extendedPaths: [], procTriples: [] });
    }
  }

  MockEndpointPathClass.countDocuments = vi.fn();
  MockEndpointPathClass.find = vi.fn(() => createChainableMock([]));
  MockEndpointPathClass.updateMany = vi.fn();

  return {
    EndpointPath: MockEndpointPathClass as unknown,
    EndpointPathClass: MockEndpointPathClass as unknown
  };
});

vi.mock('../Domain', () => {
  const mockSelect = vi.fn().mockReturnValue({
    lean: vi.fn().mockResolvedValue([])
  });

  const mockFind = vi.fn().mockReturnValue({
    select: mockSelect
  });

  return {
    Domain: {
      find: mockFind
    }
  };
});

vi.mock('./Process', () => ({
  Process: {
    findOne: vi.fn()
  }
}));

vi.mock('../Path/Path', () => ({
  Path: {
    countDocuments: vi.fn(),
    updateMany: vi.fn()
  },
  HEAD_TYPE: {
    URL: 'url',
    LITERAL: 'literal'
  }
}));

describe('genTraversalPathQuery', () => {
  const createMockProcess = (overrides: {
    pid?: string;
    maxPathLength?: number;
    maxPathProps?: number;
    predLimitations?: { predicate: string; lims: readonly string[] }[];
  }) => {
    const step = new StepClass();
    step.maxPathLength = overrides.maxPathLength ?? 4;
    step.maxPathProps = overrides.maxPathProps ?? 1;
    if (overrides.predLimitations !== undefined) {
      step.predLimitations = overrides.predLimitations;
    }
    step.seeds = [];
    step.followDirection = false;
    step.resetErrors = false;

    return {
      pid: overrides.pid ?? 'test-pid',
      currentStep: step
    } as ProcessClass;
  };

  describe('when there is no predicate limit', () => {
    it('returns base query with predicates.count <= maxPathProps', () => {
      const process = createMockProcess({
        pid: 'test-pid',
        maxPathLength: 4,
        maxPathProps: 1,
        predLimitations: []
      });

      const query = genTraversalPathQuery(process);

      expect(query).toEqual({
        processId: 'test-pid',
        status: 'active',
        'head.type': 'url',
        'nodes.count': { $lt: 4 },
        'predicates.count': { $lte: 1 }
      });
    });

    it('handles different maxPathProps values', () => {
      const process = createMockProcess({
        maxPathLength: 5,
        maxPathProps: 3,
        predLimit: undefined
      });

      const query = genTraversalPathQuery(process);

      expect(query['predicates.count']).toEqual({ $lte: 3 });
    });
  });

  describe('when there is a require-future predicate limit', () => {
    it('returns query with $or for full vs non-full paths', () => {
      const predLimitations = [
        { predicate: 'http://pred1.org', lims: ['require-future'] as const },
        { predicate: 'http://pred2.org', lims: ['require-future'] as const }
      ];

      const process = createMockProcess({
        maxPathProps: 2,
        predLimitations
      });

      const query = genTraversalPathQuery(process) as TraversalPathQueryWithExpr;

      // With future constraints, we have $or
      expect(query.$or).toBeDefined();
      expect(query.$or).toHaveLength(2);
      // First part: non-full paths
      expect(query.$or?.[0]).toEqual({ 'predicates.count': { $lt: 2 } });
      // Second part: full paths with constraint
      expect(query.$or?.[1]).toBeDefined();
      expect(query.$or?.[1]?.['predicates.count']).toBe(2);
      expect(query['predicates.count']).toEqual({ $lte: 2 });
    });

    it('creates $or with require-future constraint for full paths', () => {
      const predLimitations = [
        { predicate: 'http://only-one.org', lims: ['require-future'] as const }
      ];

      const process = createMockProcess({
        maxPathProps: 2,
        predLimitations
      });

      const query = genTraversalPathQuery(process) as TraversalPathQueryWithExpr;

      expect(query.$or).toBeDefined();
      expect(query.$or).toHaveLength(2);
      expect(query['predicates.count']).toEqual({ $lte: 2 });
    });
  });

  describe('when there is a disallow-future predicate limit', () => {
    it('returns query with $or for full vs non-full paths', () => {
      const predLimitations = [
        { predicate: 'http://blocked1.org', lims: ['disallow-future'] as const },
        { predicate: 'http://blocked2.org', lims: ['disallow-future'] as const }
      ];

      const process = createMockProcess({
        maxPathLength: 4,
        maxPathProps: 2,
        predLimitations
      });

      const query = genTraversalPathQuery(process) as TraversalPathQueryWithExpr;

      expect(query.processId).toBe('test-pid');
      expect(query.status).toBe('active');
      expect(query['nodes.count']).toEqual({ $lt: 4 });
      expect(query['predicates.count']).toEqual({ $lte: 2 });
      // With future constraints, we have $or
      expect(query.$or).toBeDefined();
      expect(query.$or).toHaveLength(2);
    });

    it('creates $or with disallow-future constraint for full paths', () => {
      const predLimitations = [
        { predicate: 'http://blocked.org', lims: ['disallow-future'] as const }
      ];

      const process = createMockProcess({
        maxPathProps: 2,
        predLimitations
      });

      const query = genTraversalPathQuery(process) as TraversalPathQueryWithExpr;

      expect(query.$or).toBeDefined();
      expect(query.$or).toHaveLength(2);
      expect(query['predicates.count']).toEqual({ $lte: 2 });
    });
  });

  describe('edge cases', () => {
    it('handles empty predLimitations array - no filter added', () => {
      const process = createMockProcess({
        maxPathProps: 2,
        predLimitations: []
      });

      const query = genTraversalPathQuery(process);

      // With empty predLimitations, no filters should be added
      expect(query['predicates.elems']).toBeUndefined();
      expect(query.$expr).toBeUndefined();
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
      config: { manager: { pathType } }
    });

    beforeEach(() => {
      const mockLean = vi.fn().mockResolvedValue(mockDomains);
      Domain.find.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          lean: mockLean
        })
      }));
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
        'head.domain.origin': { $in: mockDomains.map((d) => d.origin) }
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
      Domain.find.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([])
        })
      }));
      const process = mockProcess('pid-4', 'traversal');

      const result = await hasPathsDomainRobotsChecking(process);
      expect(result).toBe(false);
      expect(Path.countDocuments).not.toHaveBeenCalled();
    });
  });

  describe('hasPathsHeadBeingCrawled', () => {
    const mockCrawlingDomains = [
      { origin: 'http://crawling1.com' },
      { origin: 'http://crawling2.com' }
    ];
    const mockProcess = (
      pid: string = 'test-pid',
      pathType: 'traversal' | 'endpoint' = 'traversal'
    ): ProcessClass => ({
      pid,
      config: { manager: { pathType } }
    });

    beforeEach(() => {
      const mockLean = vi.fn().mockResolvedValue(mockCrawlingDomains);
      Domain.find.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          lean: mockLean
        })
      }));
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
        'head.domain.origin': { $in: mockCrawlingDomains.map((d) => d.origin) }
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
        'head.domain.origin': { $in: mockCrawlingDomains.map((d) => d.origin) }
      });
    });

    it('returns false when no paths have head in crawling domains', async () => {
      const process = mockProcess('pid-3', 'endpoint');
      Path.countDocuments.mockResolvedValueOnce(0);

      const result = await hasPathsHeadBeingCrawled(process);
      expect(result).toBe(false);
    });

    it('returns false when no domains are crawling (early return)', async () => {
      Domain.find.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([])
        })
      }));
      const process = mockProcess('pid-4', 'traversal');

      const result = await hasPathsHeadBeingCrawled(process);
      expect(result).toBe(false);
      expect(Path.countDocuments).not.toHaveBeenCalled();
    });
  });

  describe('require-past semantics', () => {
    it('require-past with multiple predicates uses $expr setIsSubset', () => {
      const process = createMockProcess({
        maxPathProps: 3,
        predLimitations: [
          { predicate: 'http://p1.org', lims: ['require-past'] as const },
          { predicate: 'http://p2.org', lims: ['require-past'] as const }
        ]
      });

      const query = genTraversalPathQuery(process);

      expect(query.$expr).toEqual({
        $setIsSubset: ['$predicates.elems', ['http://p1.org', 'http://p2.org']]
      });
    });

    it('require-past with single predicate uses direct value', () => {
      const process = createMockProcess({
        maxPathProps: 2,
        predLimitations: [{ predicate: 'http://only.org', lims: ['require-past'] as const }]
      });

      const query = genTraversalPathQuery(process);

      expect(query['predicates.elems']).toEqual('http://only.org');
    });

    it('require-past and disallow-past with multiple require-past uses $expr setIsSubset in $and', () => {
      const process = createMockProcess({
        maxPathProps: 2,
        predLimitations: [
          { predicate: 'http://p1.org', lims: ['require-past'] as const },
          { predicate: 'http://p2.org', lims: ['require-past'] as const },
          { predicate: 'http://blocked.org', lims: ['disallow-past'] as const },
          { predicate: 'http://blocked2.org', lims: ['disallow-past'] as const }
        ]
      });

      const query = genTraversalPathQuery(process);

      expect(query.$and).toBeDefined();
      expect(query.$and).toHaveLength(2);
      expect(query.$and[0]).toEqual({
        $expr: { $setIsSubset: ['$predicates.elems', ['http://p1.org', 'http://p2.org']] }
      });
      expect(query.$and[1]).toEqual({
        'predicates.elems': { $nin: ['http://blocked.org', 'http://blocked2.org'] }
      });
    });
  });
});

describe('buildStepPathQuery', () => {
  const createMockProcess = (overrides: Partial<ProcessClass> = {}): ProcessClass =>
    ({
      pid: 'test-pid',
      currentStep: {
        maxPathLength: 6,
        maxPathProps: 2,
        predLimitations: [
          { predicate: 'http://purl.org/dc/terms/subject', lims: ['require-past'] },
          { predicate: 'http://dbpedia.org/ontology/wikiPageWikiLink', lims: ['disallow-past'] }
        ]
      },
      pathExtensionCounter: 5,
      ...overrides
    }) as ProcessClass;

  it('returns traversal query with predicate filters for traversal path type', () => {
    const process = createMockProcess();
    const query = buildStepPathQuery(process, PathType.TRAVERSAL);

    expect(query.processId).toBe('test-pid');
    expect(query.status).toBe('active');
    expect(query['head.type']).toBe('url');
    expect(query['head.domain.isUnvisited']).toBe(false);
    expect(query['head.status']).toBe('unvisited');
    expect(query['nodes.count']).toEqual({ $lt: 6 });
    expect(query['predicates.count']).toEqual({ $lte: 2 });
    // With both require-past and disallow-past, we use $and to combine the filters
    expect(query.$and).toBeDefined();
    expect(query.$and).toHaveLength(2);
    // First condition: require-past (single element, so direct value)
    expect(query.$and[0]).toEqual({ 'predicates.elems': 'http://purl.org/dc/terms/subject' });
    // Second condition: disallow-past (single element, so $ne)
    expect(query.$and[1]).toEqual({
      'predicates.elems': { $ne: 'http://dbpedia.org/ontology/wikiPageWikiLink' }
    });
  });

  it('returns endpoint query with shortestPathLength for endpoint path type', () => {
    const process = createMockProcess();
    const query = buildStepPathQuery(process, PathType.ENDPOINT);

    expect(query.processId).toBe('test-pid');
    expect(query.status).toBe('active');
    expect(query['head.type']).toBe('url');
    expect(query['head.domain.isUnvisited']).toBe(false);
    expect(query['head.status']).toBe('unvisited');
    expect(query.shortestPathLength).toEqual({ $lt: 6 });
    expect(query['predicates.elems']).toBeUndefined();
  });

  it('does not include head.domain.origin filter', () => {
    const process = createMockProcess();
    const traversalQuery = buildStepPathQuery(process, PathType.TRAVERSAL);
    const endpointQuery = buildStepPathQuery(process, PathType.ENDPOINT);

    expect(traversalQuery['head.domain.origin']).toBeUndefined();
    expect(endpointQuery['head.domain.origin']).toBeUndefined();
  });

  it('does not include cursor fields', () => {
    const process = createMockProcess();
    const traversalQuery = buildStepPathQuery(process, PathType.TRAVERSAL);
    const endpointQuery = buildStepPathQuery(process, PathType.ENDPOINT);

    // Should not have cursor pagination fields
    expect(traversalQuery['nodes.count'] && traversalQuery['nodes.count'].$gt).toBeUndefined();
    expect(traversalQuery.createdAt && traversalQuery.createdAt.$gt).toBeUndefined();
    expect(traversalQuery._id && traversalQuery._id.$gt).toBeUndefined();

    expect(
      endpointQuery.shortestPathLength && endpointQuery.shortestPathLength.$gt
    ).toBeUndefined();
    expect(endpointQuery.createdAt && endpointQuery.createdAt.$gt).toBeUndefined();
    expect(endpointQuery._id && endpointQuery._id.$gt).toBeUndefined();
  });
});
