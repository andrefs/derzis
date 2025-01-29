import winston, { format, Logger, transports } from 'winston';
import type { LeveledLogMethod } from 'winston';
const { combine, timestamp, printf, colorize } = format;
const color = colorize().colorize;
import util from 'util';
import config from '@derzis/config';

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
};

winston.addColors(myCustomLevels.colors);

const formatMeta = (meta: { [x: string]: string }) => {
  const sbl: any = Symbol.for('splat');
  // You can format the splat yourself
  const splat = meta[sbl];
  if (splat && splat.length) {
    return splat.length === 1 ? util.inspect(splat[0]) : util.inspect(splat);
  }
  return '';
};

const customFormat = printf(
  ({ timestamp, level, message, moduleName, ...meta }) =>
    color('debug', timestamp) +
    ` [${moduleName}] ` +
    color(level, `${level}: ${message} ${formatMeta(meta)}`)
);

//}) => colorize().colorize(level, `${timestamp} [${moduleName}] ${level}: ${message} ${formatMeta(meta)}`));

enum LogLevels {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  HTTP = 'http',
  PUBSUB = 'pubsub',
  VERBOSE = 'verbose',
  DEBUG = 'debug',
  SILLY = 'silly'
}

export type MonkeyPatchedLogger = {
  [level in LogLevels]: LeveledLogMethod;
} & Logger;

const logger = winston.createLogger({
  levels: myCustomLevels.levels,
  transports: [
    new transports.Console({
      level: config.logLevel || 'debug',
      format: combine(
        //colorize({all: true}),
        timestamp(),
        customFormat
      )
    })
  ]
});

export const createLogger = (name: string): MonkeyPatchedLogger => {
  // set the default moduleName of the child
  return logger.child({ moduleName: name }) as MonkeyPatchedLogger;
};
