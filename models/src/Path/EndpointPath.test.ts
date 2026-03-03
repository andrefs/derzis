import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { EndpointPathClass } from './EndpointPath';
import { Types } from 'mongoose';
import { HEAD_TYPE } from './Path';

// Helper to create a basic EndpointPathClass instance with test data
function createMockPath(overlays: any = {}): EndpointPathClass {
  const path = new EndpointPathClass();
  path.processId = 'test-process';
  path.seed = { url: 'http://seed.example.com' };
  path.head = { 
    type: HEAD_TYPE.URL, 
    url: 'http://head.example.com', 
    status: 'unvisited', 
    domain: 'http://head.example.com' 
  };
  path.frontier = false;
  path.shortestPath = { length: 1, seed: 'http://seed.example.com' };
  path.seedPaths = {};
  path.status = 'active';
  path.createdAt = new Date();
  path.extensionCounter = 0;
  // Apply overlays
  Object.assign(path, overlays);
  return path;
}

// Helper to create a plain process-like object
function createMockProcess(overlays: any = {}): any {
  const defaultProcess = {
    pid: 'test-process',
    config: {
      manager: {
        pathType: 'endpoint',
        maxPathLength: 10,
        maxPathProps: 5
      }
    },
    currentStep: {
      maxPathLength: 10,
      maxPathProps: 5
    },
    steps: [{ maxPathLength: 10, maxPathProps: 5 }]
  };
  return { ...defaultProcess, ...overlays };
}

describe('EndpointPathClass', () => {
  describe('shouldCreateNewPath', () => {
    it('returns false for cycles (subject equals object)', () => {
      const path = createMockPath({
        head: { 
          type: HEAD_TYPE.URL, 
          url: 'http://subject.example.com', 
          status: 'unvisited', 
          domain: 'http://subject.example.com' 
        },
        shortestPath: { length: 2, seed: 'http://seed.example.com' }
      });
      const triple: any = {
        type: 'named_node',
        subject: 'http://subject.example.com',
        predicate: 'http://schema.org/name',
        object: 'http://subject.example.com' // cycle
      };

      const result = path.shouldCreateNewPath(triple, path.head as any);
      expect(result).toBe(false);
    });


    it('returns true when valid extension', () => {
      const path = createMockPath({
        shortestPath: { length: 2, seed: 'http://seed.example.com' }
      });
      const process = createMockProcess();
      const triple: any = {
        type: 'named_node',
        subject: 'http://head.example.com',
        predicate: 'http://schema.org/name',
        object: 'http://new.example.com'
      };

      const result = path.shouldCreateNewPath(triple, path.head as any);
      expect(result).toBe(true);
    });
  });

  describe('tripleIsOutOfBounds', () => {
    it('returns true when path length exceeds maxPathLength', () => {
      const path = createMockPath({
        shortestPath: { length: 10, seed: 'http://seed.example.com' }
      });
      const process = createMockProcess({
        currentStep: { maxPathLength: 5 }
      });
      const triple: any = {
        type: 'named_node',
        subject: 'http://head.example.com',
        predicate: 'http://schema.org/name',
        object: 'http://new.example.com'
      };

      const result = path.tripleIsOutOfBounds(triple, process as any);
      expect(result).toBe(true);
    });

    it('returns false when path length within limit', () => {
      const path = createMockPath({
        shortestPath: { length: 2, seed: 'http://seed.example.com' }
      });
      const process = createMockProcess({
        currentStep: { maxPathLength: 10 }
      });
      const triple: any = {
        type: 'named_node',
        subject: 'http://head.example.com',
        predicate: 'http://schema.org/name',
        object: 'http://new.example.com'
      };

      const result = path.tripleIsOutOfBounds(triple, process as any);
      expect(result).toBe(false);
    });
  });

  describe('genExistingTriplesFilter', () => {
    it('returns filter with processId and nodes for URL head', () => {
      const path = createMockPath({
        processId: 'test-pid',
        head: { 
          type: HEAD_TYPE.URL, 
          url: 'http://head.example.com', 
          status: 'unvisited', 
          domain: 'http://head.example.com' 
        }
      });

      const proc = { pid: 'test-pid' } as any;
      const filter = path.genExistingTriplesFilter(proc);

      expect(filter).toEqual({
        processId: 'test-pid',
        nodes: 'http://head.example.com'
      });
    });

    it('returns null for non-URL head (literal)', () => {
      const path = createMockPath({
        head: { 
          type: HEAD_TYPE.LITERAL, 
          value: 'test', 
          datatype: 'http://xsd.string' 
        }
      });

      const proc = { pid: 'test-pid' } as any;
      const filter = path.genExistingTriplesFilter(proc);

      expect(filter).toBeNull();
    });
  });

  describe('copy', () => {
    it('creates a copy of the path', () => {
      const original = createMockPath({
        frontier: true,
        shortestPath: { length: 5, seed: 'http://seed.example.com' },
        seedPaths: { 'http://seed.example.com': 2 }
      });

      const copy = original.copy();

      // copy returns a plain object (EndpointPathSkeleton)
      expect(copy).not.toBeInstanceOf(EndpointPathClass);
      expect(copy.frontier).toEqual(original.frontier);
      expect(copy.shortestPath).toEqual(original.shortestPath);
      expect(copy.seedPaths).toEqual(original.seedPaths);
      expect(copy.head).toEqual(original.head);
      expect(copy.seed).toEqual(original.seed);
      expect(copy.status).toEqual(original.status);
    });
  });
});
