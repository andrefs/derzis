import { describe, it, expect } from 'vitest';
import { makeBlankNodeId } from './Worker';

describe('makeBlankNodeId', () => {
  it('creates namespaced blank node ID with source URL', () => {
    expect(makeBlankNodeId('http://example.org/doc.ttl', 'b1')).toBe('_:http://example.org/doc.ttl:b1');
  });

  it('removes existing _: prefix from local ID', () => {
    expect(makeBlankNodeId('http://example.org/doc.ttl', '_:b2')).toBe('_:http://example.org/doc.ttl:b2');
  });

  it('handles source URL with port and path', () => {
    expect(makeBlankNodeId('http://example.org:8080/data/rdf', 'x')).toBe('_:http://example.org:8080/data/rdf:x');
  });

  it('handles local ID with alphanumeric and underscores', () => {
    expect(makeBlankNodeId('http://a.example/', 'node_123')).toBe('_:http://a.example/:node_123');
  });

  it('does not modify local ID if it does not start with _:', () => {
    expect(makeBlankNodeId('http://source', 'b123')).toBe('_:http://source:b123');
  });
});
