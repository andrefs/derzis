import {WorkerError} from '@derzis/common';
import {jest} from '@jest/globals';

import {
  fetchRobots,
  findRedirectUrl,
  findUrlInHtml,
  findUrlInLinkHeader,
  handleHttpError
} from './worker-utils';

describe('findUrlInLinkHeader', () => {
  it('returns undefined if there are no alternate links', () => {
    const linkHeader =
        '<http://creativecommons.org/licenses/by-sa/3.0/>; rel="license", <http://dbpedia.org/resource/Aladdin>; rev="describedby"';
    expect(findUrlInLinkHeader(linkHeader)).toBeUndefined();
  });

  it('returns undefined if mime type is not accepted', () => {
    const linkHeader =
        '<http://dbpedia.org/data/Aladdin.rabelz>; rel="alternate"; type="false/rabelz"';
    expect(findUrlInLinkHeader(linkHeader)).toBeUndefined();
  });

  it('returns a link when it finds one', () => {
    const linkHeader =
        '<http://dbpedia.org/data/Aladdin.n3>; rel="alternate"; type="text/n3"; title="Structured Descriptor Document (N3 format)"';
    expect(findUrlInLinkHeader(linkHeader)).toMatchInlineSnapshot(`
Object {
  "rel": "alternate",
  "title": "Structured Descriptor Document (N3 format)",
  "type": "text/n3",
  "uri": "http://dbpedia.org/data/Aladdin.n3",
}
`)
  });
});

describe('findUrlInHtml', () => {
  it('returns undefined if mime type is not html',
     () => { expect(findUrlInHtml('', 'false/rabelz')).toBeUndefined(); });
  it('returns undefined if <link> cannot be found', () => {
    const data = `
    <html>
      <head>
      </head>
    </html>
    `;
    expect(findUrlInHtml(data, 'text/html; charset=UTF-8')).toBeUndefined();
  });

  it('returns undefined if alternate <link> cannot be found', () => {
    const data = `
    <html>
      <head>
        <link rev="describedby" href="http://dbpedia.org/resource/Aladdin"/>
      </head>
    </html>
    `;
    expect(findUrlInHtml(data, 'text/html; charset=UTF-8')).toBeUndefined();
  });

  it('returns undefined if alternate <link> cannot be found', () => {
    const data = `
    <html>
      <head>
        <link rel="alternate" type="false/rabelz" href="http://dbpedia.org/data/Aladdin.n3" />
      </head>
    </html>
    `;
    expect(findUrlInHtml(data, 'text/html; charset=UTF-8')).toBeUndefined();
  });
  it('returns a URI if acceptable link is found', () => {
    const data = `
    <html>
      <head>
        <link rel="alternate" type="text/n3" href="http://dbpedia.org/data/Aladdin.n3" />
      </head>
    </html>
    `;
    expect(findUrlInHtml(data, 'text/html; charset=UTF-8'))
        .toEqual('http://dbpedia.org/data/Aladdin.n3');
  })
});

describe('findRedirectUrl', () => {
  it.todo('calls findUrlInLinkHeader if response has Link headers');
  it.todo('calls findUrlInHtml if mime type is html');

  it('can get url from Link header', () => {
    const headers = {
      Link :
          '<http://dbpedia.org/data/Aladdin.n3>; rel="alternate"; type="text/n3"',
      'content-type' : 'text/html; charset=UTF-8'
    };
    expect(findRedirectUrl(headers, ''))
        .toMatchInlineSnapshot(`"http://dbpedia.org/data/Aladdin.n3"`);
  });

  it('can get url from <link> in html', () => {
    const data = `
    <html>
      <head>
        <link rel="alternate" type="text/n3" href="http://dbpedia.org/data/Aladdin.n3" />
      </head>
    </html>
    `;
    expect(findRedirectUrl({'content-type' : 'text/html; charset=UTF-8'}, data))
        .toMatchInlineSnapshot(`"http://dbpedia.org/data/Aladdin.n3"`);
  });
});

describe('fetchRobots', () => {
  const mockAxios = {get : jest.fn<() => Promise<any>>()};

  it('returns error if axios throws', async () => {
    // const mock = {get : () => { return Promise.reject('error') }} as
    // AxiosGet;

    mockAxios.get.mockRejectedValueOnce('error');
    expect(await fetchRobots('fakeurl', mockAxios)).toMatchInlineSnapshot(`
Object {
  "details": Object {
    "message": undefined,
    "stack": undefined,
  },
  "err": [Error],
  "status": "not_ok",
  "url": "fakeurl",
}
`)
  });

  it('returns result otherwise', async () => {
    mockAxios.get.mockResolvedValueOnce({
      headers : {
        'request-endTime' : new Date('2020-01-01'),
        'request-duration' : 1000,
      },
      data : '',
      status : '200'
    });
    expect(await fetchRobots('fakeurl', mockAxios)).toMatchInlineSnapshot(`
Object {
  "details": Object {
    "elapsedTime": 1000,
    "endTime": 2020-01-01T00:00:00.000Z,
    "robotsText": "",
    "status": "200",
  },
  "status": "ok",
}
`)
  });
});

describe('handleHttpError', () => {
  it('handles AxiosError with response', () => {
    const err = {
      response : {
        headers : {
          'request-endTime' : new Date('2020-01-01'),
          'request-duration' : 1000,
        },
      },
      isAxiosError : true
    };
    const res = handleHttpError('fakeurl', err)
    expect(res).toMatchInlineSnapshot(`
Object {
  "details": Object {
    "elapsedTime": 1000,
    "endTime": 2020-01-01T00:00:00.000Z,
  },
  "err": [Error],
  "status": "not_ok",
  "url": "fakeurl",
}
`);
    expect(res.err).toHaveProperty('errorType', 'http')
  });

  it('handles ECONNABORTED', () => {
    const err = {code : 'ECONNABORTED', isAxiosError : true};
    const res = handleHttpError('fakeurl', err)
    expect(res).toMatchInlineSnapshot(`
Object {
  "err": [Error],
  "status": "not_ok",
  "url": "fakeurl",
}
`);
    expect(res.err).toHaveProperty('errorType', 'request_timeout')
  });

  it('handles ENOTFOUND', () => {
    const err = {code : 'ENOTFOUND', isAxiosError : true};
    const res = handleHttpError('fakeurl', err)
    expect(res).toMatchInlineSnapshot(`
Object {
  "err": [Error],
  "status": "not_ok",
  "url": "fakeurl",
}
`);
    expect(res.err).toHaveProperty('errorType', 'host_not_found')
  });
  it('handles ECONNRESET', () => {
    const err = {code : 'ECONNRESET', isAxiosError : true};
    const res = handleHttpError('fakeurl', err)
    expect(res).toMatchInlineSnapshot(`
Object {
  "err": [Error],
  "status": "not_ok",
  "url": "fakeurl",
}
`);
    expect(res.err).toHaveProperty('errorType', 'connection_reset')
  });
  it.skip('handles content-type parse TypeError', () => {
    const err = new TypeError('invalid media type')
    const res = handleHttpError('fakeurl', err)
    expect(res.status).toEqual('not_ok');
    expect(res.err.toString()).toMatchInlineSnapshot(`[Error]`);
  });
  it('handles WorkerError', () => {
    const err = new WorkerError();
    const res = handleHttpError('fakeurl', err);
    expect(res).toMatchInlineSnapshot(`
Object {
  "err": [Error],
  "status": "not_ok",
  "url": "fakeurl",
}
`);
    expect(res.err).toEqual(err);
  })
  it('handles other errors', () => {
    const err = new Error('test');
    const res = handleHttpError('fakeurl', err);
    expect(res.details?.message).toEqual('test');
    expect(res.err).toMatchInlineSnapshot(`[Error]`);
    expect(res.status).toEqual('not_ok');
    expect(res.url).toEqual('fakeurl');
  });
});
