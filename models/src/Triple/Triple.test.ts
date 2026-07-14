import { describe, it, expect } from 'vitest';
import { NamedNodeTripleClass } from './Triple';
import type { PredDirection } from '../Process';

describe('NamedNodeTripleClass.directionOk', () => {
  const triple = new NamedNodeTripleClass();
  triple.subject = 'http://example.com/subject';
  triple.predicate = 'http://example.com/predicate';
  triple.object = 'http://example.com/object';

  const makeMap = (direction: PredDirection['direction']) =>
    new Map<string, PredDirection>([
      [
        triple.predicate,
        {
          url: triple.predicate,
          direction,
          ratio: 1
        }
      ]
    ]);

  it('returns true when followDirection is false', () => {
    expect(triple.directionOk(triple.subject, false, makeMap('subject'))).toBe(true);
  });

  it('returns true when predsDirection is missing', () => {
    expect(triple.directionOk(triple.subject, true, undefined)).toBe(true);
  });

  it('returns true when direction is none', () => {
    expect(triple.directionOk(triple.subject, true, makeMap('none'))).toBe(true);
  });

  it('returns true when direction is subject and headUrl matches subject', () => {
    expect(triple.directionOk(triple.subject, true, makeMap('subject'))).toBe(true);
  });

  it('returns false when direction is subject and headUrl matches object', () => {
    expect(triple.directionOk(triple.object, true, makeMap('subject'))).toBe(false);
  });

  it('returns true when direction is object and headUrl matches object', () => {
    expect(triple.directionOk(triple.object, true, makeMap('object'))).toBe(true);
  });

  it('returns false when direction is object and headUrl matches subject', () => {
    expect(triple.directionOk(triple.subject, true, makeMap('object'))).toBe(false);
  });
});
