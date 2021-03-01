const winston = require('winston');
const {createLogger, format, transports} = winston;
const {combine, timestamp, splat, label, printf, colorize} = format;
const color = colorize().colorize;

const myCustomLevels = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    pubsub: 4,
    verbose: 5,
    debug: 6,
    silly: 7
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    info: 'blue',
    http: 'magenta',
    pubsub: 'cyan',
    verbose: 'gray',
    debug: 'grey',
    silly: 'grey'
  }
}

winston.addColors(myCustomLevels.colors);

const formatMeta = (meta) => {
  // You can format the splat yourself
  const splat = meta[Symbol.for('splat')];
  if (splat && splat.length) {
    return splat.length === 1 ? JSON.stringify(splat[0], 2, null) : JSON.stringify(splat, 2, null);
  }
  return '';
};

const customFormat = winston.format.printf(({
  timestamp,
  level,
  message,
  moduleName,
  ...meta
}) => color('debug', timestamp) +
      ` [${moduleName}] ` +
      color(level, `${level}: ${message} ${formatMeta(meta)}`));

//}) => colorize().colorize(level, `${timestamp} [${moduleName}] ${level}: ${message} ${formatMeta(meta)}`));


const logger = createLogger({
  levels: myCustomLevels.levels,
  transports: [
    new transports.Console({
      level: 'debug',
      format: combine(
        //colorize({all: true}),
        timestamp(),
        customFormat
      )
    })
  ]
});

module.exports = function(name) {
  // set the default moduleName of the child
  return logger.child({moduleName: name});
};
