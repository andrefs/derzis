import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calcProcMetrics,
  getPredicateCounts,
  getSeedCoverage,
  getBranchingFactor,
  getGlobalMetrics
} from './process-metrics';

vi.mock('../ProcessTriple', () => ({
  ProcessTriple: {
    aggregate: vi.fn(() => Promise.resolve([])),
    countDocuments: vi.fn(() => Promise.resolve(0))
  }
}));

vi.mock('../Triple', () => ({
  Triple: {
    aggregate: vi.fn(() => Promise.resolve([]))
  }
}));

import { ProcessTriple } from '../ProcessTriple';
import { Triple } from '../Triple';

describe('process-metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPredicateCounts', () => {
    it('should return predicate counts from processTriples', async () => {
      vi.mocked(ProcessTriple.aggregate).mockResolvedValue([
        { _id: 'http://example.org/predicate1', count: 100 },
        { _id: 'http://example.org/predicate2', count: 50 }
      ]);

      const result = await getPredicateCounts('test-pid');

      expect(result).toHaveLength(2);
      expect(result[0]._id).toBe('http://example.org/predicate1');
      expect(result[0].count).toBe(100);
    });

    it('should return empty array when no triples', async () => {
      vi.mocked(ProcessTriple.aggregate).mockResolvedValue([]);

      const result = await getPredicateCounts('test-pid');

      expect(result).toHaveLength(0);
    });
  });

  describe('getSeedCoverage', () => {
    it('should return 0 when seeds array is empty', async () => {
      const result = await getSeedCoverage(
        'test-pid',
        'http://example.org/predicate',
        'subject',
        []
      );
      expect(result).toBe(0);
    });

    it('should return 0 when seeds is undefined', async () => {
      const result = await getSeedCoverage(
        'test-pid',
        'http://example.org/predicate',
        'subject',
        undefined as any
      );
      expect(result).toBe(0);
    });

    it('should return coverage count matching seeds', async () => {
      vi.mocked(ProcessTriple.aggregate).mockResolvedValue([{ coverage: 3 }]);

      const result = await getSeedCoverage('test-pid', 'http://example.org/predicate', 'subject', [
        'http://example.org/seed1',
        'http://example.org/seed2'
      ]);

      expect(result).toBe(3);
    });

    it('should return 0 when no matches', async () => {
      vi.mocked(ProcessTriple.aggregate).mockResolvedValue([]);

      const result = await getSeedCoverage('test-pid', 'http://example.org/predicate', 'subject', [
        'http://example.org/seed1'
      ]);

      expect(result).toBe(0);
    });
  });

  describe('getBranchingFactor', () => {
    it('should return subj and obj counts', async () => {
      vi.mocked(Triple.aggregate)
        .mockResolvedValueOnce([{ count: 10 }])
        .mockResolvedValueOnce([{ count: 5 }]);

      const result = await getBranchingFactor('test-pid', 'http://example.org/predicate');

      expect(result.subj).toBe(10);
      expect(result.obj).toBe(5);
    });

    it('should return zeros when no triples match', async () => {
      vi.mocked(ProcessTriple.aggregate).mockResolvedValue([]);

      const result = await getBranchingFactor('test-pid', 'http://example.org/predicate');

      expect(result.subj).toBe(0);
      expect(result.obj).toBe(0);
    });
  });

  describe('getGlobalMetrics', () => {
    it('should return all metrics', async () => {
      vi.mocked(ProcessTriple.countDocuments).mockResolvedValue(150);
      vi.mocked(ProcessTriple.aggregate)
        .mockResolvedValueOnce([{ totalSubjects: 50 }])
        .mockResolvedValueOnce([{ totalObjects: 40 }])
        .mockResolvedValueOnce([{ totalResources: 80 }]);

      const result = await getGlobalMetrics('test-pid');

      expect(result.totalTriples).toBe(150);
      expect(result.totalSubjects).toBe(50);
      expect(result.totalObjects).toBe(40);
      expect(result.totalResources).toBe(80);
    });

    it('should return zeros when no data', async () => {
      vi.mocked(ProcessTriple.countDocuments).mockResolvedValue(0);
      vi.mocked(ProcessTriple.aggregate)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await getGlobalMetrics('test-pid');

      expect(result.totalTriples).toBe(0);
      expect(result.totalSubjects).toBe(0);
      expect(result.totalObjects).toBe(0);
      expect(result.totalResources).toBe(0);
    });
  });

  describe('calcProcMetrics', () => {
    it('should calculate all metrics for predicates', async () => {
      vi.mocked(ProcessTriple.countDocuments).mockResolvedValue(100);
      vi.mocked(ProcessTriple.aggregate)
        .mockResolvedValueOnce([{ _id: 'http://example.org/predicate1', count: 100 }]) // getPredicateCounts
        .mockResolvedValueOnce([{ coverage: 3 }]) // getSeedCoverage 1
        .mockResolvedValueOnce([]) // getSeedCoverage 2
        .mockResolvedValueOnce([{ totalSubjects: 50 }]) // getGlobalMetrics totalSubjects
        .mockResolvedValueOnce([{ totalObjects: 40 }]) // getGlobalMetrics totalObjects
        .mockResolvedValueOnce([{ totalResources: 80 }]); // getGlobalMetrics totalResources
      vi.mocked(Triple.aggregate)
        .mockResolvedValueOnce([{ count: 10 }]) // getBranchingFactor subjects
        .mockResolvedValueOnce([{ count: 5 }]); // getBranchingFactor objects

      const result = await calcProcMetrics('test-pid', [
        'http://example.org/seed1',
        'http://example.org/seed2',
        'http://example.org/seed3'
      ]);

      expect(result.predicates).toHaveLength(1);
      expect(result.predicates[0].url).toBe('http://example.org/predicate1');
      expect(result.predicates[0].count).toBe(100);
      expect(result.predicates[0].subjCov).toBe(3);
      expect(result.predicates[0].objCov).toBe(0);
      expect(result.predicates[0].branchFactor.subj).toBe(10);
      expect(result.predicates[0].branchFactor.obj).toBe(5);
      expect(result.globalMetrics.totalTriples).toBe(100);
    });
  });
});
