import {
	ConnectionResetError,
	DomainNotFoundError,
	HttpError,
	MimeTypeError,
	RequestTimeoutError,
	WorkerError
} from '@derzis/common';
import config from '@derzis/config';
import type { AxiosInstance } from 'axios';
import axios from 'axios';
import * as cheerio from 'cheerio';
import contentType from 'content-type';
import LinkHeader from 'http-link-header';

const acceptedMimeTypes = config.http.acceptedMimeTypes;

export interface HttpRequestResultError {
	status: 'not_ok';
	url: string;
	err: WorkerError;
	details?: {
		message?: any;
		stack?: any;
		elapsedTime?: number;
		endTime?: number;
	};
}
export interface HttpRequestResultOk {
	status: 'ok';
	rdf: string;
	ts: number;
	mime: string;
}
export type HttpRequestResult = HttpRequestResultOk | HttpRequestResultError;

export const handleHttpError = (url: string, err: any): HttpRequestResultError => {
	const res = { status: 'not_ok' as const, url };

	if (axios.isAxiosError(err)) {
		if (err.response) {
			let e = new HttpError(err.response.status);
			const details = {
				endTime: Number(err.response.headers['request-endTime']),
				elapsedTime: Number(err.response.headers['request-duration'])
			};
			return { ...res, err: e, details };
		}
		if (err.code && err.code === 'ECONNABORTED') {
			return {
				...res,
				err: new RequestTimeoutError(config.http.robotsCheck.timeouts)
			};
		}
		if (err.code && err.code === 'ENOTFOUND') {
			return { ...res, err: new DomainNotFoundError() };
		}
		if (err.code && err.code === 'ECONNRESET') {
			return { ...res, err: new ConnectionResetError() };
		}
	}
	// from contentType.parse
	if (err?.name === 'TypeError' && err.response) {
		return {
			...res,
			err: new MimeTypeError(err.response.headers['content-type'])
		};
	}
	if (err instanceof WorkerError) {
		return { ...res, err, url };
	}
	return {
		...res,
		err: new WorkerError(),
		details: { message: err.message, stack: err.stack }
	};
};

export type AxiosGet = Pick<AxiosInstance, 'get'>;

export const fetchRobots = async (url: string, axios: AxiosGet) => {
	const timeout = config.http.robotsCheck.timeouts || 10 * 1000;
	const maxRedirects = config.http.robotsCheck.maxRedirects || 5;
	const headers = { 'User-Agent': config.http.userAgent };
	let res = await axios
		.get(url, { headers, timeout, maxRedirects })
		.then((resp) => ({
			details: {
				endTime: Number(resp.headers['request-endTime']),
				elapsedTime: Number(resp.headers['request-duration']),
				robotsText: resp.data,
				status: resp.status
			},
			status: 'ok' as const
		}))
		.catch((err) => {
			console.log('XXXXXXXXXXXXXXX worker fetchRobots err', err);
			return { ...handleHttpError(url, err), status: 'not_ok' as const };
		});
	return res;
};

export interface AxiosResponseHeaders {
	Link?: string;
	'content-type'?: string;
}
export const findRedirectUrl = (
	headers: AxiosResponseHeaders,
	data: string
): string | undefined => {
	// check Link header
	if (headers['Link']) {
		const link = findUrlInLinkHeader(headers['Link']);
		if (link) {
			return link.uri;
		}
	}

	// check html
	const ct = headers['content-type'];
	if (ct) {
		return findUrlInHtml(data, ct);
	}
};

export const findUrlInLinkHeader = (linkHeader: string) => {
	const links = LinkHeader.parse(linkHeader);
	return links.refs.find(
		(l) => l.rel === 'alternate' && acceptedMimeTypes.some((aMT) => l.type === aMT)
	);
};

export const findUrlInHtml = (data: string, ctHeader: string) => {
	const mime = contentType.parse(ctHeader).type;
	if (mime === 'text/html') {
		const $ = cheerio.load(data);
		for (const mime of config.http.acceptedMimeTypes) {
			// <link> tags
			const link = $(`link[rel="alternate"][type="${mime}"]`);
			if (link.length) {
				return link.first().attr('href');
			}
		}
	}
};
