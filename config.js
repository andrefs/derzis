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
        capacity: 10,
        resourcesPerDomain: 100
      },
      domainCheck: {
        capacity: 1
      }
    }
  },
  http: {
    crawlDelay: 1,
    domainCheck: {
      timeouts: 10*1000,
      maxRedirects: 5
    },
    domainCrawl: {
      timeouts: 10*1000,
      maxRedirects: 5
    },
    userAgent: 'FCUP-INESCTEC/Derzis +http://github.com/andrefs/derzis DerzisBot/0.0.1',
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
    debug: true
  },
  graph: {
    maxDepth: 2
  }
};

