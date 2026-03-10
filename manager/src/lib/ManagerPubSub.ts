import config from '@derzis/config';
import { createClient } from 'redis';
import { MAILTRAP_API_TOKEN } from '@derzis/common/server';
import { createLogger } from '@derzis/common';
import { RedisReconnector } from '@derzis/common';
const log = createLogger('Manager');
import Manager from './Manager';
import process from 'process';
import type { JobCapacity, Message } from '@derzis/common';
import { Process } from '@derzis/models';

const REDIS_OPTS = {
  url: `redis://${config.pubsub.host}:${config.pubsub.port}`
};

/** PubSub wrapper for Manager */
class ManagerPubSub {
  _m: Manager;
  _redisReconnector: RedisReconnector;
  _pubReconnector: RedisReconnector;
  _subReconnector: RedisReconnector;
  _broadReconnector: RedisReconnector;
  _pub!: any;
  _sub!: any;
  _broad!: any;
  _pubChannel!: string;
  _broadChannel!: string;
  _messageHandler!: (msg: string, channel: string) => Promise<void>;
  // Store references to event handlers for cleanup
  private _reconnectorHandlers: Map<RedisReconnector, Map<string, Function>> = new Map();
  private _jobTimeoutHandler?: (payload: any) => void;

  constructor() {
    this._m = new Manager();
    this._redisReconnector = new RedisReconnector(REDIS_OPTS);
    this._pubReconnector = new RedisReconnector(REDIS_OPTS);
    this._subReconnector = new RedisReconnector(REDIS_OPTS);
    this._broadReconnector = new RedisReconnector(REDIS_OPTS);
    this.setupReconnectionHandlers();
    this.listenManager();
  }

  private setupReconnectionHandlers(): void {
    // Handle main Redis reconnection
    const onReconnected = async () => {
      log.info('Main Redis reconnected, reconnecting pub/sub clients');
      try {
        await this.reconnectClients();
        this.resubscribe();
      } catch (err) {
        log.error('Error resubscribing after reconnection:', err);
      }
    };
    this._redisReconnector.on('reconnected', onReconnected);
    this.storeHandler(this._redisReconnector, 'reconnected', onReconnected);

    const onGaveUp = (error: Error) => {
      log.error('Redis reconnection failed, giving up:', error.message);
      process.exit(1);
    };
    this._redisReconnector.on('gaveUp', onGaveUp);
    this.storeHandler(this._redisReconnector, 'gaveUp', onGaveUp);

    // Also monitor pub/sub reconnectors
    const monitorReconnector = (
      reconnector: RedisReconnector,
      name: string,
      isSubscriber: boolean
    ) => {
      const onReconnectedPub = () => {
        log.info(`${name} Redis reconnected`);
      };
      reconnector.on('reconnected', onReconnectedPub);
      this.storeHandler(reconnector, 'reconnected', onReconnectedPub);

      const onError = (error: Error) => {
        log.error(`${name} Redis error:`, error.message);
      };
      reconnector.on('error', onError);
      this.storeHandler(reconnector, 'error', onError);

      const onDisconnected = () => {
        log.warn(`${name} Redis disconnected`);
      };
      reconnector.on('disconnected', onDisconnected);
      this.storeHandler(reconnector, 'disconnected', onDisconnected);

      const onGaveUpPub = (error: Error) => {
        log.error(`${name} Redis reconnection failed:`, error.message);
      };
      reconnector.on('gaveUp', onGaveUpPub);
      this.storeHandler(reconnector, 'gaveUp', onGaveUpPub);
    };

    monitorReconnector(this._pubReconnector, 'Pub', false);
    monitorReconnector(this._subReconnector, 'Sub', true);
    monitorReconnector(this._broadReconnector, 'Broad', false);
  }

  private storeHandler(reconnector: RedisReconnector, event: string, handler: Function): void {
    if (!this._reconnectorHandlers.has(reconnector)) {
      this._reconnectorHandlers.set(reconnector, new Map());
    }
    this._reconnectorHandlers.get(reconnector)!.set(event, handler);
  }

  private async reconnectClients(): Promise<void> {
    // Disconnect old clients if they exist and are open
    if (this._pub && this._pub.isOpen) {
      await this._pub.quit();
    }
    if (this._sub && this._sub.isOpen) {
      await this._sub.quit();
    }
    if (this._broad && this._broad.isOpen) {
      await this._broad.quit();
    }

    // Replace with new client instances from reconnectors
    this._pub = this._pubReconnector.clientInstance;
    this._sub = this._subReconnector.clientInstance;
    this._broad = this._broadReconnector.clientInstance;

    // Ensure all clients are connected
    if (!this._pub.isOpen) {
      await this._pubReconnector.connect();
    }
    if (!this._sub.isOpen) {
      await this._subReconnector.connect();
    }
    if (!this._broad.isOpen) {
      await this._broadReconnector.connect();
    }
  }

  private async resubscribe(): Promise<void> {
    if (!this._messageHandler) {
      log.warn('No message handler to resubscribe');
      return;
    }
    const pattern = config.pubsub.workers.from + '*';
    log.info(`Resubscribing to ${pattern}`);

    // Unsubscribe first to prevent duplicate handlers
    try {
      await this._sub.pUnsubscribe(pattern);
    } catch (err) {
      log.warn('Error unsubscribing during resubscribe:', err);
    }

    const maxRetries = 5;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this._sub.pSubscribe(pattern, (msg: string, channel: string) =>
          this._messageHandler(msg, channel)
        );
        log.info(`Resubscribe successful on attempt ${attempt}`);
        return;
      } catch (err) {
        log.warn(`Resubscribe attempt ${attempt} failed:`, err as Error);
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        } else {
          log.error('Resubscribe failed after all retries');
          throw err;
        }
      }
    }
  }

  listenManager() {
    this._jobTimeoutHandler = (payload: any) => {
      return this.broad({ type: 'jobTimeout', payload });
    };
    this._m.jobs.on('jobTimeout', this._jobTimeoutHandler);
  }

  async start() {
    log.info('Started');
    await this._m.jobs.cancelAllJobs();
    await this.connect();
    // In case the manager was killed while some jobs were being extended, we set them back to queued so that they can be reassigned
    await Process.updateMany({ status: 'extending' }, { status: 'queued' });
    //await this._m.startNewProcess();
    this.askCurrentCapacity();
  }

  async connect() {
    log.info('Using Mailtrap API token ' + '...' + MAILTRAP_API_TOKEN.slice(-4));
    log.info('Connecting to Redis');

    process.on('SIGINT', this.handleSignal('SIGINT'));
    process.on('SIGTERM', this.handleSignal('SIGTERM'));

    process.on('uncaughtException', (...args) => {
      log.error('Uncaught exception', args);
      this.shutdown();
      this._redisReconnector.abort();
      this._pubReconnector.abort();
      this._subReconnector.abort();
      this._broadReconnector.abort();
      process.exit(1);
    });

    try {
      await this._redisReconnector.connect();
      await this._pubReconnector.connect();
      await this._subReconnector.connect();
      await this._broadReconnector.connect();

      this._pub = this._pubReconnector.clientInstance;
      this._sub = this._subReconnector.clientInstance;
      this._broad = this._broadReconnector.clientInstance;
    } catch (error) {
      log.error('Failed to connect to Redis:', (error as Error).message);
      throw error;
    }

    log.pubsub(`Subscribing to ${config.pubsub.workers.from.replace(/-.*$/, '')}*`);

    this._messageHandler = async (msg: string, channel: string) => {
      const workerId = channel.match(/:([-\w]+)$/)?.[1];
      const message: Message = JSON.parse(msg);
      log.pubsub('Got message from ' + channel.replace(/-.*$/, ''), message.type);
      if (Object.keys(message.payload).length) {
        log.debug('', message.payload);
      }
      if (message.type === 'repCurCap') {
        return await this.assignJobs(workerId!, message.payload);
      }
      if (message.type === 'jobDone') {
        await this._m.updateJobResults(message.payload);
        // Simple delay: wait config.manager.pauseAfterJob seconds before asking for capacity
        if (config.manager.pauseAfterJob) {
          await new Promise((resolve) => setTimeout(resolve, config.manager.pauseAfterJob * 1000));
          this.askCurrentCapacity();
        }
      }
      if (message.type === 'shutdown') {
        await this._m.jobs.cancelWorkerJobs(message.payload.ongoingJobs, workerId!);
      }
      if (message.type === 'noCapacity' || message.type === 'alreadyBeingDone') {
        const reason =
          message.type === 'noCapacity'
            ? `worker ${workerId} has no capacity`
            : `it is already being done by worker ${workerId}`;
        log.info(
          `Job #${message.payload.jobId} ${message.payload.jobType}` +
            ` on ${message.payload.origin} was refused because ${reason}`
        );
        await this._m.jobs.cancelJob(message.payload.origin, message.payload.jobType);
      }
    };

    this._sub.pSubscribe(config.pubsub.workers.from + '*', (msg: string, channel: string) =>
      this._messageHandler(msg, channel)
    );

    this._broadChannel = config.pubsub.manager.from;
    log.pubsub(`Broadcasting to ${this._broadChannel}`);
    this._pubChannel = config.pubsub.workers.to;
    log.pubsub(`Publishing to ${this._pubChannel}{workerId}`);
  }

  private handleSignal(signal: string): () => void {
    return () => {
      log.info(`Received ${signal}, shutting down gracefully`);
      this.shutdown();
      process.exit(0);
    };
  }

  private shutdown(): void {
    log.info('Shutting down ManagerPubSub, removing event listeners');

    // Remove jobTimeout listener
    if (this._jobTimeoutHandler) {
      this._m.jobs.off('jobTimeout', this._jobTimeoutHandler);
      this._jobTimeoutHandler = undefined;
      log.debug('Removed jobTimeout listener');
    }

    // Remove all RedisReconnector listeners
    for (const [reconnector, events] of this._reconnectorHandlers.entries()) {
      for (const [event, handler] of events.entries()) {
        // Use 'off' method to remove the listener
        (reconnector as any).off?.(event, handler);
        // Since RedisReconnector doesn't have a public off method for all events,
        // we need to call off on the underlying client's event emitter for some events
        // But reconnector.off is defined in the class - let's try to use it
        try {
          reconnector.off?.(event as any, handler);
        } catch (err) {
          log.warn(`Could not remove listener for ${event} on reconnector:`, err);
        }
      }
    }
    this._reconnectorHandlers.clear();

    log.info('Event cleanup complete');
  }

  pub(workerId: string, { type, payload }: Message) {
    const channel = this._pubChannel + workerId;
    log.pubsub('Publishing message to ' + channel.replace(/-.*$/, ''), type);
    if (Object.keys(payload).length) {
      log.debug('', payload);
    }
    this._pub.publish(channel, JSON.stringify({ type, payload }));
  }

  broad({ type, payload }: Message) {
    log.pubsub('Broadcasting message to ' + this._broadChannel, type);
    if (Object.keys(payload).length) {
      log.debug('', payload);
    }
    this._broad.publish(this._broadChannel, JSON.stringify({ type, payload }));
  }

  askCurrentCapacity(workerId?: string) {
    const message = { type: 'askCurCap' as const, payload: {} };
    if (workerId) {
      return this.pub(workerId, message);
    }
    return this.broad(message);
  }

  //askStatus(workerId){
  //  if(workerId){ return this.pub(workerId, 'askStatus'); }
  //  return this.broad('askStatus');
  //}

  async assignJobs(workerId: string, workerAvail: JobCapacity) {
    for await (const job of this._m.assignJobs(workerId, workerAvail)) {
      this.pub(workerId, { type: 'doJob', payload: job });
    }
  }
}
export default ManagerPubSub;
