import {getSecret} from './common/lib/secrets';
import _ from 'lodash';
import 'dotenv/config';

export const commonConf = {
  pubsub: {
    //debug: true,
    port: getSecret('REDIS_PORT') || process.env.REDIS_PORT || 6378,
    host: getSecret('REDIS_HOST') || process.env.REDIS_HOST || 'localhost',
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

export const merge = config => _.merge(commonConf, config);

