import {
  findUrlInLinkHeader
} from './worker-utils';

describe('findUrlInLinkHeader', () => {
  it('returns undefined if there are no alternate links', () => {
    const link = '<http://creativecommons.org/licenses/by-sa/3.0/>; rel="license", <http://dbpedia.org/resource/Aladdin>; rev="describedby"';
    expect(findUrlInLinkHeader(link)).toBeUndefined();
  });

  it('returns undefined if mime type is not accepted', () => {
    const link = '<http://dbpedia.org/data/Aladdin.rabelz>; rel="alternate"; type="false/rabelz"';
    expect(findUrlInLinkHeader(link)).toBeUndefined();
  });
});
