import { isValid } from './url';
import { jest } from '@jest/globals';

jest.useFakeTimers();

describe('URL isValid', () => {
  it('returns true on valid URL', async () => {
    const url = 'http://www.google.com';
    const res = isValid(url);

    expect(res).toBeTruthy();
  });

  it('returns false on invalid URL', async () => {
    const notUrl = 'xasxass///';
    const res = isValid(notUrl);

    expect(res).toBeFalsy();
  });
});
