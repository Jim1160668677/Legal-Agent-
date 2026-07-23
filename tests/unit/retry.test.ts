import { describe, it, expect } from 'vitest';
import { withRetry, sleep } from '../../src/services/legal/llm/retry';
import {
  AuthError,
  RateLimitError,
  ApiError,
  TimeoutError,
  NetworkError,
} from '../../src/services/legal/llm/errors';

describe('withRetry', () => {
  it('首次成功不重试', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        return 'ok';
      },
      { maxRetries: 3, baseDelayMs: 1 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('不可重试错误立即抛出', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new AuthError('bad key');
        },
        { maxRetries: 3, baseDelayMs: 1 },
      ),
    ).rejects.toBeInstanceOf(AuthError);
    expect(calls).toBe(1);
  });

  it('可重试错误重试到成功', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new NetworkError('transient');
        return 'recovered';
      },
      { maxRetries: 3, baseDelayMs: 1 },
    );
    expect(result).toBe('recovered');
    expect(calls).toBe(3);
  });

  it('达到 maxRetries 仍失败则抛最后错误', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new ApiError('5xx', { status: 503 });
        },
        { maxRetries: 2, baseDelayMs: 1 },
      ),
    ).rejects.toBeInstanceOf(ApiError);
    // 1 首次 + 2 重试 = 3 次
    expect(calls).toBe(3);
  });

  it('429 优先使用 retryAfterMs', async () => {
    let calls = 0;
    const start = Date.now();
    await withRetry(
      async () => {
        calls++;
        if (calls === 1) {
          throw new RateLimitError('limited', { retryAfterMs: 50 });
        }
        return 'ok';
      },
      { maxRetries: 3, baseDelayMs: 10_000 }, // 故意设大，验证 retryAfterMs 覆盖
    );
    const elapsed = Date.now() - start;
    expect(calls).toBe(2);
    // 应在 50ms 附近（允许抖动 ±25%），远小于 baseDelayMs
    expect(elapsed).toBeLessThan(200);
  });

  it('外部 signal 已 abort 立即抛出', async () => {
    const ctrl = new AbortController();
    ctrl.abort(new Error('cancelled'));
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          return 'ok';
        },
        { maxRetries: 3, baseDelayMs: 1, signal: ctrl.signal },
      ),
    ).rejects.toThrow('cancelled');
    expect(calls).toBe(0);
  });

  it('TimeoutError 不可重试', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new TimeoutError('timed out');
        },
        { maxRetries: 3, baseDelayMs: 1 },
      ),
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(calls).toBe(1);
  });

  it('attempt 参数从 0 递增', async () => {
    const attempts: number[] = [];
    await withRetry(
      async (attempt) => {
        attempts.push(attempt);
        if (attempt < 2) throw new NetworkError('retry');
        return 'ok';
      },
      { maxRetries: 3, baseDelayMs: 1 },
    );
    expect(attempts).toEqual([0, 1, 2]);
  });
});

describe('sleep', () => {
  it('正常等待', async () => {
    const start = Date.now();
    await sleep(30);
    expect(Date.now() - start).toBeGreaterThanOrEqual(25);
  });

  it('signal 已 abort 立即 reject', async () => {
    const ctrl = new AbortController();
    ctrl.abort(new Error('aborted'));
    await expect(sleep(100, ctrl.signal)).rejects.toThrow('aborted');
  });

  it('等待中 signal abort 提前 reject', async () => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(new Error('mid-abort')), 10);
    const start = Date.now();
    await expect(sleep(1000, ctrl.signal)).rejects.toThrow('mid-abort');
    expect(Date.now() - start).toBeLessThan(100);
  });
});
