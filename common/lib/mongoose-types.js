const {isValid} = require('./url');

const urlType = {
  type: String,
  validator: url => isValid(url),
  message: p => `${p.value} is not a valid URL!`
};

module.exports = {
  urlType
};
