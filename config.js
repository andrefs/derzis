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
    domainCheck: {
      timeouts: 10*1000,
      maxRedirects: 5
    },
    domainCrawl: {
      timeouts: 10*1000,
      maxRedirects: 5
    },
    userAgent: 'FCUP-INESCTEC/Derzis +http://github.com/andrefs/derzis DerzisBot/0.0.1',
    acceptedMimeTypes: ['text/turtle']
  },
  db: {
    debug: true
  }
};

