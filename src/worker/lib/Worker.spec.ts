import {jest} from '@jest/globals';
import { MimeTypeError } from '@derzis/common';
import {Worker as WorkerType} from './Worker';

const mockFindRedirectUrl = jest.fn();
jest.unstable_mockModule('./worker-utils', () => ({
  findRedirectUrl: mockFindRedirectUrl,
  fetchRobots: jest.fn(),
  handleHttpError: jest.fn()
}));

await import('./worker-utils');
const {Worker} = await import('./Worker');


let w: WorkerType;

beforeEach(() => {
  w = new Worker();
});

it.skip('emitHttpDebugEvent', () => {
  w.emitHttpDebugEvent('http://example.org');
  let _ev;
  w.on('httpDebug', ev => _ev = ev);
  expect(_ev).toMatchInlineSnapshot(`undefined`);
});

describe('handleHttpResponse', () => {
  describe('if mime type not accepted', () => {
    it('throws if redirect URL cannot be found', async () => {
      const resp = {
        headers: {
          'content-type': 'text/plain'
        },
        data: ''
      };
      expect(() => w.handleHttpResponse(resp, 0, 'fakeurl')).toThrow(MimeTypeError)
      expect(() => w.handleHttpResponse(resp, 0, 'fakeurl')).toThrow('text/plain')
      expect(mockFindRedirectUrl.mock.calls).toHaveLength(2);
    });

    it.todo('throws if maxRedirects have been reached');
    it.todo('calls .getHttpContent otherwise')
  });

  it.todo('returns data');
});
