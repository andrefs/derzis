import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCrawlRate } from './process-data';
import { Resource } from '../Resource';

vi.mock('../Resource', () => ({
  Resource: { aggregate: vi.fn() }
}));

describe('getCrawlRate', () => {
  const mockProcess = {
    pid: 'test-pid-123',
    currentStep: {
      seeds: ['http://example.com/seed1', 'http://example.com/seed2']
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return crawl rate in resources per minute', async () => {
    vi.mocked(Resource.aggregate).mockResolvedValue([{ count: 60 }]);

    const result = await getCrawlRate(mockProcess as any, 5);

    expect(result).toBe(12);
  });

  it('should return 0 when no resources exist', async () => {
    vi.mocked(Resource.aggregate).mockResolvedValue([]);

    const result = await getCrawlRate(mockProcess as any, 5);

    expect(result).toBe(0);
  });

  it('should return 0 when no process-done resources tracked', async () => {
    vi.mocked(Resource.aggregate).mockResolvedValue([]);

    const result = await getCrawlRate(mockProcess as any, 5);

    expect(result).toBe(0);
  });

  it('should use default window of 5 minutes', async () => {
    vi.mocked(Resource.aggregate).mockResolvedValue([{ count: 30 }]);

    const result = await getCrawlRate(mockProcess as any);

    expect(result).toBe(6);
  });

  it('should pass pipeline with processId, status done, and updatedAt filter', async () => {
    vi.mocked(Resource.aggregate).mockResolvedValue([{ count: 10 }]);

    await getCrawlRate(mockProcess as any, 5);

    const cutoffTime = new Date(Date.now() - 5 * 60 * 1000);
    const pipeline = vi.mocked(Resource.aggregate).mock.calls[0]![0] as any[];

    expect(pipeline[0].$match).toMatchObject({ status: 'done' });
    expect(pipeline[0].$match.updatedAt.$gte.getTime()).toBeCloseTo(cutoffTime.getTime(), -2);

    const lookupStage = pipeline[1].$lookup;
    expect(lookupStage.from).toBe('processDoneResources');
    expect(lookupStage.pipeline[0].$match.processId).toBe('test-pid-123');
  });
});
