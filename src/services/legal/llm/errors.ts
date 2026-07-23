/**
 * LLM 错误类层级。
 *
 * 所有 LLM 调用（HTTP / 解析 / 网络）抛出的错误都派生自 LlmError，
 * 携带 `kind`（用于日志分类与监控）与 `retryable`（驱动重试策略）。
 */

export type LlmErrorKind =
  | 'auth' // 401 Unauthorized
  | 'invalid_request' // 400 / 其他 4xx（参数错误等）
  | 'rate_limit' // 429
  | 'api' // 5xx 上游错误
  | 'timeout' // AbortController 超时
  | 'network' // DNS / 连接拒绝 / TLS 等网络层错误
  | 'parse'; // 响应体无法解析为 JSON / 结构缺失

export interface LlmErrorOptions {
  retryable: boolean;
  status?: number;
  cause?: unknown;
  /** 429 时服务端建议的等待毫秒数（来自 Retry-After 头） */
  retryAfterMs?: number;
}

export abstract class LlmError extends Error {
  abstract readonly kind: LlmErrorKind;
  readonly retryable: boolean;
  readonly status?: number;
  readonly cause?: unknown;
  readonly retryAfterMs?: number;

  constructor(message: string, opts: LlmErrorOptions) {
    super(message);
    this.name = this.constructor.name;
    this.retryable = opts.retryable;
    this.status = opts.status;
    this.cause = opts.cause;
    this.retryAfterMs = opts.retryAfterMs;
    // 保留 cause 链（ES2022）
    if (opts.cause !== undefined && 'cause' in this === false) {
      (this as { cause?: unknown }).cause = opts.cause;
    }
  }
}

/** 401 — API Key 无效或过期，不可重试 */
export class AuthError extends LlmError {
  readonly kind = 'auth';
  constructor(message: string, opts?: { cause?: unknown }) {
    super(message, { retryable: false, status: 401, cause: opts?.cause });
  }
}

/** 400 / 其他 4xx — 请求参数错误，不可重试 */
export class InvalidRequestError extends LlmError {
  readonly kind = 'invalid_request';
  constructor(message: string, opts?: { status?: number; cause?: unknown }) {
    super(message, {
      retryable: false,
      status: opts?.status ?? 400,
      cause: opts?.cause,
    });
  }
}

/** 429 — 速率限制，可重试（尊重 Retry-After） */
export class RateLimitError extends LlmError {
  readonly kind = 'rate_limit';
  constructor(message: string, opts?: { retryAfterMs?: number; cause?: unknown }) {
    super(message, {
      retryable: true,
      status: 429,
      cause: opts?.cause,
      retryAfterMs: opts?.retryAfterMs,
    });
  }
}

/** 5xx — 上游服务错误，>=500 可重试 */
export class ApiError extends LlmError {
  readonly kind = 'api';
  constructor(message: string, opts: { status: number; cause?: unknown }) {
    super(message, {
      retryable: opts.status >= 500,
      status: opts.status,
      cause: opts.cause,
    });
  }
}

/** 超时（AbortController 触发），不可重试 */
export class TimeoutError extends LlmError {
  readonly kind = 'timeout';
  constructor(message: string, opts?: { cause?: unknown }) {
    super(message, { retryable: false, cause: opts?.cause });
  }
}

/** 网络层错误（DNS / 连接拒绝 / TLS），可重试 */
export class NetworkError extends LlmError {
  readonly kind = 'network';
  constructor(message: string, opts?: { cause?: unknown }) {
    super(message, { retryable: true, cause: opts?.cause });
  }
}

/** 响应解析失败（非 JSON / 结构缺失），不可重试 */
export class ParseError extends LlmError {
  readonly kind = 'parse';
  constructor(message: string, opts?: { cause?: unknown }) {
    super(message, { retryable: false, cause: opts?.cause });
  }
}

/** 判断错误是否可重试 */
export function isRetryable(e: unknown): boolean {
  return e instanceof LlmError && e.retryable;
}

/** 判断是否为 LlmError */
export function isLlmError(e: unknown): e is LlmError {
  return e instanceof LlmError;
}
