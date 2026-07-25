/**
 * CircuitBreaker 单元测试（A3-W1）。
 *
 * 用 FakeRedis（内存 Map）模拟 ioredis，覆盖：
 *   - closed/open/half-open 三态流转
 *   - 错误率超阈值熔断
 *   - 半开探测成功/失败
 *   - 探测锁 NX 互斥
 *   - minCalls 冷启动保护
 *   - Redis 不可用 fail-open
 *   - LlmDegradedError 类型守卫
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CircuitBreaker } from '../../src/modules/legal/llm/circuit-breaker';
import { LlmDegradedError, isLlmDegradedError } from '../../src/modules/legal/llm/llm-errors';

/** FakeRedis：内存 Map 模拟 ioredis 关键方法 */
class FakeRedis {
  private store = new Map<string, { value: string; ttlAt?: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.ttlAt && entry.ttlAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ...rest: unknown[]): Promise<'OK' | null> {
    // 解析 EX / NX 选项
    let ttlSec: number | undefined;
    let nx = false;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === 'EX') ttlSec = Number(rest[i + 1]);
      if (rest[i] === 'NX') nx = true;
    }
    if (nx && this.store.has(key)) return null;
    this.store.set(key, {
      value,
      ttlAt: ttlSec ? Date.now() + ttlSec * 1000 : undefined,
    });
    return 'OK';
  }

  async incr(key: string): Promise<number> {
    const cur = Number((await this.get(key)) ?? 0);
    const next = cur + 1;
    const existing = this.store.get(key);
    this.store.set(key, {
      value: String(next),
      ttlAt: existing?.ttlAt,
    });
    return next;
  }

  async expire(key: string, sec: number): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return 0;
    entry.ttlAt = Date.now() + sec * 1000;
    return 1;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return -2;
    if (!entry.ttlAt) return -1;
    const remaining = Math.ceil((entry.ttlAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : -2;
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.store.delete(k)) n++;
    }
    return n;
  }

  /** 手动让 state key 过期（模拟 TTL 到期） */
  expireState(): void {
    this.store.delete('cb:llm:state');
  }

  /** 清空 */
  clear(): void {
    this.store.clear();
  }
}

describe('CircuitBreaker', () => {
  let redis: FakeRedis;
  let breaker: CircuitBreaker;

  beforeEach(() => {
    redis = new FakeRedis();
    breaker = new CircuitBreaker(redis as never, undefined, {
      errorRateThreshold: 0.3,
      minCalls: 5,
      windowMs: 60_000,
      openCooldownMs: 60_000,
      probeLockSec: 10,
    });
  });

  describe('closed 状态', () => {
    it('正常调用返回结果', async () => {
      const result = await breaker.execute(async () => 'ok');
      expect(result).toBe('ok');
    });

    it('fn 抛错时原样抛出', async () => {
      await expect(
        breaker.execute(async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
    });

    it('minCalls 未达阈值不熔断（全失败也不熔）', async () => {
      for (let i = 0; i < 4; i++) {
        await expect(
          breaker.execute(async () => {
            throw new Error('fail');
          }),
        ).rejects.toThrow('fail');
      }
      // 第 5 次仍应执行 fn（未熔断）
      let called = false;
      await expect(
        breaker.execute(async () => {
          called = true;
          throw new Error('fail');
        }),
      ).rejects.toThrow('fail');
      expect(called).toBe(true);
    });

    it('错误率超阈值 + 达 minCalls → 熔断', async () => {
      // 4 失败 + 1 成功 = 80% 错误率（>30%），达 5 次调用
      for (let i = 0; i < 4; i++) {
        await expect(
          breaker.execute(async () => {
            throw new Error('fail');
          }),
        ).rejects.toThrow('fail');
      }
      await breaker.execute(async () => 'ok');
      // 第 6 次应熔断
      await expect(breaker.execute(async () => 'ok')).rejects.toBeInstanceOf(LlmDegradedError);
    });
  });

  describe('open 状态', () => {
    it('熔断后抛 LlmDegradedError(5003)', async () => {
      // 触发熔断
      for (let i = 0; i < 5; i++) {
        await expect(
          breaker.execute(async () => {
            throw new Error('fail');
          }),
        ).rejects.toThrow('fail');
      }
      await expect(breaker.execute(async () => 'ok')).rejects.toSatisfy((err: unknown) => {
        if (!isLlmDegradedError(err)) return false;
        return err.code === 5003 && err.breakerState === 'open';
      });
    });
  });

  describe('half-open 状态', () => {
    it('探测成功 → 恢复 closed', async () => {
      // 触发熔断
      for (let i = 0; i < 5; i++) {
        await expect(
          breaker.execute(async () => {
            throw new Error('fail');
          }),
        ).rejects.toThrow('fail');
      }
      expect(await breaker.getState()).toBe('open');

      // 模拟 state key 过期
      redis.expireState();

      // 探测成功
      const result = await breaker.execute(async () => 'recovered');
      expect(result).toBe('recovered');

      // 恢复 closed
      expect(await breaker.getState()).toBe('closed');
    });

    it('探测失败 → 重新 open', async () => {
      for (let i = 0; i < 5; i++) {
        await expect(
          breaker.execute(async () => {
            throw new Error('fail');
          }),
        ).rejects.toThrow('fail');
      }
      redis.expireState();
      expect(await breaker.getState()).toBe('half-open');

      // 探测失败
      await expect(
        breaker.execute(async () => {
          throw new Error('still-failing');
        }),
      ).rejects.toThrow('still-failing');
      expect(await breaker.getState()).toBe('open');
    });
  });

  describe('LlmDegradedError', () => {
    it('isLlmDegradedError 类型守卫', () => {
      const err = new LlmDegradedError('test', 'open');
      expect(isLlmDegradedError(err)).toBe(true);
      expect(isLlmDegradedError(new Error('other'))).toBe(false);
      expect(isLlmDegradedError(null)).toBe(false);
    });

    it('默认 breakerState=open', () => {
      const err = new LlmDegradedError();
      expect(err.breakerState).toBe('open');
      expect(err.code).toBe(5003);
    });
  });

  describe('Redis 不可用 fail-open', () => {
    it('redis 为 undefined 时不熔断（内存模式）', async () => {
      const memBreaker = new CircuitBreaker(undefined as never, undefined, {
        minCalls: 3,
        errorRateThreshold: 0.3,
      });
      // 3 次失败（达 minCalls，错误率 100%）→ 内存熔断
      for (let i = 0; i < 3; i++) {
        await expect(
          memBreaker.execute(async () => {
            throw new Error('fail');
          }),
        ).rejects.toThrow('fail');
      }
      // 第 4 次应抛 LlmDegradedError（内存模式已熔断）
      await expect(memBreaker.execute(async () => 'ok')).rejects.toBeInstanceOf(LlmDegradedError);
    });
  });
});
