import { config } from 'dotenv';
config({ path: '../.env' });
const version = process.env.npm_package_version || '0.0.1';

export default {
  seeds: {
    file: process.env.SEEDS_FILE || '/data/seeds.txt'
  },
  manager: {
    db: {
      host: process.env.MONGODB_HOST || 'localhost',
      port: process.env.MONGODB_PORT || '27017',
      name: process.env.MANAGER_DATABASE || 'drzs-mng-default',
      user: process.env.MONGODB_USER || undefined,
      pass: process.env.MONGODB_PASS || undefined,
      debug: true
    }
  },
  worker: {
    db: {
      host: process.env.MONGODB_HOST || 'localhost',
      port: process.env.MONGODB_PORT || '27017',
      name: process.env.WORKER_DATABASE || 'drzs-wrk-default',
      user: process.env.MONGODB_USER || undefined,
      pass: process.env.MONGODB_PASS || undefined,
      debug: true
    }
  },
  graph: {
    maxPathLength: Number(process.env.MAX_PATH_LENGTH) || 2,
    maxPathProps: Number(process.env.MAX_PATH_PROPS) || 1
  },
  pubsub: {
    debug: false,
    port: process.env.REDIS_PORT || 6379,
    host: process.env.REDIS_HOST || 'localhost',
    manager: {
      from: 'derzis:fromManager'
    },
    workers: {
      to: 'derzis:toWorker:',
      from: 'derzis:fromWorker:'
    }
  },
  periodicallyRepCurCap: 10 * 1000,
  jobs: {
    domainCrawl: {
      capacity: 1,
      resourcesPerDomain: 1
    },
    robotsCheck: {
      capacity: 1
    }
  },
  http: {
    crawlDelay: 1,
    robotsCheck: {
      timeouts: 10 * 1000,
      maxRedirects: 5
    },
    resourceCrawl: {
      timeouts: 10 * 1000
    },
    domainCrawl: {
      timeouts: 10 * 1000,
      maxRedirects: 5
    },
    userAgent: `FCUP-INESCTEC/Derzis +http://github.com/andrefs/derzis DerzisBot/${version}`,
    acceptedMimeTypes: [
      'text/turtle',
      'application/trig',
      'application/n-quads',
      'application/n-triples',
      'text/n3',
      'application/ld+json',
      'application/rdf+xml'
    ],
    debug: {
      pubsubChannel: 'derzis:http'
    },
    serverPort: 5432
  }
};
