import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCrawlRate } from './process-data';
import { Resource } from '../Resource';

vi.mock('../Resource', () => ({
  Resource: {
    countDocuments: vi.fn(),
  },
}));

describe('getCrawlRate', () => {
  const mockProcess = {
    pid: 'test-pid-123',
    currentStep: {
      seeds: ['http://example.com/seed1', 'http://example.com/seed2'],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return crawl rate in resources per minute', async () => {
    vi.mocked(Resource.countDocuments).mockResolvedValue(60);

    const result = await getCrawlRate(mockProcess as any, 5);

    expect(result).toBe(12);
  });

  it('should return 0 when no resources exist', async () => {
    vi.mocked(Resource.countDocuments).mockResolvedValue(0);

    const result = await getCrawlRate(mockProcess as any, 5);

    expect(result).toBe(0);
  });

  it('should use default window of 5 minutes', async () => {
    vi.mocked(Resource.countDocuments).mockResolvedValue(30);

    const result = await getCrawlRate(mockProcess as any);

    expect(result).toBe(6);
  });

  it('should calculate rate based on process ID', async () => {
    vi.mocked(Resource.countDocuments).mockResolvedValue(10);

    await getCrawlRate(mockProcess as any, 5);

    expect(Resource.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        processId: 'test-pid-123'
      })
    );
  });
});
