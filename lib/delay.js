const Promise = require('bluebird');

const setupDelay = time => {
  let p = Promise.resolve();
  return async () => {
    if(p.isFulfilled()){
      p = Promise.delay(time, p);
      return Promise.resolve();
    }
    q = p;
    p = Promise.delay(time, p);
    return q;
  };
};

module.exports = setupDelay;

