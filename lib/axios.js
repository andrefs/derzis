const axios = require('axios');
const http = require('http');
const https = require('https');

module.exports = function(){
  const instance = axios.create({
    // 10 sec timeout
    timeout: 10*1000,

    // keepAlive pools and reuses TCP connections, so it's faster
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true }),

    // follow up to 10 HTTP 3xx redirects
    maxRedirects: 10,

    // cap the maximum content length we'll accept to 50MBs, just in case
    maxContentLength: 50 * 1000 * 1000
  });

  instance.interceptors.request.use(config => {
    config.tsStart = Date.now();
    return config;
  });

  instance.interceptors.response.use(response => {
      const now = Date.now();
      response.headers['request-startTime'] = response.config.tsStart;
      response.headers['request-endTime'] = now;
      response.headers['request-duration'] = now - response.config.tsStart;
      return response;
    },
    error => {
      const now = Date.now();
      error.response.headers['request-startTime'] = error.response.config.tsStart;
      error.response.headers['request-endTime'] = now;
      error.response.headers['request-duration'] = now - error.response.config.tsStart;
      return Promise.reject(error);
    }
  );

  return instance;
};
