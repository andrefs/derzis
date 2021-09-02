const secrets = require('../common/lib/secrets');
const {merge} = require('../common/config');

let config = {
  seeds: {
    file: process.env.SEEDS_FILE || '/data/seeds.txt'
  },
  db: {
    host: secrets.get('MONGODB_HOST') || process.env.MONGODB_HOST || 'localhost',
    port: secrets.get('MONGODB_PORT') || process.env.MONGODB_PORT || '27017',
    name: secrets.get('MONGODB_NAME') || process.env.MONGODB_NAME || 'derzis-dev',
    user: secrets.get('MONGODB_USER') || process.env.MONGODB_USER || undefined,
    pass: secrets.get('MONGODB_PASS') || process.env.MONGODB_PASS || undefined,
    //debug: true
  },
  graph: {
    maxPathLength: secrets.get('MAX_PATH_LENGTH') || process.env.MAX_PATH_LENGTH || 3,
    maxPathProps: secrets.get('MAX_PATH_PROPS') || process.env.MAX_PATH_PROPS || 1
  }
};



module.exports = merge(config);
