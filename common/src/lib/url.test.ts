import { describe, it, expect } from 'vitest';
import { isValid } from './url';

describe('URL isValid', () => {
  it('returns true on valid URL', () => {
    const url = 'http://www.google.com';
    const res = isValid(url);

    expect(res).toBeTruthy();
  });

  it('returns false on invalid URL', () => {
    const notUrl = 'xasxass///';
    const res = isValid(notUrl);

    expect(res).toBeFalsy();
  });
});