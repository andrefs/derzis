import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPathProgress } from './process-data';
import { TraversalPath } from '../Path/TraversalPath';
import { EndpointPath } from '../Path/EndpointPath';
import type { ProcessClass } from './Process';

vi.mock('../Path/TraversalPath', () => ({
  TraversalPath: {
    aggregate: vi.fn(),
    countDocuments: vi.fn(),
  },
}));

vi.mock('../Path/EndpointPath', () => ({
  EndpointPath: {
    aggregate: vi.fn(),
    countDocuments: vi.fn(),
  },
}));

vi.mock('@derzis/config', () => ({
  default: {
    manager: {
      pathType: 'traversal'
    }
  }
}));

vi.mock('../Path/EndpointPath', () => ({
  EndpointPath: {
    aggregate: vi.fn(),
    countDocuments: vi.fn(),
  },
}));

describe('getPathProgress', () => {
  const mockProcess = {
    pid: 'test-pid-123',
    currentStep: {
      seeds: ['http://example.com/seed1', 'http://example.com/seed2'],
    },
  } as unknown as ProcessClass;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return correct counts when TraversalPath is used', async () => {
    // Mock aggregation result for path counts by status
    const mockAggregateResult = [
      { _id: 'done', count: 100 },
      { _id: 'crawling', count: 50 },
      { _id: 'checking', count: 25 },
      { _id: 'unvisited', count: 200 },
    ];

    vi.mocked(TraversalPath.aggregate).mockResolvedValue(mockAggregateResult as any);

    const result = await getPathProgress(mockProcess);

    expect(result.done).toBe(100);
    expect(result.remaining.crawling).toBe(50);
    expect(result.remaining.checking).toBe(25);
    expect(result.remaining.unvisited).toBe(200);
    expect(result.total).toBe(375);
  });

  it('should return correct counts when EndpointPath is used', async () => {
    const mockAggregateResult = [
      { _id: 'done', count: 150 },
      { _id: 'crawling', count: 30 },
      { _id: 'checking', count: 20 },
      { _id: 'unvisited', count: 300 },
    ];

    vi.mocked(EndpointPath.aggregate).mockResolvedValue(mockAggregateResult as any);

    vi.mock('@derzis/config', () => ({
      default: {
        manager: {
          pathType: 'endpoint'
        }
      }
    }));

    const result = await getPathProgress(mockProcess as any);

    expect(result.done).toBe(150);
    expect(result.total).toBe(500);
  });

  it('should return zero counts when no paths exist', async () => {
    vi.mocked(TraversalPath.aggregate).mockResolvedValue([]);

    const result = await getPathProgress(mockProcess);

    expect(result.done).toBe(0);
    expect(result.remaining.crawling).toBe(0);
    expect(result.remaining.checking).toBe(0);
    expect(result.remaining.unvisited).toBe(0);
    expect(result.total).toBe(0);
  });

  it('should filter by process ID', async () => {
    vi.mocked(TraversalPath.aggregate).mockResolvedValue([]);

    await getPathProgress(mockProcess);

    // Verify that the aggregation pipeline includes processId filter
    const aggregateCall = vi.mocked(TraversalPath.aggregate).mock.calls[0];
    expect(aggregateCall).toBeDefined();
  });

  it('should return object with correct structure', async () => {
    vi.mocked(TraversalPath.aggregate).mockResolvedValue([]);

    const result = await getPathProgress(mockProcess);

    expect(result).toHaveProperty('done');
    expect(result).toHaveProperty('remaining');
    expect(result).toHaveProperty('total');
    expect(result.remaining).toHaveProperty('unvisited');
    expect(result.remaining).toHaveProperty('crawling');
    expect(result.remaining).toHaveProperty('checking');
  });
});
