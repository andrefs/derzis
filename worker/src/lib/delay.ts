import Bluebird from 'bluebird';

const setupDelay = (time: number) => {
  let p = Bluebird.resolve();
  return Bluebird.method(() => {
    const q = p;
    p = Bluebird.delay(time, p);
    return q;
  });
};

export default setupDelay;
