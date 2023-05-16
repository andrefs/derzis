import { getSecret } from '@derzis/common';
import 'dotenv/config';
import pjson from '../../package.json';

export default {
  seeds: {
    file: process.env.SEEDS_FILE || '/data/seeds.txt',
  },
  manager: {
    db: {
      host:
        getSecret('MONGODB_HOST') || process.env.MONGODB_HOST || 'localhost',
      port: getSecret('MONGODB_PORT') || process.env.MONGODB_PORT || '27018',
      name:
        getSecret('MONGODB_NAME') || process.env.MONGODB_NAME || 'drzs-mng-dev',
      user: getSecret('MONGODB_USER') || process.env.MONGODB_USER || undefined,
      pass: getSecret('MONGODB_PASS') || process.env.MONGODB_PASS || undefined,
      debug: false,
    },
  },
  worker: {
    db: {
      host:
        getSecret('MONGODB_HOST') || process.env.MONGODB_HOST || 'localhost',
      port: getSecret('MONGODB_PORT') || process.env.MONGODB_PORT || '27018',
      name:
        getSecret('MONGODB_NAME') || process.env.MONGODB_NAME || 'drzs-wrk-dev',
      user: getSecret('MONGODB_USER') || process.env.MONGODB_USER || undefined,
      pass: getSecret('MONGODB_PASS') || process.env.MONGODB_PASS || undefined,
      debug: false,
    },
  },
  graph: {
    maxPathLength:
      Number(getSecret('MAX_PATH_LENGTH')) ||
      Number(process.env.MAX_PATH_LENGTH) ||
      10,
    maxPathProps:
      Number(getSecret('MAX_PATH_PROPS')) ||
      Number(process.env.MAX_PATH_PROPS) ||
      4,
  },
  pubsub: {
    debug: false,
    port: getSecret('REDIS_PORT') || process.env.REDIS_PORT || 6378,
    host: getSecret('REDIS_HOST') || process.env.REDIS_HOST || 'localhost',
    manager: {
      from: 'derzis:fromManager',
    },
    workers: {
      to: 'derzis:toWorker:',
      from: 'derzis:fromWorker:',
    },
  },
  periodicallyRepCurCap: 10 * 1000,
  jobs: {
    domainCrawl: {
      capacity: 10,
      resourcesPerDomain: 10,
    },
    robotsCheck: {
      capacity: 10,
    },
  },
  http: {
    crawlDelay: 1,
    robotsCheck: {
      timeouts: 10 * 1000,
      maxRedirects: 5,
    },
    resourceCrawl: {
      timeouts: 10 * 1000,
    },
    domainCrawl: {
      timeouts: 10 * 1000,
      maxRedirects: 5,
    },
    userAgent: `FCUP-INESCTEC/Derzis +http://github.com/andrefs/derzis DerzisBot/${pjson.version}`,
    acceptedMimeTypes: [
      'text/turtle',
      'application/trig',
      'application/n-quads',
      'application/n-triples',
      'text/n3',
      'application/ld+json',
      'application/rdf+xml',
    ],
    debug: {
      pubsubChannel: 'derzis:http',
    },
    serverPort: 5432,
  },
};
