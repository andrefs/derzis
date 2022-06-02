import {createClient} from 'redis';
import config from '@derzis/config';
const redisOpts = {url : `redis://${config.pubsub.host}:${config.pubsub.port}`};
const client = createClient(redisOpts);
import chalk from 'chalk';

const run = async () => {
  let lastCalls: {[origin: string]: number};
  let delays: {[origin: string]: number};

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
        const {wId, domain, ts} = obj;
        if(!delays[domain]){
          console.warn('No Crawl-Delay for domain', domain);
        }
        let delay: number | string | undefined = delays[domain] ? delays[domain] : undefined;
        if(lastCalls[domain]){
          let timeInt: number | string = ((new Date(ts).getTime() - new Date(lastCalls[domain]).getTime())/1000);
          timeInt = timeInt < delays[domain] ?
            chalk.red(timeInt.toString()) :
            chalk.green(timeInt.toString());
          delay = delay && delay > config.http.crawlDelay ? chalk.yellow(''+delay) : delay;
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
