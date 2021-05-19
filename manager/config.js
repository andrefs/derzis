let {merge} = require('../common/config');

let config = {
  db: {
    uri: 'mongodb://localhost:27017/derzis-dev'
    //debug: true
  },
  graph: {
    maxPathLength: 3,
    maxPathProps: 2
  }
};



module.exports = merge(config);
