const chai = require('chai');
chai.use(require('chai-generator'));
chai.use(require('chai-as-promised'));

const expect = chai.expect;
const {isValid} = require('../lib/url');

describe('URL isValid', () => {
  it('returns true on valid URL', async () => {
    const url = 'http://www.google.com';
    const res = isValid(url);

    expect(res).to.be.true;
  });


  it('returns false on invalid URL', async () => {
    const notUrl = 'xasxass///';
    const res = isValid(notUrl);

    expect(res).to.be.false;
  });
});

