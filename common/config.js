const secrets = require('./lib/secrets');
const _ = require('lodash');
require('dotenv').config();

let commonConf = {
  pubsub: {
    //debug: true,
    port: secrets.get('REDIS_PORT') || process.env.REDIS_PORT || 6379,
    host: secrets.get('REDIS_HOST') || process.env.REDIS_HOST || 'redis',
    manager: {
      from: 'derzis:fromManager'
    },
    workers: {
      to: 'derzis:toWorker:',
      from: 'derzis:fromWorker:'
    }
  },
  http: {
    crawlDelay: 1,
    robotsCheck: {
      timeouts: 10*1000,
    },
    domainCrawl: {
      timeouts: 10*1000,
    },
  },
};

const merge = config => _.merge(commonConf, config);

module.exports = {
  commonConf,
  merge
};
