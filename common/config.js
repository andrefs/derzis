const _ = require('lodash');

let commonConf = {
  pubsub: {
    // TODO: host, port, etc
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
