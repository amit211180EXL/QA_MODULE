import { Module, Global } from '@nestjs/common';
import { getEnv } from '@qa/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Minimal stub that satisfies the Redis interface when REDIS_ENABLED=false.
 * All command methods resolve immediately so nothing blocks.
 */
function buildStub(): Redis {
  const noop = () => Promise.resolve(null as never);
  const stub = Object.create(null) as Redis;

  // Status check used by ioredis internals
  Object.defineProperty(stub, 'status', { get: () => 'ready', configurable: true });

  // Event emitter stubs (Nest / BullMQ may call these at init time)
  stub.on = () => stub;
  (stub as { off: unknown }).off = () => stub;
  stub.once = () => stub;
  (stub as { emit: unknown }).emit = () => false as never;
  (stub as { removeListener: unknown }).removeListener = () => stub;
  (stub as { removeAllListeners: unknown }).removeAllListeners = () => stub;

  // Connection lifecycle
  (stub as { connect: unknown }).connect = noop;
  stub.disconnect = noop;
  stub.quit = noop;
  (stub as { duplicate: unknown }).duplicate = () => buildStub();

  // Common Redis commands used in this codebase
  stub.get = noop;
  stub.set = noop;
  stub.del = noop;
  stub.ping = () => Promise.resolve('PONG' as never);
  (stub as { expire: unknown }).expire = noop;
  (stub as { exists: unknown }).exists = noop;

  return stub;
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const env = getEnv();

        if (env.REDIS_ENABLED === 'false') {
          console.warn(
            '[Redis] REDIS_ENABLED=false — running without Redis. Queues and password-reset features are disabled.',
          );
          return buildStub();
        }

        const client = new Redis({
          host: env.REDIS_HOST,
          port: env.REDIS_PORT,
          password: env.REDIS_PASSWORD,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        });
        client.on('error', (err) => {
          console.error('[Redis] connection error', err.message);
        });
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
