import parseRdf from './parse-rdf';

describe('parse', () => {
  it.skip('returns expected number of items', async () => {
    const rdf = `PREFIX c: <http://example.org/cartoons#>
      c:Tom a c:Cat.
      c:Jerry a c:Mouse;
              c:smarterThan c:Tom.`
    const tripIt = await parseRdf(rdf, 'text/turtle');

    expect(tripIt).toHaveProperty('triples');
    expect(tripIt.triples).toHaveLength(3);
  });
});

