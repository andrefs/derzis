import {jest} from '@jest/globals';
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
    it('tries to find redirect URL and throws if not found', async () => {
      const resp = {
        headers: {
          'content-type': 'text/plain'
        },
        data: ''
      };

      mockFindRedirectUrl.mockReturnValueOnce(undefined)

      expect(() => {w.handleHttpResponse(resp, 0, 'fakeurl');}).toThrowErrorMatchingInlineSnapshot(`""`)
      expect(mockFindRedirectUrl.mock.calls).toHaveLength(1);
    });
  });
});
