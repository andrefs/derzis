module.exports = {
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
  workers: {
    periodicallyRepCurCap: 10*1000,
    jobs: {
      domainCrawl:{
        capacity: 1,
        resourcesPerDomain: 1
      },
      robotsCheck: {
        capacity: 1
      }
    }
  },
  http: {
    crawlDelay: 1,
    robotsCheck: {
      timeouts: 10*1000,
      maxRedirects: 5
    },
    domainCrawl: {
      timeouts: 10*1000,
      maxRedirects: 5
    },
    userAgent: 'FCUP-INESCTEC/Derzis +http://github.com/andrefs/derzis DerzisBot/0.0.2',
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
      pubsubChannel: 'derzis:http',
    }
  },
  db: {
    name: 'test-paths',
    debug: true
  },
  graph: {
    maxDepth: 5,
    maxPathProps: 2
  }
};

