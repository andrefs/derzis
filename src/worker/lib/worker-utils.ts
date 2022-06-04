import {
  HttpError,
  DomainNotFoundError,
  ConnectionResetError,
  RequestTimeoutError,
  WorkerError,
  MimeTypeError,
 } from '@derzis/common'

import config from '@derzis/config';
import { AxiosInstance, AxiosResponse  } from 'axios';
import * as cheerio from 'cheerio';
import contentType from 'content-type';
import LinkHeader from 'http-link-header';
const acceptedMimeTypes = config.http.acceptedMimeTypes;
import robotsParser from 'robots-parser';


export interface HttpRequestResultError {
  status: 'not_ok',
  url: string,
  err: WorkerError,
  details?: {
    message?: any,
    stack?: any,
    elapsedTime?: number,
    endTime?: number
  }
};
export interface HttpRequestResultOk {
  status: 'ok';
  rdf: string;
  ts: number;
  mime: string;
};

export type HttpRequestResult = HttpRequestResultOk | HttpRequestResultError;


export const handleHttpError = (url: string, err: any): HttpRequestResultError => {
  const res = {status: 'not_ok' as const, url};
  if(err.response){
    let e = new HttpError(err.response.status);
    const details = {
      endTime: err.response.headers['request-endTime'],
      elapsedTime: err.response.headers['request-duration']
    };
    return {...res, err: e, details};
  }
  if(err.code && err.code === 'ECONNABORTED'){
    return {...res, err: new RequestTimeoutError(config.http.robotsCheck.timeouts)};
  }
  if(err.code && err.code === 'ENOTFOUND'){
    return {...res, err: new DomainNotFoundError()};
  }
  if(err.code && err.code === 'ECONNRESET'){
    return {...res, err: new ConnectionResetError()};
  }
  if(err.name === 'TypeError' && err.response ){
    return {...res, err: new MimeTypeError(err.response.headers['content-type'])};
  }
  if(err instanceof WorkerError){
    return {...res, err, url};
  }
  return {...res, err: new WorkerError(), details: {message:err.message, stack: err.stack}};
};

export const fetchRobots = async (url: string, axios: AxiosInstance) => {
  const timeout = config.http.robotsCheck.timeouts || 10*1000;
  const maxRedirects = config.http.robotsCheck.maxRedirects || 5;
  const headers = {'User-Agent': config.http.userAgent};
  let res = await axios.get(url, {headers, timeout, maxRedirects})
    .then(resp => ({
      details: {
        endTime: resp.headers['request-endTime'],
        elapsedTime: resp.headers['request-duration'],
        robotsText: resp.data,
        status: resp.status,
      },
      status: 'ok' as const
    }))
    .catch(err => ({
      ...handleHttpError(url, err),
      status: 'not_ok' as const
    }));
  return res;
};

export const robotsAllow = (robots:ReturnType<typeof robotsParser>, url: string, userAgent: string) => {
  return !!robots.isAllowed(url, userAgent);
};

export const findRedirectUrl = (resp: AxiosResponse<any>): string|undefined => {
  // check Link header
  if(resp.headers['Link']){
    const links = LinkHeader.parse(resp.headers['Link']);
    const link = links.refs.find(l => l.rel === 'alternate' && acceptedMimeTypes.some(aMT => l.type === aMT));
    if(link){ return link.uri; }
  }

  // html
  const mime = contentType.parse(resp.headers['content-type']).type;
  if(mime === 'text/html'){
    const $ = cheerio.load(resp.data);
    for(const mime of config.http.acceptedMimeTypes){
      // <link> tags
      const link = $(`link[rel="alternate"][type="${mime}"]`);
      if(link.length){
        return link.first().attr('href');
      }
    }
  }
};

