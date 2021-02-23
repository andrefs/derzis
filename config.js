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
  timeouts: {
    domainCheck: 10*1000
  },
  userAgent: 'FCUP-INESCTEC/Derzis +http://github.com/andrefs/derzis DerzisBot/0.0.1'
};

