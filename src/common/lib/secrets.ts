import {readFileSync} from 'fs';
import {format} from 'util';

export const getSecret = secret => {
  try{
    // Swarm secret are accessible within tmpfs /run/secrets dir
    return readFileSync(format("/run/secrets/%s", secret), "utf8").trim();
  }
  catch(e){ return false; }
};
