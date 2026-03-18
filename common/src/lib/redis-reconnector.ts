import { createClient, type RedisClientType } from 'redis';
import { createLogger } from './logger';

const log = createLogger('RedisReconnector');

export type RedisReconnectorEvents = {
  connecting: () => void;
  connected: () => void;
  disconnecting: () => void;
  disconnected: () => void;
  reconnecting: (attempt: number, error: Error) => void;
  reconnected: () => void;
  error: (error: Error) => void;
  gaveUp: (error: Error) => void;
};

export class RedisReconnector {
  private readonly opts: { url: string };
  private readonly maxRetryTime: number;
  private client: RedisClientType;
  private abortController: AbortController;
  private eventListeners: Map<keyof RedisReconnectorEvents, Function[]> = new Map();
  private _isConnected = false;
  private _isReconnecting = false;
  private retryCount = 0;
  private lastError: Error | null = null;

  constructor(opts: { url: string }, maxRetryTime = 60000) {
    this.opts = opts;
    this.maxRetryTime = maxRetryTime;
    this.client = createClient(opts);
    this.abortController = new AbortController();
    this.setupClientEventListeners();
  }

  private setupClientEventListeners(): void {
    this.client.on('error', (error) => {
      log.error('Redis client error:', error.message);
      this.lastError = error;
      this.emit('error', error);
    });

    this.client.on('end', () => {
      log.info('Redis connection ended');
      this._isConnected = false;
      this.emit('disconnected');
    });

    this.client.on('reconnecting', (delay: number, attempt: number) => {
      log.info(`Redis reconnection attempt ${attempt} in ${delay}ms`);
      this._isReconnecting = true;
      this.retryCount = attempt;
      this.emit('reconnecting', attempt, new Error('Reconnecting'));
    });

    this.client.on('connect', () => {
      log.info('Redis connecting...');
      this.emit('connecting');
    });

    this.client.on('ready', () => {
      log.info('Redis ready');
      this._isConnected = true;
      this._isReconnecting = false;
      this.retryCount = 0;
      this.emit('reconnected');
    });
  }

  get clientInstance(): RedisClientType {
    return this.client;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  get isReconnecting(): boolean {
    return this._isReconnecting;
  }

  getRetryInfo(): { count: number; lastError: Error | null } {
    return { count: this.retryCount, lastError: this.lastError };
  }

  on<T extends keyof RedisReconnectorEvents>(event: T, listener: RedisReconnectorEvents[T]): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener as Function);
  }

  off<T extends keyof RedisReconnectorEvents>(event: T, listener: RedisReconnectorEvents[T]): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener as Function);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  private emit<T extends keyof RedisReconnectorEvents>(
    event: T,
    ...args: Parameters<RedisReconnectorEvents[T]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          (listener as Function)(...args);
        } catch (err) {
          console.error(`Error in ${event} listener:`, err);
        }
      });
    }
  }

  async connect(): Promise<void> {
    log.info(`Connecting to Redis at ${this.opts.url}`);

    const startTime = Date.now();
    let attempt = 0;
    let backoff = 1000; // Start with 1 second

    while (true) {
      attempt++;

      // Check if we should give up
      if (Date.now() - startTime > this.maxRetryTime) {
        const error = new Error(`Max retry time (${this.maxRetryTime}ms) exceeded`);
        this.emit('gaveUp', error);
        throw error;
      }

      // Check for abort signal
      if (this.abortController.signal.aborted) {
        throw new Error('Reconnection aborted');
      }

      try {
        if (!this.client.isOpen) {
          await this.client.connect();
        }
        log.info('Redis connection established');
        this._isConnected = true;
        this._isReconnecting = false;
        this.retryCount = 0;
        this.emit('connected');
        return;
      } catch (error) {
        this.lastError = error as Error;
        log.warn(`Redis connection attempt ${attempt} failed:`, (error as Error).message);
        this.emit('reconnecting', attempt, error as Error);
      }

      // Wait before retry with exponential backoff capped at 30 seconds
      await new Promise((resolve) => setTimeout(resolve, backoff));
      backoff = Math.min(backoff * 2, 30000);
    }
  }

  async disconnect(): Promise<void> {
    log.info('Disconnecting from Redis');
    this.emit('disconnecting');
    this._isConnected = false;

    try {
      await this.client.quit();
      log.info('Redis disconnected');
    } catch (error) {
      log.error('Error disconnecting from Redis:', (error as Error).message);
    }
  }

  abort(): void {
    log.info('Aborting Redis reconnection');
    this.abortController.abort();
  }
}
