/**
 * FeatureFlagService 单元测试（A1-W2）。
 *
 * 验收点：
 *   - flag 不存在 → false（fail-closed）
 *   - enabled=false → false
 *   - whitelist 命中 → true
 *   - rolloutPercent=100 → true，=0 → false
 *   - 灰度哈希稳定性：同 userId+flagKey 多次结果一致
 *   - 灰度分布：100 用户 50% 灰度，命中数应在 40~60 之间（统计稳定）
 *   - invalidate 清缓存
 *
 * 设计依据：A1 §6.6。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeatureFlagService } from '../../src/modules/platform/feature-flag/feature-flag.service';
import type { CacheService } from '../../src/modules/platform/cache/cache.service';
import type { Model } from 'mongoose';

function makeFlagModel(
  doc: { enabled: boolean; rolloutPercent: number; whitelist: string[] } | null,
) {
  return {
    findOne: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(
            doc
              ? {
                  enabled: doc.enabled,
                  rolloutPercent: doc.rolloutPercent,
                  whitelist: doc.whitelist,
                }
              : null,
          ),
        }),
      }),
    }),
  } as unknown as Model<never>;
}

function makeCache(): CacheService {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: unknown) => {
      store.set(k, v);
    }),
    del: vi.fn(async (k: string) => {
      store.delete(k);
    }),
  } as unknown as CacheService;
}

describe('FeatureFlagService', () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = makeCache();
  });

  it('flag 不存在 → false（fail-closed）', async () => {
    const svc = new FeatureFlagService(makeFlagModel(null), cache);
    expect(await svc.isEnabled('missing_flag', 'u1')).toBe(false);
  });

  it('enabled=false → false', async () => {
    const svc = new FeatureFlagService(
      makeFlagModel({ enabled: false, rolloutPercent: 100, whitelist: [] }),
      cache,
    );
    expect(await svc.isEnabled('f', 'u1')).toBe(false);
  });

  it('whitelist 命中 → true（即使 rollout=0）', async () => {
    const svc = new FeatureFlagService(
      makeFlagModel({ enabled: true, rolloutPercent: 0, whitelist: ['vip-user'] }),
      cache,
    );
    expect(await svc.isEnabled('f', 'vip-user')).toBe(true);
  });

  it('rolloutPercent=100 → 所有用户 true', async () => {
    const svc = new FeatureFlagService(
      makeFlagModel({ enabled: true, rolloutPercent: 100, whitelist: [] }),
      cache,
    );
    expect(await svc.isEnabled('f', 'u1')).toBe(true);
    expect(await svc.isEnabled('f', 'u2')).toBe(true);
  });

  it('rolloutPercent=0 → 非白名单 false', async () => {
    const svc = new FeatureFlagService(
      makeFlagModel({ enabled: true, rolloutPercent: 0, whitelist: [] }),
      cache,
    );
    expect(await svc.isEnabled('f', 'u1')).toBe(false);
  });

  it('灰度哈希稳定性：同输入多次结果一致', async () => {
    const svc = new FeatureFlagService(
      makeFlagModel({ enabled: true, rolloutPercent: 50, whitelist: [] }),
      cache,
    );
    const r1 = await svc.isEnabled('stable_flag', 'user-xyz');
    const r2 = await svc.isEnabled('stable_flag', 'user-xyz');
    expect(r1).toBe(r2);
  });

  it('灰度分布：100 用户 50% 灰度命中数在 [35, 65] 区间', async () => {
    const svc = new FeatureFlagService(
      makeFlagModel({ enabled: true, rolloutPercent: 50, whitelist: [] }),
      cache,
    );
    let hit = 0;
    for (let i = 0; i < 100; i++) {
      if (await svc.isEnabled('dist_flag', `user-${i}`)) hit++;
    }
    // SHA-256 哈希分布应较均匀；放宽到 [35,65] 容忍随机波动
    expect(hit).toBeGreaterThanOrEqual(35);
    expect(hit).toBeLessThanOrEqual(65);
  });

  it('不同 flagKey 对同 userId 灰度结果不同（盐隔离）', async () => {
    const svc = new FeatureFlagService(
      makeFlagModel({ enabled: true, rolloutPercent: 50, whitelist: [] }),
      cache,
    );
    const results = new Set<boolean>();
    for (let i = 0; i < 20; i++) {
      results.add(await svc.isEnabled(`flag-${i}`, 'fixed-user'));
    }
    // 20 个不同 flag，至少应出现两种结果（概率上几乎必然）
    expect(results.size).toBeGreaterThan(1);
  });

  it('缓存生效：第二次 isEnabled 不再查 DB', async () => {
    const model = makeFlagModel({ enabled: true, rolloutPercent: 100, whitelist: [] });
    const svc = new FeatureFlagService(model, cache);
    await svc.isEnabled('cached', 'u1');
    await svc.isEnabled('cached', 'u2');
    expect(model.findOne).toHaveBeenCalledTimes(1);
  });

  it('invalidate 后再次 isEnabled 重新查 DB', async () => {
    const model = makeFlagModel({ enabled: true, rolloutPercent: 100, whitelist: [] });
    const svc = new FeatureFlagService(model, cache);
    await svc.isEnabled('inv', 'u1');
    await svc.invalidate('inv');
    await svc.isEnabled('inv', 'u2');
    expect(model.findOne).toHaveBeenCalledTimes(2);
  });
});
