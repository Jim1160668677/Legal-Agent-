import {
  AuthError,
  InvalidRequestError,
  RateLimitError,
  ApiError,
  TimeoutError,
  NetworkError,
} from './errors';

/**
 * HTTP 封装：fetch + 超时 + HTTP 状态码 → LlmError 子类映射。
 *
 * 被 AgnesProvider 与未来 QwenProvider 复用，统一错误处理。
 */

export interface HttpOptions {
  baseURL: string;
  apiKey: string;
  timeoutMs: number;
  /** 外部取消信号（与 timeout 合并：任一触发即取消） */
  signal?: AbortSignal;
}

export interface HttpRequest {
  path: string; // 如 '/chat/completions'
  method: 'POST' | 'GET';
  body?: unknown;
}

export interface HttpResponse<T = unknown> {
  status: number;
  headers: Headers;
  body: T;
  raw: Response;
}

/** 错误响应体（OpenAI 兼容格式） */
interface ApiErrorBody {
  error?: { message?: string; type?: string; code?: string };
  message?: string;
}

/**
 * 创建合并了超时与外部信号的 AbortController。
 * - timeoutMs 到期自动 abort
 * - 外部 signal abort 时联动 abort
 */
function createTimeoutController(opts: HttpOptions): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${opts.timeoutMs}ms`));
  }, opts.timeoutMs);

  const external = opts.signal;
  const onExternalAbort = () => {
    controller.abort(external?.reason ?? new Error('Aborted by caller'));
  };

  if (external) {
    if (external.aborted) {
      // 已 abort：立即触发并清理 timer
      clearTimeout(timer);
      controller.abort(external.reason ?? new Error('Aborted by caller'));
    } else {
      external.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const cleanup = () => {
    clearTimeout(timer);
    if (external) external.removeEventListener('abort', onExternalAbort);
  };

  return { controller, cleanup };
}

/** 判断 fetch 抛出的错误是否为 abort。
 *  注意：Node 的 fetch（undici）abort 时抛 DOMException(name='AbortError')，
 *  而 DOMException 在多数 Node 版本中并非 Error 子类，因此不能依赖 instanceof Error，
 *  改为按 name 属性判断以兼容 DOMException。 */
function isAbortError(e: unknown): boolean {
  if (e && typeof e === 'object' && 'name' in e) {
    const name = (e as { name: string }).name;
    return name === 'AbortError' || name === 'TimeoutError';
  }
  return false;
}

/** 将非 2xx 响应映射为对应 LlmError 子类 */
function mapHttpError(status: number, errBody: ApiErrorBody | null, res: Response): never {
  const msg = errBody?.error?.message ?? errBody?.message ?? `HTTP ${status}`;

  if (status === 401) {
    throw new AuthError(`Authentication failed: ${msg}`);
  }
  if (status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : undefined;
    throw new RateLimitError(`Rate limited: ${msg}`, {
      retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
    });
  }
  if (status >= 500) {
    throw new ApiError(`Upstream error (${status}): ${msg}`, { status });
  }
  // 其他 4xx（含 400）
  throw new InvalidRequestError(`HTTP ${status}: ${msg}`, { status });
}

/** 构造请求 headers */
function buildHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/**
 * 发送请求并解析 JSON 响应。
 * 失败时抛出对应 LlmError 子类。
 */
export async function httpJson<T = unknown>(
  req: HttpRequest,
  opts: HttpOptions,
): Promise<HttpResponse<T>> {
  const { controller, cleanup } = createTimeoutController(opts);

  let res: Response;
  try {
    res = await fetch(`${opts.baseURL}${req.path}`, {
      method: req.method,
      headers: buildHeaders(opts.apiKey),
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: controller.signal,
    });
  } catch (e: unknown) {
    // 优先用 controller.signal.aborted 判断是否被中止（超时或外部取消）。
    // 不依赖错误 name：controller.abort(reason) 传入的 reason 会被 fetch 透传抛出，
    // 其 name 可能是 'Error'（非 'AbortError'），按 name 判断会误判为 NetworkError。
    const wasAborted = controller.signal.aborted || isAbortError(e);
    cleanup();
    if (wasAborted) {
      throw new TimeoutError(`Request aborted after ${opts.timeoutMs}ms`, { cause: e });
    }
    throw new NetworkError(`Network error: ${(e as Error)?.message ?? String(e)}`, { cause: e });
  }
  cleanup();

  if (!res.ok) {
    let errBody: ApiErrorBody | null = null;
    try {
      errBody = (await res.json()) as ApiErrorBody;
    } catch {
      // 响应非 JSON，errBody 保持 null
    }
    mapHttpError(res.status, errBody, res);
  }

  let body: T;
  try {
    body = (await res.json()) as T;
  } catch (e: unknown) {
    throw new NetworkError(`Failed to parse response JSON: ${(e as Error)?.message ?? ''}`, {
      cause: e,
    });
  }

  return { status: res.status, headers: res.headers, body, raw: res };
}

/**
 * 发送请求并返回原始 Response（不解析 body），供 SSE 流式消费。
 * 超时与错误映射逻辑同 httpJson。
 */
export async function httpStream(req: HttpRequest, opts: HttpOptions): Promise<Response> {
  const { controller, cleanup } = createTimeoutController(opts);

  let res: Response;
  try {
    res = await fetch(`${opts.baseURL}${req.path}`, {
      method: req.method,
      headers: {
        ...buildHeaders(opts.apiKey),
        Accept: 'text/event-stream',
      },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: controller.signal,
    });
  } catch (e: unknown) {
    const wasAborted = controller.signal.aborted || isAbortError(e);
    cleanup();
    if (wasAborted) {
      throw new TimeoutError(`Request aborted after ${opts.timeoutMs}ms`, { cause: e });
    }
    throw new NetworkError(`Network error: ${(e as Error)?.message ?? String(e)}`, { cause: e });
  }

  if (!res.ok) {
    // 流式错误响应体可能不是 JSON，但 OpenAI 兼容 API 通常仍返回 JSON 错误
    let errBody: ApiErrorBody | null = null;
    try {
      errBody = (await res.json()) as ApiErrorBody;
    } catch {
      errBody = null;
    }
    cleanup();
    mapHttpError(res.status, errBody, res);
  }

  // 注意：流式场景下 cleanup（清超时 timer）放到消费完 body 后调用更合适，
  // 但为了简单与一致，这里在响应头到达后即清理超时 timer；
  // 流式传输过程中的取消由调用方通过 opts.signal 控制。
  cleanup();

  if (!res.body) {
    throw new NetworkError('Stream response has no body');
  }
  return res;
}
