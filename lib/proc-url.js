const parse = require('./parse');
const axios = require('axios');

const procUrl = async  url => {
  const response = await axios.get(url);
  return parse(response.data);
};

module.exports = procUrl;
