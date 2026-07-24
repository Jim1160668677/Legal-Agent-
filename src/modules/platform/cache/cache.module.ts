/**
 * CacheModule —— 暴露 CacheService（A1-W2）。
 *
 * CacheService 依赖：
 *   - REDIS_CLIENT（RedisModule 全局提供）
 *   - LlmCache Model（DatabaseModule 已 MongooseModule.forFeature 注册）
 *
 * 本模块声明 MongooseModel 注入即可，无需重复 forFeature。
 */
import { Module } from '@nestjs/common';
import { CacheService } from './cache.service';

@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
