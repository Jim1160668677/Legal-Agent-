import { isRetryable, RateLimitError } from './errors';

export interface RetryOpts {
  maxRetries: number; // 重试次数上限（不含首次），默认 3
  baseDelayMs: number; // 退避基础延迟，默认 1000
  maxDelayMs?: number; // 退避上限，默认 8000
  signal?: AbortSignal; // 外部取消信号
}

/**
 * 指数退避重试。
 *
 * - 仅对 isRetryable(e) === true 的错误重试
 * - 429 时优先使用 RateLimitError.retryAfterMs（尊重 Retry-After 头）
 * - 退避公式：min(baseDelay * 2^attempt, maxDelay) * (0.75 + random*0.5)  // ±25% 抖动
 * - attempt 从 0 起；maxRetries=3 时最多执行 4 次（1 首次 + 3 重试）
 *
 * @param fn 接收当前 attempt（0-based），返回要执行的异步任务
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOpts,
): Promise<T> {
  const maxDelay = opts.maxDelayMs ?? 8_000;
  let attempt = 0;
  let lastErr: unknown;

  while (attempt <= opts.maxRetries) {
    if (opts.signal?.aborted) {
      throw opts.signal.reason ?? new Error('Aborted');
    }
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e) || attempt === opts.maxRetries) {
        throw e;
      }

      // 计算退避延迟
      let delay = Math.min(opts.baseDelayMs * 2 ** attempt, maxDelay);
      if (e instanceof RateLimitError && e.retryAfterMs) {
        delay = Math.min(e.retryAfterMs, maxDelay);
      }
      // ±25% 抖动，避免惊群
      delay = Math.round(delay * (0.75 + Math.random() * 0.5));

      await sleep(delay, opts.signal);
      attempt++;
    }
  }
  throw lastErr;
}

/** 可被 AbortSignal 取消的 sleep */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('Aborted'));
        return;
      }
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(signal.reason ?? new Error('Aborted'));
        },
        { once: true },
      );
    }
  });
}
