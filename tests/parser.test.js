const fs = require('fs');
const Readable = require('stream').Readable;
const chai = require('chai');
const path = require('path');
chai.use(require('chai-generator'));
chai.use(require('chai-as-promised'));

const expect = chai.expect;
const parse = require('../lib/parse.js');

describe('parse', () => {
  it('returns expected number of items', async () => {
    const tripIt = parse(`PREFIX c: <http://example.org/cartoons#>
      c:Tom a c:Cat.
      c:Jerry a c:Mouse;
              c:smarterThan c:Tom.`);

    console.log(tripIt);
    let i=0;
    for await (const item of tripIt){
      i++;
    }
    expect(i).to.equal(4); // 3 triples + 1 prefixes (ignored for now)
  });
});

