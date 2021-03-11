const Promise = require('bluebird');

const setupDelay = time => {
  let p = Promise.resolve();
  return async () => {
    const q = p;
    p = Promise.delay(time, p);
    return q;
  };
};

module.exports = setupDelay;

