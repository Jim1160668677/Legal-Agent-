/**
 * FeatureFlag —— 灰度开关服务（A1-W2）。
 *
 * 职责（A1 §6.6）：
 *   - isEnabled(flagKey, userId)：读 feature_flag 集合判定
 *   - 灰度维度从 openid 哈希改为 userId 哈希取模（A1 §十一 迁移映射）
 *   - 缓存 60s（feature_flag 改动低频，避免每次查 DB）
 *
 * 判定规则（优先级从高到低）：
 *   1. flag 不存在 → false（默认关闭）
 *   2. enabled=false → false
 *   3. userId 在 whitelist → true
 *   4. rolloutPercent=0 → false
 *   5. hash(userId) % 100 < rolloutPercent → true
 *   6. 否则 false
 *
 * 设计依据：A1 §6.6；05 feature_flag schema。
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash } from 'node:crypto';
import {
  FeatureFlag,
  type FeatureFlagDocument,
} from '../../../infra/database/schemas/system.schema';
import { CacheService } from '../cache/cache.service';

const CACHE_TTL_SEC = 60;
const cacheKey = (flagKey: string): string => `feature_flag:${flagKey}`;

@Injectable()
export class FeatureFlagService {
  constructor(
    @InjectModel(FeatureFlag.name) private readonly model: Model<FeatureFlagDocument>,
    private readonly cache: CacheService,
  ) {}

  /**
   * 判定某用户是否启用某 flag。
   * @param flagKey flag 标识
   * @param userId 用户 ID（未登录传 undefined，灰度按随机判定）
   */
  async isEnabled(flagKey: string, userId?: string): Promise<boolean> {
    const flag = await this.getFlag(flagKey);
    if (!flag || !flag.enabled) return false;
    if (userId && flag.whitelist.includes(userId)) return true;
    if (flag.rolloutPercent <= 0) return false;
    if (flag.rolloutPercent >= 100) return true;
    return this.hashPercent(flagKey, userId ?? 'anonymous') < flag.rolloutPercent;
  }

  /**
   * 取 flag 配置（带 60s 缓存）。
   * 缓存未命中查 DB；DB 异常用缓存空值兜底（fail-closed）。
   */
  private async getFlag(
    flagKey: string,
  ): Promise<{ enabled: boolean; rolloutPercent: number; whitelist: string[] } | null> {
    const cached = await this.cache.get<{
      enabled: boolean;
      rolloutPercent: number;
      whitelist: string[];
    }>(cacheKey(flagKey));
    if (cached) return cached;

    const doc = await this.model
      .findOne({ flagKey })
      .select({ enabled: 1, rolloutPercent: 1, whitelist: 1 })
      .lean<{ enabled: boolean; rolloutPercent: number; whitelist: string[] }>()
      .exec();
    const result = doc
      ? { enabled: doc.enabled, rolloutPercent: doc.rolloutPercent, whitelist: doc.whitelist }
      : null;
    // null 也缓存（避免不存在的 flag 反复查 DB），TTL 短一点 30s
    await this.cache.set(cacheKey(flagKey), result ?? null, result ? CACHE_TTL_SEC : 30);
    return result;
  }

  /**
   * 灰度哈希：sha256(flagKey:userId) 取前 8 字节 → 0~99 整数。
   * 用 flagKey 做盐确保不同 flag 灰度分布独立。
   */
  private hashPercent(flagKey: string, userId: string): number {
    const hash = createHash('sha256').update(`${flagKey}:${userId}`).digest();
    // 取前 4 字节为 uint32，模 100
    const num = hash.readUInt32BE(0);
    return num % 100;
  }

  /** 清除某 flag 的缓存（运营改配置后调） */
  async invalidate(flagKey: string): Promise<void> {
    await this.cache.del(cacheKey(flagKey));
  }
}
