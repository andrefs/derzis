import pino from 'pino';
import { Writable } from 'stream';
import * as colorette from 'colorette';
import config from '@derzis/config';
import util from 'util';

// Custom levels to match winston
const levels = {
  error: 50,
  warn: 40,
  info: 30,
  http: 25,
  pubsub: 20,
  verbose: 15,
  debug: 10,
  silly: 5
};

const levelNames = Object.fromEntries(Object.entries(levels).map(([k, v]) => [v, k]));

const levelColors: Record<number, (s: string) => string> = {
  50: colorette.red, // error
  40: colorette.yellow, // warn
  30: colorette.blue, // info
  25: colorette.magenta, // http
  20: colorette.cyan, // pubsub
  15: colorette.gray, // verbose
  10: colorette.gray, // debug
  5: colorette.gray // silly
};

const getColor = (level: number) => {
  return levelColors[level] || colorette.white;
};

const customTransport = new Writable({
  write(chunk, enc, cb) {
    try {
      const log = JSON.parse(chunk.toString());
      const levelColor = getColor(log.level);
      const name = log.name || '';
      const levelName = levelNames[log.level] || 'unknown';
      const formatted = `${colorette.gray(log.time)} ${colorette.white(`[${name}]`)} ${levelColor(`${levelName.toUpperCase()}: ${log.msg}`)}`;
      console.log(formatted);
    } catch (err) {
      console.error('Error in custom transport:', err);
    }
    cb();
  }
});

const logger = pino(
  {
    customLevels: levels,
    useOnlyCustomLevels: true,
    level: config.logLevel || 'debug',
    timestamp: pino.stdTimeFunctions.isoTime
  },
  customTransport
);

export type MonkeyPatchedLogger = {
  error: (msg: string, ...args: any[]) => void;
  warn: (msg: string, ...args: any[]) => void;
  info: (msg: string, ...args: any[]) => void;
  http: (msg: string, ...args: any[]) => void;
  pubsub: (msg: string, ...args: any[]) => void;
  verbose: (msg: string, ...args: any[]) => void;
  debug: (msg: string, ...args: any[]) => void;
  silly: (msg: string, ...args: any[]) => void;
};

const formatArgs = (msg: string, ...args: any[]) => {
  if (args.length === 0) return msg;
  return msg + ' ' + args.map((a) => util.inspect(a, { colors: true })).join(' ');
};

export const createLogger = (name: string): MonkeyPatchedLogger => {
  const child = logger.child({ name }) as any;
  return {
    error: (msg: string, ...args: any[]) => child.error(formatArgs(msg, ...args)),
    warn: (msg: string, ...args: any[]) => child.warn(formatArgs(msg, ...args)),
    info: (msg: string, ...args: any[]) => child.info(formatArgs(msg, ...args)),
    http: (msg: string, ...args: any[]) => child.http(formatArgs(msg, ...args)),
    pubsub: (msg: string, ...args: any[]) => child.pubsub(formatArgs(msg, ...args)),
    verbose: (msg: string, ...args: any[]) => child.verbose(formatArgs(msg, ...args)),
    debug: (msg: string, ...args: any[]) => child.debug(formatArgs(msg, ...args)),
    silly: (msg: string, ...args: any[]) => child.silly(formatArgs(msg, ...args))
  };
};
