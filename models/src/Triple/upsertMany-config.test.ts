import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Triple, NamedNodeTriple, LiteralTriple, BlankNodeTriple } from './Triple';
import { TripleType } from '@derzis/common';
import config from '@derzis/config';

describe('Triple.upsertMany', () => {
  beforeEach(() => {
    config.allowBlankNodes = false;
    vi.clearAllMocks();
  });

  it('filters out blank node triples when allowBlankNodes is false', async () => {
    const namedSpy = vi.spyOn(NamedNodeTriple, 'bulkWrite').mockResolvedValue({
      insertedCount: 1,
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 1,
      deletedCount: 0
    } as any);
    const literalSpy = vi.spyOn(LiteralTriple, 'bulkWrite').mockResolvedValue({} as any);
    const blankSpy = vi.spyOn(BlankNodeTriple, 'bulkWrite').mockResolvedValue({} as any);

    const triples = [
      {
        subject: 'http://s1',
        predicate: 'http://p1',
        object: 'http://o1',
        type: TripleType.NAMED_NODE
      },
      {
        subject: '_:b1',
        predicate: 'http://p2',
        object: { id: '_:b2' } as any,
        type: TripleType.BLANK_NODE
      },
      {
        subject: 'http://s2',
        predicate: 'http://p3',
        object: { value: 'lit' } as any,
        type: TripleType.LITERAL
      }
    ];

    await Triple.upsertMany('http://source', triples as any);

    expect(blankSpy).not.toHaveBeenCalled();
    expect(namedSpy).toHaveBeenCalledTimes(1);
    expect(literalSpy).toHaveBeenCalledTimes(1);
  });

  it('processes blank node triples when allowBlankNodes is true', async () => {
    config.allowBlankNodes = true;
    const namedSpy = vi.spyOn(NamedNodeTriple, 'bulkWrite').mockResolvedValue({} as any);
    const literalSpy = vi.spyOn(LiteralTriple, 'bulkWrite').mockResolvedValue({} as any);
    const blankSpy = vi.spyOn(BlankNodeTriple, 'bulkWrite').mockResolvedValue({} as any);

    const triples = [
      {
        subject: 'http://s1',
        predicate: 'http://p1',
        object: 'http://o1',
        type: TripleType.NAMED_NODE
      },
      {
        subject: '_:b1',
        predicate: 'http://p2',
        object: { id: '_:b2' } as any,
        type: TripleType.BLANK_NODE
      }
    ];

    await Triple.upsertMany('http://source', triples as any);

    expect(blankSpy).toHaveBeenCalledTimes(1);
    expect(namedSpy).toHaveBeenCalledTimes(1);
  });
});
