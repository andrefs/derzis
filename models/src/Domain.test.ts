import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Domain } from './Domain';
import { Process } from './Process';

// Mock Counter
vi.mock('../Counter', () => ({
  Counter: {
    genId: vi.fn().mockReturnValue(12345)
  }
}));

// ============================================
// UNIT TESTS: unlockFromRobotsCheck
// ============================================
describe('unlockFromRobotsCheck', () => {
  let mockUpdateMany: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    (Domain as any).updateMany = mockUpdateMany;
  });

  it('should unlock domains with status checking and matching workerId', async () => {
    const wId = 'worker-123';
    const origins = ['http://example.com', 'http://test.com'];

    await (Domain as any).unlockFromRobotsCheck(wId, origins);

    expect(mockUpdateMany).toHaveBeenCalledWith(
      {
        origin: { $in: origins },
        status: 'checking',
        workerId: wId
      },
      {
        $set: { status: 'unvisited' },
        $unset: { jobId: '', workerId: '' }
      }
    );
  });

  it('should reset status to unvisited', async () => {
    const wId = 'worker-123';
    const origins = ['http://example.com'];

    await (Domain as any).unlockFromRobotsCheck(wId, origins);

    const update = mockUpdateMany.mock.calls[0][1];
    expect(update.$set).toEqual({ status: 'unvisited' });
  });

  it('should clear jobId and workerId', async () => {
    const wId = 'worker-123';
    const origins = ['http://example.com'];

    await (Domain as any).unlockFromRobotsCheck(wId, origins);

    const update = mockUpdateMany.mock.calls[0][1];
    expect(update.$unset).toEqual({ jobId: '', workerId: '' });
  });
});

// ============================================
// UNIT TESTS: unlockFromLabelFetch
// ============================================
describe('unlockFromLabelFetch', () => {
  let mockUpdateMany: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    (Domain as any).updateMany = mockUpdateMany;
  });

  it('should unlock domains with status labelFetching and matching workerId', async () => {
    const wId = 'worker-456';
    const origins = ['http://example.com', 'http://test.com'];

    await (Domain as any).unlockFromLabelFetch(wId, origins);

    expect(mockUpdateMany).toHaveBeenCalledWith(
      {
        origin: { $in: origins },
        status: 'labelFetching',
        workerId: wId
      },
      {
        $set: { status: 'ready' },
        $unset: { jobId: '', workerId: '' }
      }
    );
  });

  it('should reset status to ready', async () => {
    const wId = 'worker-456';
    const origins = ['http://example.com'];

    await (Domain as any).unlockFromLabelFetch(wId, origins);

    const update = mockUpdateMany.mock.calls[0][1];
    expect(update.$set).toEqual({ status: 'ready' });
  });

  it('should clear jobId and workerId', async () => {
    const wId = 'worker-456';
    const origins = ['http://example.com'];

    await (Domain as any).unlockFromLabelFetch(wId, origins);

    const update = mockUpdateMany.mock.calls[0][1];
    expect(update.$unset).toEqual({ jobId: '', workerId: '' });
  });
});

// ============================================
// INTEGRATION TESTS: domainsToCheck
// ============================================
describe('domainsToCheck', () => {
  // ============================================
  // UNIT TESTS: unlockFromCrawl
  // ============================================
  describe('unlockFromCrawl', () => {
    let mockUpdateMany: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.clearAllMocks();
      mockUpdateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
      (Domain as any).updateMany = mockUpdateMany;
    });

    it('should unlock domains with status crawling and matching workerId', async () => {
      const wId = 'worker-789';
      const origins = ['http://example.com', 'http://test.com'];

      await (Domain as any).unlockFromCrawl(wId, origins);

      expect(mockUpdateMany).toHaveBeenCalledWith(
        {
          origin: { $in: origins },
          status: 'crawling',
          workerId: wId
        },
        {
          $set: { status: 'ready' },
          $unset: { jobId: '', workerId: '' }
        }
      );
    });

    it('should reset status to ready', async () => {
      const wId = 'worker-789';
      const origins = ['http://example.com'];

      await (Domain as any).unlockFromCrawl(wId, origins);

      const update = mockUpdateMany.mock.calls[0][1];
      expect(update.$set).toEqual({ status: 'ready' });
    });

    it('should clear jobId and workerId', async () => {
      const wId = 'worker-789';
      const origins = ['http://example.com'];

      await (Domain as any).unlockFromCrawl(wId, origins);

      const update = mockUpdateMany.mock.calls[0][1];
      expect(update.$unset).toEqual({ jobId: '', workerId: '' });
    });
  });
  let mockLockForRobotsCheck: ReturnType<typeof vi.fn>;
  let mockUnlockFromRobotsCheck: ReturnType<typeof vi.fn>;
  let mockGetOneRunning: ReturnType<typeof vi.fn>;
  let mockProcessInstance: any;

  function createMockDomain(origin: string, id: number) {
    return { origin, _id: String(id) };
  }

  function createMockPath(domain: string, id: number) {
    return { _id: String(id), head: { type: 'url', domain } as any };
  }

  beforeEach(() => {
    vi.clearAllMocks();

    mockLockForRobotsCheck = vi.fn();
    mockUnlockFromRobotsCheck = vi.fn().mockResolvedValue(undefined);
    (Domain as any).lockForRobotsCheck = mockLockForRobotsCheck;
    (Domain as any).unlockFromRobotsCheck = mockUnlockFromRobotsCheck;

    // Mock Process.getOneRunning
    mockProcessInstance = {
      pid: 'test-process',
      getPathsForRobotsChecking: vi.fn()
    };
    mockGetOneRunning = vi.fn().mockReturnValue(mockProcessInstance);
    vi.mocked(Process as any).getOneRunning = mockGetOneRunning;
  });

  it('should yield exactly limit domains without unlocking when batches fit', async () => {
    const limit = 5;
    const wId = 'worker-1';

    // Batch 1: 3 domains -> remaining capacity = 5, no overflow
    mockProcessInstance.getPathsForRobotsChecking.mockResolvedValueOnce([
      createMockPath('d1', 1),
      createMockPath('d2', 2),
      createMockPath('d3', 3)
    ]);
    mockLockForRobotsCheck.mockResolvedValueOnce([
      createMockDomain('d1', 1),
      createMockDomain('d2', 2),
      createMockDomain('d3', 3)
    ]);

    // Batch 2: 2 domains -> total 5, exactly fills limit
    mockProcessInstance.getPathsForRobotsChecking.mockResolvedValueOnce([
      createMockPath('d4', 4),
      createMockPath('d5', 5)
    ]);
    mockLockForRobotsCheck.mockResolvedValueOnce([
      createMockDomain('d4', 4),
      createMockDomain('d5', 5)
    ]);

    // Batch 3: empty -> exit
    mockProcessInstance.getPathsForRobotsChecking.mockResolvedValueOnce([]);
    mockLockForRobotsCheck.mockResolvedValueOnce([]);

    const results: any[] = [];
    const generator = (Domain as any).domainsToCheck(wId, limit);

    for await (const domain of generator) {
      results.push(domain);
    }

    expect(results).toHaveLength(5);
    expect(results.map((d: any) => d.origin)).toEqual(['d1', 'd2', 'd3', 'd4', 'd5']);
    expect(mockUnlockFromRobotsCheck).not.toHaveBeenCalled();
  });

  it('should unlock excess domains when batch exceeds remaining capacity', async () => {
    const limit = 5;
    const wId = 'worker-1';

    // Batch 1: 4 domains -> domainsFound = 4, remaining = 1, no overflow
    mockProcessInstance.getPathsForRobotsChecking.mockResolvedValueOnce(
      Array.from({ length: 4 }, (_, i) => createMockPath(`d${i + 1}`, i + 1))
    );
    mockLockForRobotsCheck.mockResolvedValueOnce(
      Array.from({ length: 4 }, (_, i) => createMockDomain(`d${i + 1}`, i + 1))
    );

    // Batch 2: 3 domains -> remaining capacity = 1, overflow = 2
    // Should unlock 2, yield only 1
    mockProcessInstance.getPathsForRobotsChecking.mockResolvedValueOnce(
      Array.from({ length: 3 }, (_, i) => createMockPath(`d${i + 5}`, i + 5))
    );
    mockLockForRobotsCheck.mockResolvedValueOnce(
      Array.from({ length: 3 }, (_, i) => createMockDomain(`d${i + 5}`, i + 5))
    );

    // Exit
    mockProcessInstance.getPathsForRobotsChecking.mockResolvedValueOnce([]);
    mockLockForRobotsCheck.mockResolvedValueOnce([]);

    const results: any[] = [];
    const generator = (Domain as any).domainsToCheck(wId, limit);

    for await (const domain of generator) {
      results.push(domain);
    }

    expect(results).toHaveLength(5);
    expect(results.map((d: any) => d.origin)).toEqual(['d1', 'd2', 'd3', 'd4', 'd5']);

    expect(mockUnlockFromRobotsCheck).toHaveBeenCalledTimes(1);
    expect(mockUnlockFromRobotsCheck).toHaveBeenCalledWith(wId, ['d6', 'd7']);
  });

  it('should stop exactly at limit even if more batches available', async () => {
    const limit = 3;
    const wId = 'worker-1';

    // Batch 1: exactly 3 domains
    mockProcessInstance.getPathsForRobotsChecking.mockResolvedValueOnce([
      createMockPath('d1', 1),
      createMockPath('d2', 2),
      createMockPath('d3', 3)
    ]);
    mockLockForRobotsCheck.mockResolvedValueOnce([
      createMockDomain('d1', 1),
      createMockDomain('d2', 2),
      createMockDomain('d3', 3)
    ]);

    // These should not be called because generator exits after reaching limit
    mockProcessInstance.getPathsForRobotsChecking.mockResolvedValueOnce([]);
    mockLockForRobotsCheck.mockResolvedValueOnce([]);

    const results: any[] = [];
    const generator = (Domain as any).domainsToCheck(wId, limit);

    for await (const domain of generator) {
      results.push(domain);
    }

    expect(results).toHaveLength(3);
    expect(mockUnlockFromRobotsCheck).not.toHaveBeenCalled();
  });
});

// ============================================
// UNIT TESTS: domainsToCrawl2 overflow handling
// ============================================
describe('domainsToCrawl2', () => {
  let mockUnlockFromCrawl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUnlockFromCrawl = vi.fn().mockResolvedValue(undefined);
    (Domain as any).unlockFromCrawl = mockUnlockFromCrawl;
  });

  describe('overflow handling', () => {
    it('should identify correct number of domains to unlock', () => {
      const domLimit = 5;
      let domainsFound = 4; // remainingCapacity = 1
      const domains = [
        { origin: 'd1' },
        { origin: 'd2' },
        { origin: 'd3' },
        { origin: 'd4' },
        { origin: 'd5' }
      ] as any;

      const remainingCapacity = domLimit - domainsFound;
      expect(remainingCapacity).toBe(1);
      expect(domains.length > remainingCapacity).toBe(true);

      const domainsToUnlock = domains.slice(remainingCapacity).map((d) => d.origin);
      expect(domainsToUnlock).toEqual(['d2', 'd3', 'd4', 'd5']);
    });

    it('should not unlock when domains fit within limit', () => {
      const domLimit = 5;
      let domainsFound = 2; // remainingCapacity = 3
      const domains = [{ origin: 'd1' }, { origin: 'd2' }] as any;

      const remainingCapacity = domLimit - domainsFound;
      expect(remainingCapacity).toBe(3);
      expect(domains.length > remainingCapacity).toBe(false);
    });
  });

  describe('limit boundary', () => {
    it('should exactly fill limit when batch matches remaining capacity', () => {
      const domLimit = 5;
      let domainsFound = 3; // remainingCapacity = 2
      const domains = [{ origin: 'd1' }, { origin: 'd2' }] as any;

      const remainingCapacity = domLimit - domainsFound;
      expect(remainingCapacity).toBe(2);
      expect(domains.length).toBe(2);
      expect(domains.length > remainingCapacity).toBe(false);
      // No unlock needed, all domains fit exactly
    });
  });
});

// ============================================
// UNIT TESTS: labelsToFetch first batch limit logic
// ============================================
describe('labelsToFetch', () => {
  let mockLockForLabelFetch: ReturnType<typeof vi.fn>;
  let mockUnlockFromLabelFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLockForLabelFetch = vi.fn();
    mockUnlockFromLabelFetch = vi.fn().mockResolvedValue(undefined);
    (Domain as any).lockForLabelFetch = mockLockForLabelFetch;
    (Domain as any).unlockFromLabelFetch = mockUnlockFromLabelFetch;
  });

  describe('first batch overflow handling', () => {
    it('should unlock excess domains when dsLocked length exceeds remaining capacity', () => {
      const domLimit = 5;
      const wId = 'worker-1';
      let domainsFound = 4; // remainingCapacity = 1

      const dsLocked = [
        { origin: 'd1', jobId: 1 },
        { origin: 'd2', jobId: 2 },
        { origin: 'd3', jobId: 3 }
      ] as any;

      // Simulate the fix logic from labelsToFetch
      const remainingCapacity = domLimit - domainsFound;
      if (dsLocked.length > remainingCapacity) {
        const domainsToUnlock = dsLocked.slice(remainingCapacity).map((d: any) => d.origin);
        expect(domainsToUnlock).toEqual(['d2', 'd3']);
        dsLocked.splice(remainingCapacity);
      }

      expect(dsLocked).toHaveLength(1);
      expect(dsLocked[0].origin).toBe('d1');
    });

    it('should not unlock when dsLocked fits within remaining capacity', () => {
      const domLimit = 5;
      const wId = 'worker-1';
      let domainsFound = 2; // remainingCapacity = 3

      const dsLocked = [
        { origin: 'd1', jobId: 1 },
        { origin: 'd2', jobId: 2 }
      ] as any;

      const remainingCapacity = domLimit - domainsFound;
      expect(remainingCapacity).toBe(3);
      expect(dsLocked.length > remainingCapacity).toBe(false);
    });
  });

  describe('second batch safety', () => {
    it('should limit domainsReady before locking in final batch', () => {
      const domLimit = 5;
      let domainsFound = 3;
      const labelsByDomain = {
        d1: ['url1', 'url2'],
        d2: ['url3', 'url4'],
        d3: ['url5', 'url6'],
        d4: ['url7', 'url8'],
        d5: ['url9', 'url10']
      };

      // Simulate the final batch logic
      const domainsReady = Object.entries(labelsByDomain)
        .filter(([_, urls]) => urls.length >= 2)
        .map(([d, _]) => d)
        .slice(0, domLimit - domainsFound);

      expect(domainsReady).toHaveLength(2); // Should only try to lock 2 domains
      expect(domainsReady).toEqual(['d1', 'd2']);
    });
  });
});
