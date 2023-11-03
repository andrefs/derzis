import config from '@derzis/config';
import type { AxiosInstance, AxiosResponse } from 'axios';
import Bluebird from 'bluebird';
import EventEmitter from 'events';
import robotsParser, { type Robot } from 'robots-parser';
import { ResourceCache, db } from '@derzis/models';
import { Resource } from '@derzis/models';
const { WORKER_DATABASE } = process.env;

import Axios from './axios';

let axios: AxiosInstance;
import contentType from 'content-type';
import parseRdf from './parse-rdf';
let log: MonkeyPatchedLogger;
import {
	createLogger,
	JobTimeoutError,
	type MonkeyPatchedLogger,
	MimeTypeError,
	RobotsForbiddenError,
	TooManyRedirectsError,
	AxiosError,
	type JobType,
	type RobotsCheckResult,
	type CrawlResourceResult,
	type CrawlResourceResultOk
} from '@derzis/common';
const acceptedMimeTypes = config.http.acceptedMimeTypes;
import setupDelay from './delay';
let delay = () => Bluebird.resolve();
import { v4 as uuidv4 } from 'uuid';
import type { DomainCrawlJobRequest } from './WorkerPubSub';
import type { OngoingJobs } from '@derzis/common';
import {
	type AxiosResponseHeaders,
	fetchRobots,
	findRedirectUrl,
	handleHttpError,
	type HttpRequestResult
} from './worker-utils';

export interface Availability {
	currentCapacity: JobCapacity;
	currentJobs: OngoingJobs;
}
export interface JobCapacity {
	domainCrawl: { capacity: number; resourcesPerDomain: number };
	robotsCheck: { capacity: number };
}
interface JobsTimedOut {
	[domain: string]: boolean;
}

export class Worker extends EventEmitter {
	wId: string;
	wShortId: string;
	jobCapacity: JobCapacity;
	currentJobs: OngoingJobs;
	accept: string;
	jobsTimedout: JobsTimedOut;
	crawlTs!: Date;
	crawlCounter!: number;

	async connect() {
		log.info('Connecting to MongoDB');
		const conn = await db.connect(WORKER_DATABASE || 'derzis-wrk-default');
		log.info(`MongoDB connection ready state: ${conn.connection.readyState}`);
	}

	constructor() {
		super();
		this.wId = uuidv4();
		this.wShortId = this.wId.replace(/-.*$/, '');
		log = createLogger(this.wShortId);
		axios = Axios(log);
		this.jobCapacity = config.jobs;
		this.currentJobs = { domainCrawl: {}, robotsCheck: {} };
		this.accept = acceptedMimeTypes
			.map((m, i) => `${m}; q=${Math.round(100 / (i + 2)) / 100}`)
			.join(', ');
		this.jobsTimedout = {};
	}

	alreadyBeingDone(domain: string, jobType: Exclude<JobType, 'resourceCrawl'>) {
		return !!this.currentJobs[jobType][domain];
	}

	currentCapacity(): JobCapacity {
		const domCrawlCap = this.jobCapacity.domainCrawl.capacity;
		const robCheckCap = this.jobCapacity.robotsCheck.capacity;
		const curDomCrawl = Object.keys(this.currentJobs.domainCrawl).length;
		const curRobCheck = Object.keys(this.currentJobs.robotsCheck).length;
		const av = {
			domainCrawl: {
				capacity: domCrawlCap - curDomCrawl,
				resourcesPerDomain: this.jobCapacity.domainCrawl.resourcesPerDomain
			},
			robotsCheck: {
				capacity: robCheckCap - curRobCheck
			}
		};
		return av;
	}

	status(): Availability {
		return {
			currentCapacity: this.currentCapacity(),
			currentJobs: this.currentJobs
		};
	}

	hasCapacity(jobType: 'domainCrawl' | 'robotsCheck'): boolean {
		return Object.keys(this.currentJobs[jobType]).length < this.jobCapacity[jobType].capacity;
	}

	async checkRobots(jobId: number, origin: string): Promise<RobotsCheckResult> {
		this.currentJobs.robotsCheck[origin] = true;

		const url = origin + '/robots.txt';
		const res = await fetchRobots(url, axios);
		delete this.currentJobs.robotsCheck[origin];
		return { ...res, url, jobId, origin, jobType: 'robotsCheck' };
	}

	async *crawlDomain({ jobId, domain, resources }: DomainCrawlJobRequest) {
		this.crawlTs = new Date();
		this.crawlCounter = 0;
		this.currentJobs.domainCrawl[domain.origin] = true;
		const robotsText = domain?.robots?.text || '';
		const robots = robotsParser(domain.origin + '/robots.txt', robotsText);

		this.emit('httpDebug', {
			type: 'delay',
			domain: domain.origin,
			delay: domain.crawl.delay
		});
		delay = setupDelay(domain.crawl.delay * 1000 * 1.1); // ms to s, add 10% margin

		for (const r of resources) {
			const res = await this.crawlResource(jobId, domain.origin, r.url, robots);
			if (!res) {
				break;
			}
			yield res;
		}
		delete this.currentJobs.domainCrawl[domain.origin];
	}

	async getResourceFromCache(url: string) {
		return ResourceCache.findOne({ url });
	}

	async crawlResource(
		jobId: number,
		origin: string,
		url: string,
		robots: Robot
	): Promise<CrawlResourceResult> {
		const jobInfo = {
			jobType: 'resourceCrawl' as const,
			jobId,
			origin: origin,
			url
		};
		const crawlId = { domainTs: this.crawlTs, counter: this.crawlCounter };
		if (this.jobsTimedout[origin]) {
			delete this.jobsTimedout[origin];
			delete this.currentJobs.domainCrawl[origin];
			log.warn(`Stopping domain ${origin} because Manager removed job #${jobId})`);
			return {
				...jobInfo,
				status: 'not_ok' as const,
				details: { crawlId, ts: Date.now() },
				err: new JobTimeoutError()
			};
		}
		this.crawlCounter++;
		this.currentJobs.domainCrawl[origin] = true;
		let jobResult: CrawlResourceResult;

		if (robots.isDisallowed(url, config.http.userAgent)) {
			return {
				...jobInfo,
				status: 'not_ok' as const,
				details: { crawlId, ts: Date.now() },
				err: new RobotsForbiddenError()
			};
		}

		const cachedRes = await this.getResourceFromCache(url);
		if (cachedRes) {
			return {
				...jobInfo,
				status: 'ok',
				details: {
					crawlId,
					triples: cachedRes.triples?.map((t) => t.toObject()),
					ts: crawlId.domainTs.getTime(),
					cached: true
				}
			} as CrawlResourceResultOk;
		}

		const res = await this.fetchResource(url);

		if (res.status === 'ok') {
			jobResult = {
				...jobInfo,
				status: 'ok',
				details: { crawlId, triples: res.triples, ts: res.ts }
			};
		} else {
			jobResult = {
				...jobInfo,
				status: 'not_ok' as const,
				details: { crawlId, ts: Date.now() },
				err: res.err
			};
		}
		return jobResult as CrawlResourceResult;
	}

	async fetchResource(url: string) {
		const res = await this.getHttpContent(url);
		if (res.status === 'ok') {
			const { triples, errors } = await parseRdf(res.rdf, res.mime);
			const resCache = await ResourceCache.create({
				url,
				triples: triples
					.filter(
						(t) =>
							t.subject.termType === 'NamedNode' &&
							t.predicate.termType === 'NamedNode' &&
							t.object.termType === 'NamedNode'
					)
					.map((t) => ({
						subject: t.subject.value,
						predicate: t.predicate.value,
						object: t.object.value
					}))
			});
			// TODO do something with errors
			return { ...res, triples };
		}
		return res;
	}

	getHttpContent = async (url: string, redirect = 0): Promise<HttpRequestResult> => {
		const resp = await this.makeHttpRequest(url);
		if (resp.status === 'not_ok') {
			return resp;
		}
		const res = await this.handleHttpResponse(resp.res, redirect, url);
		return res?.status === 'ok' ? res : handleHttpError(url, res.err);
	};

	makeHttpRequest = async (url: string) => {
		const timeout = config.http.domainCrawl.timeouts || 10 * 1000;
		const maxRedirects = config.http.domainCrawl.maxRedirects || 5;
		const headers = {
			'User-Agent': config.http.userAgent,
			Accept: this.accept
		};
		await delay();
		this.emitHttpDebugEvent(url);
		const opts = {
			headers,
			// prevent axios of parsing [ld+]json
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			transformResponse: (x: any) => x,
			timeout,
			maxRedirects
		};
		try {
			const res = await axios.get(url, opts);
			return { status: 'ok' as const, res: res as MinimalAxiosResponse };
		} catch (err) {
			return { status: 'not_ok' as const, url, err: new AxiosError(err) };
		}
	};

	emitHttpDebugEvent = (url: string) => {
		this.emit('httpDebug', {
			wId: this.wId,
			type: 'request',
			url,
			ts: new Date(),
			domain: new URL(url).origin
		});
	};

	handleHttpResponse = async (resp: MinimalAxiosResponse, redirect: number, url: string) => {
		const maxRedirects = config.http.domainCrawl.maxRedirects || 5;
		const mime = contentType.parse(resp.headers['content-type']).type;
		if (!acceptedMimeTypes.some((aMT) => mime === aMT)) {
			const newUrl = findRedirectUrl(resp.headers as AxiosResponseHeaders, resp.data);
			if (!newUrl) {
				return { status: 'not_ok' as const, err: new MimeTypeError(mime) };
			}
			if (redirect >= maxRedirects) {
				return {
					status: 'not_ok' as const,
					err: new TooManyRedirectsError(url)
				};
			} // TODO list of redirect URLs?
			return this.getHttpContent(newUrl, redirect + 1);
		}
		return {
			status: 'ok' as const,
			rdf: resp.data,
			ts: Number(resp.headers['request-endTime']),
			mime
		};
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MinimalAxiosResponse = Pick<AxiosResponse<any>, 'headers' | 'data'>;
