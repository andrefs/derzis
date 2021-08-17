const got = require('got');
const config = require('../config');
require('global-agent/bootstrap');

const gotConf = {
  // 10 sec timeout
  timeout: 10*1000,

  // follow up to 10 HTTP 3xx redirects
  maxRedirects: 10,
};

module.exports = (url, options={}) => got(url, {...gotConf, ...options});

// module.exports = function(logger){
//   const instance = axios.create({
//     // keepAlive pools and reuses TCP connections, so it's faster
//     httpAgent: new http.Agent({ keepAlive: true }),
//     httpsAgent: new https.Agent({ keepAlive: true }),
// 
//     // use proxy
//     //proxy: config.proxy,
//     proxy: {
//       host: 'localhost',
//       port: 3128
//     },
// 
//     // cap the maximum content length we'll accept to 50MBs, just in case
//     maxContentLength: 50 * 1000 * 1000
//   });
// 
//   instance.interceptors.request.use(config => {
//     config.tsStart = Date.now();
//     if(logger){ logger.http(config.method.toUpperCase()+' '+config.url, JSON.stringify(config.headers)); }
//     return config;
//   });
// 
// 
//   instance.interceptors.response.use(response => {
//     console.log('XXXXXXXXXXXXXxxx 0');
//     console.log('XXXXXXXXXXXXXxxx 1', response.request.res.fetchedUrls);
//       const now = Date.now();
//       response.headers['request-startTime'] = response.config.tsStart;
//       response.headers['request-endTime'] = now;
//       response.headers['request-duration'] = now - response.config.tsStart;
//       if(logger){ logger.http(response.config.method.toUpperCase()+' '+response.config.url, response.status); }
//       return response;
//     },
//     error => {
//       const now = Date.now();
//       if(error.response){
//         error.response.headers['request-startTime'] = error.response.config.tsStart;
//         error.response.headers['request-endTime'] = now;
//         error.response.headers['request-duration'] = now - error.response.config.tsStart;
//         if(logger){ logger.http(error.response.config.method.toUpperCase()+' '+error.response.config.url, error.response.status+' - '+error.response.statusText); }
//       }
//       return Promise.reject(error);
//     }
//   );
// 
//   return instance;
// };
