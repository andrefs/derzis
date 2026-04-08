import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPathProgress } from './process-data';
import { TraversalPath } from '../Path/TraversalPath';
import { EndpointPath } from '../Path/EndpointPath';
import type { ProcessClass } from './Process';
import { PathType } from '@derzis/common';

// Mock config
vi.mock('@derzis/config', () => ({
  default: {
    manager: {
      pathType: 'traversal',
      predicates: {
        branchingFactor: {
          neutralZone: { min: 0.5, max: 2 }
        }
      }
    }
  }
}));

vi.mock('../Path/TraversalPath', () => ({
  TraversalPath: {
    countDocuments: vi.fn()
  }
}));

vi.mock('../Path/EndpointPath', () => ({
  EndpointPath: {
    countDocuments: vi.fn()
  }
}));

describe('getPathProgress', () => {
  const mockProcess = {
    pid: 'test-pid-123',
    currentStep: {
      seeds: ['http://example.com/seed1', 'http://example.com/seed2']
    }
  } as unknown as ProcessClass;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return zero counts when no paths exist for traversal', async () => {
    mockProcess.curPathType = PathType.TRAVERSAL;
    TraversalPath.countDocuments = vi.fn().mockResolvedValue(0);
    // Also mock EndpointPath in case
    EndpointPath.countDocuments = vi.fn().mockResolvedValue(0);

    const result = await getPathProgress(mockProcess);

    expect(result.done).toBe(0);
    expect(result.remaining.unvisited).toBe(0);
    expect(result.remaining.crawling).toBe(0);
    expect(result.remaining.checking).toBe(0);
    expect(result.total).toBe(0);
  });

  it('should return zero counts when no paths exist for endpoint', async () => {
    mockProcess.curPathType = PathType.ENDPOINT;
    EndpointPath.countDocuments = vi.fn().mockResolvedValue(0);
    TraversalPath.countDocuments = vi.fn().mockResolvedValue(0);

    const result = await getPathProgress(mockProcess);

    expect(result.done).toBe(0);
    expect(result.remaining.unvisited).toBe(0);
    expect(result.total).toBe(0);
  });

  it('should return correct counts when paths exist for endpoint', async () => {
    mockProcess.curPathType = PathType.ENDPOINT;
    const remainingCount = 3;
    const doneCount = 8;
    EndpointPath.countDocuments = vi.fn().mockImplementation(async (query: any) => {
      if (query['head.status'] === 'unvisited') {
        return remainingCount;
      }
      if (query['head.status'] === 'done') {
        return doneCount;
      }
      return 0;
    });
    TraversalPath.countDocuments = vi.fn().mockResolvedValue(0); // not used

    const result = await getPathProgress(mockProcess);

    expect(result.done).toBe(doneCount);
    expect(result.remaining.unvisited).toBe(remainingCount);
    expect(result.total).toBe(doneCount + remainingCount);
  });

  it('should use process ID and correct filters', async () => {
    mockProcess.curPathType = PathType.TRAVERSAL;
    const mockCount = vi.fn().mockResolvedValue(0);
    TraversalPath.countDocuments = mockCount;

    await getPathProgress(mockProcess);

    // We expect two calls: one for done, one for remaining
    expect(mockCount).toHaveBeenCalledTimes(2);
    // Both calls should include processId
    expect(mockCount).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ processId: 'test-pid-123' })
    );
    expect(mockCount).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ processId: 'test-pid-123' })
    );
  });

  it('should return object with correct structure', async () => {
    mockProcess.curPathType = PathType.TRAVERSAL;
    TraversalPath.countDocuments = vi.fn().mockResolvedValue(0);

    const result = await getPathProgress(mockProcess);

    expect(result).toHaveProperty('done');
    expect(result).toHaveProperty('remaining');
    expect(result).toHaveProperty('total');
    expect(result.remaining).toHaveProperty('unvisited');
    expect(result.remaining).toHaveProperty('crawling');
    expect(result.remaining).toHaveProperty('checking');
  });
});
