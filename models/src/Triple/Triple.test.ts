import { describe, it, expect } from 'vitest';
import { directionOk, SimpleNamedNodeTriple, TripleType } from '@derzis/common';

describe('directionOk', () => {
  const triple: SimpleNamedNodeTriple = {
    subject: 'http://example.com/subject',
    predicate: 'http://example.com/predicate',
    object: 'http://example.com/object',
    type: TripleType.NAMED_NODE
  };

  it('returns true when branch factor is 1 (no directionality)', () => {
    expect(directionOk(triple, 'http://example.com/any', 1)).toBe(true);
  });

  it('returns true when branch factor > 1 and headUrl matches subject', () => {
    expect(directionOk(triple, triple.subject!, 2)).toBe(true);
  });

  it('returns false when branch factor > 1 and headUrl does not match subject', () => {
    expect(directionOk(triple, 'http://example.com/other', 2)).toBe(false);
  });

  it('returns true when branch factor < 1 and headUrl matches object', () => {
    expect(directionOk(triple, triple.object!, 0.5)).toBe(true);
  });

  it('returns false when branch factor < 1 and headUrl does not match object', () => {
    expect(directionOk(triple, 'http://example.com/other', 0.5)).toBe(false);
  });

  it('returns false when branch factor < 1 and headUrl matches subject instead of object', () => {
    expect(directionOk(triple, triple.subject!, 0.5)).toBe(false);
  });

  it('returns false when branch factor > 1 and headUrl matches object instead of subject', () => {
    expect(directionOk(triple, triple.object!, 2)).toBe(false);
  });
});
