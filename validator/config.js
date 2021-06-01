
const config = {
  port: process.env.PORT || 3000,
  host: process.env.HOST || '0.0.0.0',
  staticFolder: process.env.STATIC_FOLDER || './static/'
};

module.exports = config;
