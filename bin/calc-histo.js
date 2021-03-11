const redis = require('redis');
const config = require('../config');
const channel = redis.createClient();
const colors = require('colors');

let lastCalls = {};
let delays = {};

channel.subscribe(config.http.debug.pubsubChannel);
console.log('Listening on', config.http.debug.pubsubChannel);
channel.on('message', (channel, message) => {
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
    let delay = delays[domain];
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
