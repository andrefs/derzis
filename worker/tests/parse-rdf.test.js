const chai = require('chai');
chai.use(require('chai-generator'));
chai.use(require('chai-as-promised'));

const expect = chai.expect;
const parseRdf = require('../lib/parse-rdf');

describe('parse', () => {
  it('returns expected number of items', async () => {
    const rdf = `PREFIX c: <http://example.org/cartoons#>
      c:Tom a c:Cat.
      c:Jerry a c:Mouse;
              c:smarterThan c:Tom.`
    const tripIt = await parseRdf(rdf, 'text/turtle');

    expect(tripIt).to.have.property('triples');
    expect(tripIt.triples.length).to.equal(3);
  });
});

