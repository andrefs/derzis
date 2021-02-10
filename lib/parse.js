const N3 = require('n3');
const parser = new N3.Parser();


const parse = string => {
  let done = false;
  const pullQueue = [];
  const pushQueue = [];

  const handler = (resolve, reject) => {
    return ({err, quad, prefs}) => {
      if(err){
        done = true;
        reject(err);
      } else if(prefs){
        done = true;
        resolve();
      } else {
        resolve(quad);
      }
    };
  };

  const pushValue = async (args) => {
    if(pullQueue.length !== 0){
      const resolver = pullQueue.shift();
      resolver(args);
    } else {
      pushQueue.push(args);
    }
  }

  const pullValue = () => {
    return new Promise((resolve, reject) => {
      const resolver = handler(resolve, reject);
      if(pushQueue.length !== 0){
        resolver(pushQueue.shift());
      } else {
        pullQueue.push(resolver);
      }
    });
  }

  parser.parse(string, (err, quad, prefs) => pushValue({err, quad, prefs}));

  return {
    [Symbol.asyncIterator](){
      return this;
    },
    next: () => ({
      done,
      value: done ? undefined : pullValue()
    })
  }
};


module.exports = parse;
