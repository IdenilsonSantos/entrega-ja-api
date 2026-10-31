import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { config } from '../../config';

export const REDIS = Symbol('REDIS');
export const REDIS_SUB = Symbol('REDIS_SUB');

/**
 * Conexão nova com o Redis.
 * maxRetriesPerRequest: null é exigido pelo BullMQ; family: 0 resolve IPv4 e IPv6
 * (redes privadas de alguns provedores, como o Railway, são só IPv6).
 */
export const createRedis = () => new Redis(config.redisUrl, { maxRetriesPerRequest: null, family: 0 });

@Injectable()
class RedisShutdown implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly a: Redis, @Inject(REDIS_SUB) private readonly b: Redis) {}
  async onApplicationShutdown() {
    await Promise.allSettled([this.a.quit(), this.b.quit()]);
  }
}

/** Duas conexões: uma para comandos e outra só para SUBSCRIBE (que bloqueia a conexão). */
@Global()
@Module({
  providers: [
    { provide: REDIS, useFactory: createRedis },
    { provide: REDIS_SUB, useFactory: createRedis },
    RedisShutdown,
  ],
  exports: [REDIS, REDIS_SUB],
})
export class RedisModule {}
