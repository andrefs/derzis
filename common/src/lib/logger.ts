// Simple logger implementation using console
// Custom levels enum to match winston
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
  [level in LogLevels]: (msg: string, ...args: any[]) => void;
};

// Create a simple logger that uses console
export const createLogger = (name: string): MonkeyPatchedLogger => {
  const log = (level: string, msg: string, ...args: any[]) => {
    console.log(`[${new Date().toISOString()}] [${name}] ${level}: ${msg}`, ...args);
  };

  return {
    error: (msg: string, ...args: any[]) => log('ERROR', msg, ...args),
    warn: (msg: string, ...args: any[]) => log('WARN', msg, ...args),
    info: (msg: string, ...args: any[]) => log('INFO', msg, ...args),
    http: (msg: string, ...args: any[]) => log('HTTP', msg, ...args),
    pubsub: (msg: string, ...args: any[]) => log('PUBSUB', msg, ...args),
    verbose: (msg: string, ...args: any[]) => log('VERBOSE', msg, ...args),
    debug: (msg: string, ...args: any[]) => log('DEBUG', msg, ...args),
    silly: (msg: string, ...args: any[]) => log('SILLY', msg, ...args),
  };
};