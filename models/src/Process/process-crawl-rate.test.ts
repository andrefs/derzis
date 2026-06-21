import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCrawlRate } from './process-data';
import { ProcessDoneResource } from '../ProcessDoneResource';
import { Resource } from '../Resource';

vi.mock('../ProcessDoneResource', () => {
  const mockLean = vi.fn();
  const mockFind = vi.fn(() => ({ lean: mockLean }));
  return {
    ProcessDoneResource: { find: mockFind },
    __mockFind: mockFind,
    __mockLean: mockLean
  };
});

vi.mock('../Resource', () => ({
  Resource: {
    countDocuments: vi.fn()
  }
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
    (ProcessDoneResource.find as any)().lean.mockResolvedValue([
      { resource: 'id1' },
      { resource: 'id2' },
      { resource: 'id3' }
    ]);
    vi.mocked(Resource.countDocuments).mockResolvedValue(60);

    const result = await getCrawlRate(mockProcess as any, 5);

    expect(result).toBe(12);
  });

  it('should return 0 when no resources exist', async () => {
    (ProcessDoneResource.find as any)().lean.mockResolvedValue([{ resource: 'id1' }]);
    vi.mocked(Resource.countDocuments).mockResolvedValue(0);

    const result = await getCrawlRate(mockProcess as any, 5);

    expect(result).toBe(0);
  });

  it('should return 0 when no process-done resources tracked', async () => {
    (ProcessDoneResource.find as any)().lean.mockResolvedValue([]);

    const result = await getCrawlRate(mockProcess as any, 5);

    expect(result).toBe(0);
  });

  it('should use default window of 5 minutes', async () => {
    (ProcessDoneResource.find as any)().lean.mockResolvedValue([{ resource: 'id1' }]);
    vi.mocked(Resource.countDocuments).mockResolvedValue(30);

    const result = await getCrawlRate(mockProcess as any);

    expect(result).toBe(6);
  });

  it('should calculate rate based on process ID', async () => {
    (ProcessDoneResource.find as any)().lean.mockResolvedValue([]);

    await getCrawlRate(mockProcess as any, 5);

    expect(ProcessDoneResource.find).toHaveBeenCalledWith(
      { processId: 'test-pid-123' },
      { resource: 1, _id: 0 }
    );
  });

  it('should filter resources by status done and updatedAt in window', async () => {
    (ProcessDoneResource.find as any)().lean.mockResolvedValue([{ resource: 'id1' }]);
    vi.mocked(Resource.countDocuments).mockResolvedValue(10);

    await getCrawlRate(mockProcess as any, 5);

    const cutoffTime = new Date(Date.now() - 5 * 60 * 1000);
    const countCallArgs = vi.mocked(Resource.countDocuments).mock.calls[0]![0] as any;
    expect(countCallArgs).toMatchObject({
      status: 'done'
    });
    expect(countCallArgs.updatedAt.$gte.getTime()).toBeCloseTo(cutoffTime.getTime(), -2);
  });
});
