/**
 * VisionProviderRegistry 单元测试（v2.4 被动式健康状态跟踪）。
 *
 * 覆盖：
 *   - registerAll / register / sortedByPriority（按 priority 升序，仅健康 provider）
 *   - isHealthy：未注册 → false；健康 → true
 *   - recordFailure → 不健康；冷却期后自动恢复
 *   - recordSuccess → 重置健康 + 失败计数
 *   - getStatus：快照排序
 *
 * 设计依据：图像识别系统-多模型主备切换.md §1.3 + §健康状态监测。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VisionProviderRegistry } from '../../src/modules/legal/vision/vision-provider-registry';
import type { VisionProvider } from '../../src/modules/legal/vision/vision.types';

function makeProvider(name: string, priority: number): VisionProvider {
  return {
    name,
    model: `model-${name}`,
    priority,
    recognize: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true),
  } as unknown as VisionProvider;
}

describe('VisionProviderRegistry（多模型注册与健康跟踪）', () => {
  let registry: VisionProviderRegistry;

  beforeEach(() => {
    registry = new VisionProviderRegistry(30_000);
  });

  it('sortedByPriority：按 priority 升序返回健康 provider', () => {
    registry.registerAll([makeProvider('plus', 2), makeProvider('flash', 1)]);
    const list = registry.sortedByPriority();
    expect(list.map((p) => p.name)).toEqual(['flash', 'plus']);
  });

  it('isHealthy：未注册返回 false', () => {
    expect(registry.isHealthy('unknown')).toBe(false);
  });

  it('recordFailure → 不健康 + 冷却期内不返回', () => {
    const p = makeProvider('flash', 1);
    registry.register(p);
    registry.recordFailure('flash', new Error('x'));

    expect(registry.isHealthy('flash')).toBe(false);
    expect(registry.sortedByPriority()).toHaveLength(0);
  });

  it('冷却期过后自动恢复为健康', () => {
    vi.useFakeTimers();
    const short = new VisionProviderRegistry(10_000);
    short.register(makeProvider('flash', 1));

    short.recordFailure('flash', new Error('x'));
    expect(short.isHealthy('flash')).toBe(false);

    vi.advanceTimersByTime(10_001);
    expect(short.isHealthy('flash')).toBe(true);
    expect(short.sortedByPriority()).toHaveLength(1);
    vi.useRealTimers();
  });

  it('recordSuccess → 重置健康 + 失败计数归零', () => {
    registry.register(makeProvider('flash', 1));
    registry.recordFailure('flash', new Error('x'));
    registry.recordSuccess('flash');

    expect(registry.isHealthy('flash')).toBe(true);
  });

  it('getStatus：返回按 priority 排序的健康快照', () => {
    registry.registerAll([makeProvider('plus', 2), makeProvider('flash', 1)]);
    const status = registry.getStatus();
    expect(status.map((s) => s.name)).toEqual(['flash', 'plus']);
    expect(status.every((s) => s.healthy)).toBe(true);
  });

  it('recordFailure 后 getStatus 反映不健康', () => {
    registry.register(makeProvider('flash', 1));
    registry.recordFailure('flash', new Error('x'));
    const status = registry.getStatus();
    expect(status[0].healthy).toBe(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});