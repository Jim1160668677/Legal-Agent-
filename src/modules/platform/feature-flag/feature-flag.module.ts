/**
 * FeatureFlagModule —— 暴露 FeatureFlagService（A1-W2）。
 *
 * 依赖 CacheService + FeatureFlag Model。
 *
 * 设计依据：A1 §6.6。
 */
import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module';
import { FeatureFlagService } from './feature-flag.service';

@Module({
  imports: [CacheModule],
  providers: [FeatureFlagService],
  exports: [FeatureFlagService],
})
export class FeatureFlagModule {}
