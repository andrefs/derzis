const secrets = require('./lib/secrets');
const _ = require('lodash');
require('dotenv').config();

let commonConf = {
  pubsub: {
    //debug: true,
    port: secrets.get('REDIS_PORT') || process.env.REDIS_PORT || 6378,
    host: secrets.get('REDIS_HOST') || process.env.REDIS_HOST || 'localhost',
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
    debug: {
      pubsubChannel: 'derzis:http',
    }
  },
};

const merge = config => _.merge(commonConf, config);

module.exports = {
  commonConf,
  merge
};
