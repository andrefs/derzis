import { jest } from '@jest/globals';
import { Worker as WorkerType } from './Worker';

const mockFindRedirectUrl = jest.fn();
const mockGetHttpContent = jest.fn();

jest.unstable_mockModule('./worker-utils', () => ({
  findRedirectUrl: mockFindRedirectUrl,
  fetchRobots: jest.fn(),
  handleHttpError: jest.fn(),
  getHttpContent: mockGetHttpContent,
}));

jest.unstable_mockModule('@derzis/config', () => ({
  default: {
    worker: {
      db: {
        debug: true,
      },
    },
    http: {
      acceptedMimeTypes: ['text/n3'],
      domainCrawl: {
        maxRedirects: 1,
      },
    },
  },
}));

await import('./worker-utils');
await import('@derzis/config');
const { Worker } = await import('./Worker');

jest.useFakeTimers();

let w: WorkerType;

beforeEach(() => {
  w = new Worker();
});

it('emitHttpDebugEvent', () => {
  w.emitHttpDebugEvent('http://example.org');
  let _ev;
  w.on('httpDebug', (ev) => (_ev = ev));
  expect(_ev).toMatchInlineSnapshot(`undefined`);
});

describe('handleHttpResponse', () => {
  describe('if mime type not accepted', () => {
    it('returns error if redirect URL cannot be found', async () => {
      const resp = {
        headers: {
          'content-type': 'text/plajest.unstable_mockModulein',
        },
        data: '',
      };
      expect(await w.handleHttpResponse(resp, 0, 'fakeurl'))
        .toMatchInlineSnapshot(`
{
  "err": [Unsupported Mime Type Error: text/plajest.unstable_mockmodulein],
  "status": "not_ok",
}
`);
      expect(mockFindRedirectUrl.mock.calls).toHaveLength(1);
    });

    it('returns error if maxRedirects have been reached', async () => {
      const resp = {
        headers: {
          'content-type': 'text/plain',
        },
        data: '',
      };
      mockFindRedirectUrl.mockReturnValueOnce('anotherfakeurl');
      expect(await w.handleHttpResponse(resp, 3, 'fakeurl'))
        .toMatchInlineSnapshot(`
{
  "err": [Too Many Redirect Error],
  "status": "not_ok",
}
`);
    });

    // need jest to fully support mocking modules
    // can't mock w.getHttpContent
    it.skip('calls .getHttpContent otherwise', async () => {
      const resp = {
        headers: {
          'content-type': 'text/plain',
        },
        data: '',
      };

      mockFindRedirectUrl.mockReturnValueOnce('anotherfakeurl');
      await w.handleHttpResponse(resp, 0, 'fakeurl');
      expect(mockGetHttpContent.mock.calls).toHaveLength(1);
    });
  });

  it('returns data', async () => {
    const resp = {
      headers: {
        'content-type': 'text/n3',
      },
      data: 'this is the data',
    };
    expect(await w.handleHttpResponse(resp, 0, 'fakeurl'))
          .toMatchInlineSnapshot(`
{
  "mime": "text/n3",
  "rdf": "this is the data",
  "status": "ok",
  "ts": NaN,
}
`);
  });
});
