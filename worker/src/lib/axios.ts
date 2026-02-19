import axios, { type InternalAxiosRequestConfig } from 'axios';
import http from 'http';
import https from 'https';
import type { MonkeyPatchedLogger } from '@derzis/common/server';

type MonkeyPatchedAxiosRequestConfig = InternalAxiosRequestConfig & {
  tsStart: number;
};

export default function (logger: MonkeyPatchedLogger) {
  const instance = axios.create({
    // 10 sec timeout
    timeout: 10 * 1000,

    // keepAlive pools and reuses TCP connections, so it's faster
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true }),

    // follow up to 10 HTTP 3xx redirects
    maxRedirects: 10,

    // cap the maximum content length we'll accept to 50MBs, just in case
    maxContentLength: 50 * 1000 * 1000
  });

  instance.interceptors.request.use(
    (config: InternalAxiosRequestConfig): MonkeyPatchedAxiosRequestConfig => {
      let newConfig = { ...config, tsStart: Date.now() };
      if (logger) {
        logger.http(
          newConfig?.method?.toUpperCase() + ' ' + newConfig.url,
          JSON.stringify(newConfig.headers)
        );
      }
      return newConfig;
    }
  );

  instance.interceptors.response.use(
    (response) => {
      const config = response.config as MonkeyPatchedAxiosRequestConfig;
      const now = Date.now();
      response.headers['request-startTime'] = String(config.tsStart);
      response.headers['request-endTime'] = String(now);
      response.headers['request-duration'] = String(now - config.tsStart);

      const finalUrl = (response.request as any).res?.responseUrl;
      if (finalUrl && finalUrl !== config.url) {
        if (logger) {
          logger.http(`Redirect: ${config.url} -> ${finalUrl}`, '301/302');
        }
      }

      if (logger) {
        logger.http(
          response?.config?.method?.toUpperCase() + ' ' + response.config.url,
          response.status
        );
      }
      return response;
    },
    (error) => {
      const now = Date.now();
      if (error.response) {
        error.response.headers['request-startTime'] = error.response.config.tsStart;
        error.response.headers['request-endTime'] = now;
        error.response.headers['request-duration'] = now - error.response.config.tsStart;
        if (logger) {
          logger.http(
            error.response.config.method.toUpperCase() + ' ' + error.response.config.url,
            error.response.status + ' - ' + error.response.statusText
          );
        }
      } else if (logger) {
        const status = error.code === 'ECONNABORTED' ? 'TIMEOUT' : error.code;
        logger.http(
          error.config?.method?.toUpperCase() + ' ' + error.config?.url,
          status
        );
      }
      return Promise.reject(error);
    }
  );

  return instance;
}
