const fs = require("fs");
const util = require("util");

const get = secret => {
  try{
    // Swarm secret are accessible within tmpfs /run/secrets dir
    return fs.readFileSync(util.format("/run/secrets/%s", secret), "utf8").trim();
  }
  catch(e){ return false; }
}

module.exports = {
  get
};
