const secrets = require('../common/lib/secrets');
const {merge} = require('../common/config');

let config = {
  db: {
    host: secrets.get('MONGODB_HOST') || process.env.MONGODB_HOST || 'mongo',
    port: secrets.get('MONGODB_PORT') || process.env.MONGODB_PORT || '27017',
    name: secrets.get('MONGODB_NAME') || process.env.MONGODB_NAME || 'derzis-dev',
    user: secrets.get('MONGODB_USER') || process.env.MONGODB_USER || undefined,
    pass: secrets.get('MONGODB_PASS') || process.env.MONGODB_PASS || undefined,
    //uri: 'mongodb://localhost:27017/derzis-dev'
    //debug: true
  },
  graph: {
    maxPathLength: 2,
    maxPathProps: 1
  }
};



module.exports = merge(config);
