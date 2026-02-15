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
});
