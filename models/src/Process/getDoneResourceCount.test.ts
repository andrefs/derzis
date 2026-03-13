import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDoneResourceCount } from './process-data';
import { ProcessTriple } from '../ProcessTriple';
import { Resource } from '../Resource';
import { Triple } from '../Triple';
import type { ProcessClass } from './Process';

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

describe('getDoneResourceCount', () => {
  const mockProcess = {
    pid: 'test-pid-123'
  } as unknown as ProcessClass;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return count of done resources', async () => {
    // Mock aggregation result
    const mockAggregateResult = [{ count: 5 }];
    
    vi.spyOn(ProcessTriple, 'aggregate').mockResolvedValue(mockAggregateResult as any);

    const result = await getDoneResourceCount(mockProcess);

    expect(result).toBe(5);
    expect(ProcessTriple.aggregate).toHaveBeenCalledWith(
      [
        {
          $match: {
            processId: 'test-pid-123'
          }
        },
        { $group: { _id: '$triple' } },
        {
          $lookup: {
            from: 'triples',
            localField: '_id',
            foreignField: '_id',
            as: 'ts'
          }
        },
        {
          $unwind: {
            path: '$ts',
            preserveNullAndEmptyArrays: true
          }
        },
        { $project: { sources: '$ts.sources' } },
        {
          $unwind: {
            path: '$sources',
            preserveNullAndEmptyArrays: true
          }
        },
        // group by source to avoid duplicates
        { $group: { _id: '$sources' } },
        {
          $lookup: {
            from: 'resources',
            let: { resourceUrl: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: ['$url', '$$resourceUrl']
                  }
                }
              },
              {
                $match: {
                  status: 'done'
                }
              }
            ],
            as: 'doneResources'
          }
        },
        { $match: { 'doneResources.0': { $exists: true } } },
        { $count: 'count' }
      ],
      { maxTimeMS: 60000, allowDiskUse: true }
    );
  });

  it('should return 0 when no done resources found', async () => {
    // Mock aggregation result with empty array
    const mockAggregateResult: any[] = [];
    
    vi.spyOn(ProcessTriple, 'aggregate').mockResolvedValue(mockAggregateResult);

    const result = await getDoneResourceCount(mockProcess);

    expect(result).toBe(0);
  });
});