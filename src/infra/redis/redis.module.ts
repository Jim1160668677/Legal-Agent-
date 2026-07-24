/**
 * Redis 模块（A1-W1）。
 *
 * 提供 CacheService（A1-W2 完整实现）与限流计数的基础。
 * 设计依据：A1 §6.5 CacheService。
 */
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        const client = new Redis(config.get<string>('app.redis.url')!, {
          keyPrefix: config.get<string>('app.redis.keyPrefix')!,
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          retryStrategy: (times: number) => Math.min(times * 200, 2000),
        });
        client.on('error', (err: Error) => {
          console.error('[redis] error:', err.message);
        });
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
