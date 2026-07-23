import { describe, it, expect } from 'vitest';
import {
  createServiceWithConfig,
  cloneConfig,
  hasAgnesKey,
  DEFAULT_OPTS,
} from '../../helpers/agnesFixture';
import {
  AuthError,
  TimeoutError,
  isLlmError,
} from '../../../src/services/legal/llm/errors';

/**
 * 异常场景集成测试 — 真实 Agnes API。
 *
 * 覆盖 7 类错误中的可触发项：auth/timeout/invalid_request/network。
 * rate_limit 难以稳定触发，在报告中说明。
 */

describe.skipIf(!hasAgnesKey())('Agnes 异常场景', () => {
  it('1. 错误 API key → AuthError（kind=auth，status=401，不可重试）', async () => {
    const cfg = cloneConfig();
    cfg.agnes.apiKey = 'sk-invalid-key-for-exception-test';
    const service = createServiceWithConfig(cfg);

    let thrown: unknown;
    try {
      await service.generate('hi', { ...DEFAULT_OPTS, maxRetries: 0, timeoutMs: 15_000 });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AuthError);
    const err = thrown as AuthError;
    expect(err.kind).toBe('auth');
    expect(err.status).toBe(401);
    expect(err.retryable).toBe(false);
  });

  it('2. timeoutMs=1 → TimeoutError（kind=timeout）', async () => {
    const service = createServiceWithConfig(cloneConfig());
    let thrown: unknown;
    try {
      await service.generate('请详细介绍中国法律体系。', {
        ...DEFAULT_OPTS,
        maxRetries: 0,
        timeoutMs: 1,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TimeoutError);
    expect((thrown as TimeoutError).kind).toBe('timeout');
    expect((thrown as TimeoutError).retryable).toBe(false);
  });

  it('3. 无效 model 名 → InvalidRequestError 或 ApiError', async () => {
    const service = createServiceWithConfig(cloneConfig());
    let thrown: unknown;
    try {
      await service.generate('hi', {
        ...DEFAULT_OPTS,
        maxRetries: 0,
        timeoutMs: 15_000,
        model: 'agnes-nonexistent-model-xyz',
      });
    } catch (e) {
      thrown = e;
    }
    expect(isLlmError(thrown as Error)).toBe(true);
    const kind = (thrown as { kind: string }).kind;
    expect(['invalid_request', 'api']).toContain(kind);
    console.log(`[exception] invalid model → ${kind}: ${(thrown as Error).message.slice(0, 80)}`);
  });

  it('4. 错误 baseURL → NetworkError（kind=network，可重试）', async () => {
    const cfg = cloneConfig();
    cfg.agnes.baseURL = 'https://invalid.agnes-ai-host.example/v1';
    const service = createServiceWithConfig(cfg);

    let thrown: unknown;
    try {
      await service.generate('hi', { ...DEFAULT_OPTS, maxRetries: 0, timeoutMs: 15_000 });
    } catch (e) {
      thrown = e;
    }
    // DNS 解析失败 → NetworkError；若 DNS 恰好超时也可能 TimeoutError
    expect(isLlmError(thrown as Error)).toBe(true);
    const kind = (thrown as { kind: string }).kind;
    expect(['network', 'timeout']).toContain(kind);
    console.log(`[exception] wrong baseURL → ${kind}: ${(thrown as Error).message.slice(0, 80)}`);
  });

  it('5. 外部 signal 取消 → TimeoutError 或 abort 错误', async () => {
    const service = createServiceWithConfig(cloneConfig());
    const ac = new AbortController();
    const promise = service.generate('请详细介绍中国法律体系的历史演进。', {
      ...DEFAULT_OPTS,
      maxRetries: 0,
      timeoutMs: 60_000,
      signal: ac.signal,
    });
    // 50ms 后取消
    setTimeout(() => ac.abort(new Error('cancelled by test')), 50);

    let thrown: unknown;
    try {
      await promise;
    } catch (e) {
      thrown = e;
    }
    expect(isLlmError(thrown as Error)).toBe(true);
    const kind = (thrown as { kind: string }).kind;
    expect(['timeout']).toContain(kind);
    console.log(`[exception] external signal cancel → ${kind}`);
  });
});
