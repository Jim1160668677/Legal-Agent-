/**
 * CircuitBreaker —— LLM 熔断器（A3-W1，A3 §3.3）。
 *
 * 三态：closed（正常）→ open（熔断）→ half-open（探测）→ closed/half-open
 *
 * 触发条件：
 *   - 滑动 1 分钟窗口内错误率 > 30%（errorRateThreshold）
 *   - 最小调用数 ≥ 5（minCalls，避免冷启动误判）
 *
 * 状态翻转：
 *   - closed → open：错误率超阈值，写 cb:llm:state（TTL 60s）
 *   - open → half-open：cb:llm:state 过期后（60s），下次 execute 抢 cb:llm:probe 锁（NX EX 10s）
 *   - half-open → closed：探测成功，清状态 + 重置计数
 *   - half-open → open：探测失败，重写 cb:llm:state（TTL 60s）
 *
 * 多实例共享：状态存 Redis，多实例共享熔断决策（避免惊群）。
 * 半开探测锁：SET NX EX 10 保证单实例探测，其余实例按 open 处理。
 *
 * 容错：Redis 不可用时 fail-open（仅内存计数，不熔断），避免 Redis 故障拖垮 LLM。
 *
 * 设计依据：A3 §3.3；06-api-spec.md 错误码 5003。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import type { AppLoggerService } from '../../platform/logger/logger.service';
import { LlmDegradedError } from './llm-errors';

/** 熔断器参数（A3 §3.3） */
export interface CircuitBreakerConfig {
  /** 错误率阈值（0..1），默认 0.3 */
  errorRateThreshold: number;
  /** 滑动窗口（ms），默认 60_000 */
  windowMs: number;
  /** open 状态冷却时长（ms），默认 60_000（与窗口一致） */
  openCooldownMs: number;
  /** 最小调用数（少于该值不熔断，避免冷启动误判），默认 5 */
  minCalls: number;
  /** 半开探测锁时长（s），默认 10 */
  probeLockSec: number;
}

export const DEFAULT_CB_CONFIG: CircuitBreakerConfig = {
  errorRateThreshold: 0.3,
  windowMs: 60_000,
  openCooldownMs: 60_000,
  minCalls: 5,
  probeLockSec: 10,
};

/** Redis key 前缀（配合 redis.keyPrefix 全局前缀） */
const KEY_SUCCESS = 'cb:llm:success';
const KEY_FAILURE = 'cb:llm:failure';
const KEY_STATE = 'cb:llm:state';
const KEY_PROBE = 'cb:llm:probe';

/** 熔断器状态值 */
type BreakerState = 'closed' | 'open' | 'half-open';

@Injectable()
export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  /** fail-open 内存计数（Redis 不可用时使用） */
  private memSuccess = 0;
  private memFailure = 0;
  private memOpenUntil = 0;

  constructor(
    @Inject(REDIS_CLIENT) @Optional() private readonly redis?: Redis,
    @Optional() private readonly logger?: AppLoggerService,
    @Optional() config?: Partial<CircuitBreakerConfig>,
  ) {
    this.config = { ...DEFAULT_CB_CONFIG, ...config };
  }

  /**
   * 在熔断保护下执行函数。
   * @param fn 待执行的异步函数
   * @returns fn 的返回值
   * @throws LlmDegradedError 熔断 open 时
   * @throws fn 抛出的原始错误（非熔断）
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = await this.getState();

    if (state === 'open') {
      this.logger?.warn('CircuitBreaker: 熔断中，拒绝调用', { state });
      throw new LlmDegradedError('LLM circuit breaker open', 'open');
    }

    if (state === 'half-open') {
      // 抢探测锁：仅一个实例执行探测，其余按 open 处理
      const acquired = await this.tryAcquireProbeLock();
      if (!acquired) {
        this.logger?.warn('CircuitBreaker: 半开探测锁被占用，拒绝调用', { state });
        throw new LlmDegradedError('LLM circuit breaker half-open (probe busy)', 'half-open');
      }
    }

    try {
      const result = await fn();
      await this.recordSuccess(state);
      return result;
    } catch (err) {
      await this.recordFailure(state);
      throw err;
    }
  }

  /**
   * 在熔断保护下执行流式函数（ CachedLlmService.stream 使用）。
   *
   * 与 execute 的差异：fn 返回异步迭代器，逐项 yield（不缓冲），
   * 迭代正常结束记 success，迭代中抛错记 failure。
   * 状态检查 + 半开探测锁逻辑与 execute 一致。
   *
   * @param fn 返回 AsyncIterable 的工厂（惰性创建，避免熔断时仍建立连接）
   */
  async *executeStream<T>(fn: () => AsyncIterable<T>): AsyncGenerator<T, void, void> {
    const state = await this.getState();

    if (state === 'open') {
      this.logger?.warn('CircuitBreaker: 熔断中，拒绝流式调用', { state });
      throw new LlmDegradedError('LLM circuit breaker open', 'open');
    }

    if (state === 'half-open') {
      const acquired = await this.tryAcquireProbeLock();
      if (!acquired) {
        this.logger?.warn('CircuitBreaker: 半开探测锁被占用，拒绝流式调用', { state });
        throw new LlmDegradedError('LLM circuit breaker half-open (probe busy)', 'half-open');
      }
    }

    try {
      for await (const chunk of fn()) {
        yield chunk;
      }
      await this.recordSuccess(state);
    } catch (err) {
      await this.recordFailure(state);
      throw err;
    }
  }

  /** 当前状态（供测试/监控） */
  async getState(): Promise<BreakerState> {
    // Redis 不可用 → fail-open 内存模式
    if (!this.redis) {
      if (this.memOpenUntil > Date.now()) return 'open';
      if (this.memOpenUntil > 0 && this.memOpenUntil <= Date.now()) return 'half-open';
      return 'closed';
    }

    try {
      const stateVal = await this.redis.get(KEY_STATE);
      if (stateVal === 'open') return 'open';
      // state key 已过期 → half-open（待探测）
      if (stateVal === null) {
        // 检查是否曾熔断过（memOpenUntil > 0 判断），避免首次启动误判 half-open
        return this.memOpenUntil > 0 ? 'half-open' : 'closed';
      }
      return 'closed';
    } catch {
      return 'closed'; // Redis 读失败 fail-open
    }
  }

  /**
   * 记录成功：重置计数（half-open 探测成功 → closed）。
   *
   * 注意：closed 状态下成功调用后也需检查错误率——
   * 滑动窗口语义是"任意调用后，若 total≥minCalls 且 errorRate≥阈值则熔断"。
   * 若仅在 recordFailure 中检查，"4 失败 + 1 成功"（80% 错误率）会被最后一次成功掩盖，
   * 直到下一次失败才熔断，违背设计意图（A3 §3.3）。
   */
  private async recordSuccess(state: BreakerState): Promise<void> {
    if (!this.redis) {
      this.memSuccess++;
      if (state === 'half-open') {
        this.memOpenUntil = 0; // 探测成功 → closed
        this.memSuccess = 0;
        this.memFailure = 0;
        return;
      }
      // closed：成功后同样检查错误率（与 recordFailure 对称）
      this.checkAndTripMem();
      return;
    }

    try {
      const successCount = await this.redis.incr(KEY_SUCCESS);
      await this.expireIfFirst(KEY_SUCCESS, this.config.windowMs / 1000);
      if (state === 'half-open') {
        // 探测成功：清状态 + 重置计数
        await this.redis.del(KEY_STATE, KEY_SUCCESS, KEY_FAILURE, KEY_PROBE);
        this.memOpenUntil = 0;
        this.logger?.info('CircuitBreaker: 半开探测成功，恢复 closed');
        return;
      }
      // closed：成功后检查错误率（避免最后一次成功掩盖高错误率）
      if (state === 'closed') {
        const failCount = Number((await this.redis.get(KEY_FAILURE)) ?? 0);
        const total = failCount + successCount;
        if (total >= this.config.minCalls) {
          const errorRate = failCount / total;
          if (errorRate >= this.config.errorRateThreshold) {
            await this.tripOpen();
            this.logger?.warn('CircuitBreaker: 错误率超阈值，熔断（成功后检查）', {
              failCount,
              successCount,
              errorRate: errorRate.toFixed(3),
              threshold: this.config.errorRateThreshold,
            });
          }
        }
      }
    } catch (err) {
      this.logger?.warn('CircuitBreaker: 记录成功失败（fail-open）', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 记录失败：检查是否触发熔断（half-open 探测失败 → re-open） */
  private async recordFailure(state: BreakerState): Promise<void> {
    if (!this.redis) {
      this.memFailure++;
      if (state === 'half-open') {
        this.memOpenUntil = Date.now() + this.config.openCooldownMs;
        return;
      }
      this.checkAndTripMem();
      return;
    }

    try {
      const failCount = await this.redis.incr(KEY_FAILURE);
      await this.expireIfFirst(KEY_FAILURE, this.config.windowMs / 1000);
      const successCount = Number((await this.redis.get(KEY_SUCCESS)) ?? 0);
      const total = failCount + successCount;

      if (state === 'half-open') {
        // 探测失败：re-open
        await this.tripOpen();
        this.logger?.warn('CircuitBreaker: 半开探测失败，重新 open');
        return;
      }

      if (total >= this.config.minCalls) {
        const errorRate = failCount / total;
        if (errorRate >= this.config.errorRateThreshold) {
          await this.tripOpen();
          this.logger?.warn('CircuitBreaker: 错误率超阈值，熔断', {
            failCount,
            successCount,
            errorRate: errorRate.toFixed(3),
            threshold: this.config.errorRateThreshold,
          });
        }
      }
    } catch (err) {
      this.logger?.warn('CircuitBreaker: 记录失败失败（fail-open）', {
        error: err instanceof Error ? err.message : String(err),
      });
      // fail-open 内存兜底
      this.memFailure++;
      this.checkAndTripMem();
    }
  }

  /** 触发熔断：写 state key（TTL = openCooldownMs） */
  private async tripOpen(): Promise<void> {
    if (!this.redis) {
      this.memOpenUntil = Date.now() + this.config.openCooldownMs;
      return;
    }
    try {
      await this.redis.set(KEY_STATE, 'open', 'EX', Math.ceil(this.config.openCooldownMs / 1000));
      this.memOpenUntil = Date.now() + this.config.openCooldownMs;
    } catch {
      this.memOpenUntil = Date.now() + this.config.openCooldownMs;
    }
  }

  /** 抢半开探测锁（SET NX EX） */
  private async tryAcquireProbeLock(): Promise<boolean> {
    if (!this.redis) return true; // 内存模式无需锁
    try {
      const res = await this.redis.set(KEY_PROBE, '1', 'EX', this.config.probeLockSec, 'NX');
      return res === 'OK';
    } catch {
      return true; // Redis 失败 fail-open
    }
  }

  /** 首次设置 TTL（避免每次 incr 都重置） */
  private async expireIfFirst(key: string, ttlSec: number): Promise<void> {
    try {
      const ttl = await this.redis?.ttl(key);
      if (ttl === -1) {
        // key 存在但无 TTL（不应该发生，兜底）
        await this.redis?.expire(key, ttlSec);
      } else if (ttl === -2) {
        // key 不存在（刚 incr 后理论上存在，竞态兜底）
        await this.redis?.expire(key, ttlSec);
      }
    } catch {
      // ignore
    }
  }

  /** 内存模式熔断检查 */
  private checkAndTripMem(): void {
    const total = this.memSuccess + this.memFailure;
    if (total >= this.config.minCalls) {
      const errorRate = this.memFailure / total;
      if (errorRate >= this.config.errorRateThreshold) {
        this.memOpenUntil = Date.now() + this.config.openCooldownMs;
      }
    }
  }
}
