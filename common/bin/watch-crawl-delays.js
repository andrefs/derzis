const redis = require('redis');
const config = require('../config').commonConf;
const client = redis.createClient({url: 'redis://localhost:6378'});
const colors = require('colors');

const run = async () => {
  let lastCalls = {};
  let delays = {};

  await client.connect();
  const subscriber = client.duplicate();
  subscriber.connect();
  console.log('Listening on', config.http.debug.pubsubChannel);
  
  try {
    await subscriber.subscribe(config.http.debug.pubsubChannel, (message, channelName) => {
      //console.log(lastCalls, delays);
      const obj = JSON.parse(message);
      if(obj.type === 'delay'){
        delays[obj.domain] = obj.delay;
        return;
      }
      if(obj.type === 'request'){
        const {wId, domain, url, ts} = obj;
        if(!delays[domain]){
          console.warn('No Crawl-Delay for domain', domain);
        }
        let delay = delays[domain] ? delays[domain] : undefined;
        if(lastCalls[domain]){
          let timeInt = ''+(new Date(ts) - new Date(lastCalls[domain]))/1000;
          timeInt = timeInt < delays[domain] ? timeInt.red : timeInt.green;
          delay = delay > config.http.crawlDelay ? (''+delay).yellow : delay;
          console.log(wId, domain+':', timeInt, `(${delay})`);
        }
        lastCalls[domain] = ts;
        return;
      }
    });
  }
  catch(e){
    console.log('Error', e)
  }
};

run().then(() => console.log('Exited'))
