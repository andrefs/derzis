import { describe, it, expect } from 'vitest';
import { createLogger } from './index';

describe('Logger', () => {
  it('should create logger without error', () => {
    const log = createLogger('TestLogger');
    expect(log).toBeDefined();
    expect(typeof log.info).toBe('function');
    expect(typeof log.error).toBe('function');
  });

  it('should call info without throwing', () => {
    const log = createLogger('TestLogger');
    expect(() => log.info('Test message')).not.toThrow();
    expect(() => log.error('Error message')).not.toThrow();
    expect(() => log.debug('Debug message')).not.toThrow();
  });
});
