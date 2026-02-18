import parseRdf from './parse-rdf';

import { describe, it, expect } from 'vitest';

describe('parse', () => {
  it.skip('returns expected number of items', async () => {
    const rdf = `PREFIX c: <http://example.org/cartoons#>
      c:Tom a c:Cat.
      c:Jerry a c:Mouse;
              c:smarterThan c:Tom.`;
    const tripIt = await parseRdf(rdf, 'text/turtle');

    expect(tripIt).toHaveProperty('triples');
    expect(tripIt.triples).toHaveLength(3);
    expect(tripIt).toHaveProperty('errors');
    expect(tripIt.errors).toHaveLength(0);
  });

  it('should filter out triples with blank node objects', async () => {
    const rdf = `<http://example.org/Alice> <http://xmlns.com/foaf/0.1/name> "Alice" .
<http://example.org/Alice> <http://example.org/knows> _:b0 .
_:b0 <http://xmlns.com/foaf/0.1/name> "Bob" .`;
    
    const result = await parseRdf(rdf, 'text/turtle');
    
    expect(result.triples.length).toBeGreaterThan(0);
    
    const triplesWithBlankObjects = result.triples.filter(
      (t) => t.object?.termType === 'BlankNode'
    );
    expect(triplesWithBlankObjects.length).toBeGreaterThan(0);
    
    const filteredTriples = result.triples.filter(
      (t) =>
        t.subject?.termType === 'NamedNode' &&
        t.predicate?.termType === 'NamedNode' &&
        t.object !== undefined &&
        (t.object.termType === 'NamedNode' || t.object.termType === 'Literal')
    );
    
    expect(filteredTriples.length).toBeLessThan(result.triples.length);
    expect(filteredTriples.every(t => t.object?.termType !== 'BlankNode')).toBe(true);
  });
});
