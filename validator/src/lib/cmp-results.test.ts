import { describe, it, expect } from 'vitest';
import { cmpGraphPreConds } from './cmp-results';
import { ProcessInfo } from './types';

describe('cmpGraphPreConds', () => {
  it('should return true for identical ProcessInfo objects', () => {
    const info1 = {
      steps: [
        {
          maxPathLength: 3,
          maxPathProps: 5,
          seeds: ['A', 'B'],
          whiteList: ['C'],
          blackList: ['D']
        }
      ]
    } as ProcessInfo;
    const info2 = { ...info1 };
    expect(cmpGraphPreConds(info1, info2)).toBe(true);
  })

  it('should return false for different number of steps', () => {
    const info1 = {
      steps: [
        {
          maxPathLength: 3,
          maxPathProps: 5,
          seeds: ['A'],
          whiteList: [] as string[],
          blackList: [] as string[]
        }
      ]
    } as ProcessInfo;
    const info2 = {
      steps: [
        {
          maxPathLength: 3,
          maxPathProps: 5,
          seeds: ['A'],
          whiteList: [] as string[],
          blackList: [] as string[]
        },
        {
          maxPathLength: 4,
          maxPathProps: 6,
          seeds: ['B'],
          whiteList: [] as string[],
          blackList: [] as string[]
        }
      ]
    } as ProcessInfo;
    expect(cmpGraphPreConds(info1, info2)).toBe(false);
  });

  it('should return false for different maxPathLength', () => {
    const info1 = {
      steps: [
        {
          maxPathLength: 3,
          maxPathProps: 5,
          seeds: ['A'],
          whiteList: [] as string[],
          blackList: [] as string[]
        }
      ]
    } as ProcessInfo;
    const info2 = {
      steps: [
        {
          maxPathLength: 4,
          maxPathProps: 5,
          seeds: ['A'],
          whiteList: [] as string[],
          blackList: [] as string[]
        }
      ]
    } as ProcessInfo;
    expect(cmpGraphPreConds(info1, info2)).toBe(false);
  });

  it('should return false for different maxPathProps', () => {
    const info1 = {
      steps: [
        {
          maxPathLength: 3,
          maxPathProps: 5,
          seeds: ['A'],
          whiteList: [] as string[],
          blackList: [] as string[]
        }
      ]
    } as ProcessInfo;
    const info2 = {
      steps: [
        {
          maxPathLength: 3,
          maxPathProps: 6,
          seeds: ['A'],
          whiteList: [] as string[],
          blackList: [] as string[]
        }
      ]
    } as ProcessInfo;
    expect(cmpGraphPreConds(info1, info2)).toBe(false);
  });

  it('should return false for different seeds', () => {
    const info1 = {
      steps: [
        {
          maxPathLength: 3,
          maxPathProps: 5,
          seeds: ['A', 'B'],
          whiteList: [] as string[],
          blackList: [] as string[]
        }
      ]
    } as ProcessInfo;
    const info2 = {
      steps: [
        {
          maxPathLength: 3,
          maxPathProps: 5,
          seeds: ['A', 'C'],
          whiteList: [] as string[],
          blackList: [] as string[]
        }
      ]
    } as ProcessInfo;
    expect(cmpGraphPreConds(info1, info2)).toBe(false);
  });

  it('should return false for different whiteList', () => {
    const info1 = {
      steps: [
        {
          maxPathLength: 3,
          maxPathProps: 5,
          seeds: ['A'],
          whiteList: ['C'],
          blackList: [] as string[]
        }
      ]
    } as ProcessInfo;
    const info2 = {
      steps: [
        {
          maxPathLength: 3,
          maxPathProps: 5,
          seeds: ['A'],
          whiteList: ['D'],
          blackList: [] as string[]
        }
      ]
    } as ProcessInfo;
    expect(cmpGraphPreConds(info1, info2)).toBe(false);
  });

  it('should return false for different blackList', () => {
    const info1 = {
      steps: [
        {
          maxPathLength: 3,
          maxPathProps: 5,
          seeds: ['A'],
          whiteList: [] as string[],
          blackList: ['D']
        }
      ]
    } as ProcessInfo;
    const info2 = {
      steps: [
        {
          maxPathLength: 3,
          maxPathProps: 5,
          seeds: ['A'],
          whiteList: [] as string[],
          blackList: ['E']
        }
      ]
    } as ProcessInfo;
    expect(cmpGraphPreConds(info1, info2)).toBe(false);
  });

  it('should handle empty seeds, whiteList, blackList', () => {
    const info1 = {
      steps: [
        {
          maxPathLength: 3,
          maxPathProps: 5,
          seeds: [] as string[],
          whiteList: [] as string[],
          blackList: [] as string[]
        }
      ]
    } as ProcessInfo;
    const info2 = { ...info1 };
    expect(cmpGraphPreConds(info1, info2)).toBe(true);
  });

  it('should handle missing seeds, whiteList, blackList', () => {
    const info1 = {
      steps: [
        {
          maxPathLength: 3,
          maxPathProps: 5
        }
      ]
    } as ProcessInfo;
    const info2 = { ...info1 };
    expect(cmpGraphPreConds(info1, info2)).toBe(true);
  });
});

