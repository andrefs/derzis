import { describe, it, expect } from 'vitest';
import { isBlankNodeId, urlOrBlankNodeValidator } from './mongoose-validators';

describe('isBlankNodeId', () => {
  it('returns true for valid blank node ID with _: prefix', () => {
    expect(isBlankNodeId('_:n12345')).toBe(true);
    expect(isBlankNodeId('_:node1')).toBe(true);
    expect(isBlankNodeId('_:abc123')).toBe(true);
  });

  it('returns false for strings not starting with _:', () => {
    expect(isBlankNodeId('http://example.org')).toBe(false);
    expect(isBlankNodeId('n12345')).toBe(false);
    expect(isBlankNodeId('blanknode')).toBe(false);
  });

  it('returns false for strings with _: but empty after prefix', () => {
    expect(isBlankNodeId('_:')).toBe(false);
    expect(isBlankNodeId('_')).toBe(false);
  });

  it('returns false for non-strings', () => {
    expect(isBlankNodeId('')).toBe(false);
    expect(isBlankNodeId(undefined as unknown as string)).toBe(false);
    expect(isBlankNodeId(null as unknown as string)).toBe(false);
  });
});

describe('urlOrBlankNodeValidator', () => {
  it('accepts valid URLs', () => {
    expect(urlOrBlankNodeValidator.validator('http://example.org')).toBe(true);
    expect(urlOrBlankNodeValidator.validator('https://example.org/path')).toBe(true);
  });

  it('accepts valid blank node IDs', () => {
    expect(urlOrBlankNodeValidator.validator('_:n12345')).toBe(true);
    expect(urlOrBlankNodeValidator.validator('_:node1')).toBe(true);
  });

  it('rejects invalid strings', () => {
    expect(urlOrBlankNodeValidator.validator('invalid')).toBe(false);
    expect(urlOrBlankNodeValidator.validator('n12345')).toBe(false);
  });

  it('accepts non-standard URLs (valid URL format but not http/https)', () => {
    expect(urlOrBlankNodeValidator.validator('not:a:url')).toBe(true);
    expect(urlOrBlankNodeValidator.validator('ftp://example.org')).toBe(true);
  });
});
