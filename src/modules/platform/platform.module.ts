/**
 * PlatformModule —— 平台横切模块汇总（A1-W2）。
 *
 * 集中导入 7 个横切模块，便于 AppModule 一次挂载：
 *   Logger / Cache / Pii / Audit / FeatureFlag / ContentSafety
 *   （Auth 独立挂载，因为含 Controller）
 *
 * 依赖顺序：
 *   Logger 是底层（无依赖）
 *   Cache 依赖 Redis + Mongo
 *   Audit 依赖 Logger + Mongo
 *   FeatureFlag 依赖 Cache + Mongo
 *   ContentSafety 依赖 Audit
 *   Pii 依赖 Config
 *
 * 设计依据：A1 §六 平台横切模块。
 */
import { Module } from '@nestjs/common';
import { LoggerModule } from './logger/logger.module';
import { CacheModule } from './cache/cache.module';
import { PiiModule } from './pii/pii.module';
import { AuditModule } from './audit/audit.module';
import { FeatureFlagModule } from './feature-flag/feature-flag.module';
import { ContentSafetyModule } from './content-safety/content-safety.module';

@Module({
  imports: [
    LoggerModule,
    CacheModule,
    PiiModule,
    AuditModule,
    FeatureFlagModule,
    ContentSafetyModule,
  ],
  exports: [
    LoggerModule,
    CacheModule,
    PiiModule,
    AuditModule,
    FeatureFlagModule,
    ContentSafetyModule,
  ],
})
export class PlatformModule {}
