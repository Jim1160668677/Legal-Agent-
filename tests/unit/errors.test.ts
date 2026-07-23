import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { httpJson, httpStream } from '../../src/services/legal/llm/http';
import {
  AuthError,
  RateLimitError,
  ApiError,
  TimeoutError,
  NetworkError,
} from '../../src/services/legal/llm/errors';

const baseOpts = {
  baseURL: 'https://api.example.com/v1',
  apiKey: 'sk-test-key',
  timeoutMs: 5000,
};

function mockResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('httpJson — HTTP 状态码映射', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('200 返回解析后的 body', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(200, { ok: true, data: 'hello' }),
    );
    const res = await httpJson(
      { path: '/chat/completions', method: 'POST', body: { q: 1 } },
      baseOpts,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: 'hello' });
  });

  it('401 → AuthError', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(401, { error: { message: 'Invalid API key' } }),
    );
    await expect(
      httpJson({ path: '/x', method: 'POST', body: {} }, baseOpts),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('400 → InvalidRequestError', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(400, { error: { message: 'messages is required' } }),
    );
    await expect(
      httpJson({ path: '/x', method: 'POST', body: {} }, baseOpts),
    ).rejects.toMatchObject({ kind: 'invalid_request', status: 400 });
  });

  it('422 → InvalidRequestError (其他 4xx)', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(422, { error: { message: 'Unprocessable' } }),
    );
    await expect(
      httpJson({ path: '/x', method: 'POST', body: {} }, baseOpts),
    ).rejects.toMatchObject({ kind: 'invalid_request', status: 422 });
  });

  it('429 → RateLimitError，带 retryAfterMs（来自 Retry-After 秒）', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(429, { error: { message: 'Too many requests' } }, { 'Retry-After': '5' }),
    );
    try {
      await httpJson({ path: '/x', method: 'POST', body: {} }, baseOpts);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
      expect((e as RateLimitError).retryAfterMs).toBe(5000);
      expect((e as RateLimitError).retryable).toBe(true);
    }
  });

  it('429 无 Retry-After 头 → retryAfterMs undefined', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(429, { error: { message: 'Too many requests' } }),
    );
    try {
      await httpJson({ path: '/x', method: 'POST', body: {} }, baseOpts);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
      expect((e as RateLimitError).retryAfterMs).toBeUndefined();
    }
  });

  it('500 → ApiError, retryable=true', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(500, { error: { message: 'Internal server error' } }),
    );
    try {
      await httpJson({ path: '/x', method: 'POST', body: {} }, baseOpts);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).retryable).toBe(true);
      expect((e as ApiError).status).toBe(500);
    }
  });

  it('503 → ApiError, retryable=true', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(503, { error: { message: 'Service unavailable' } }),
    );
    await expect(
      httpJson({ path: '/x', method: 'POST', body: {} }, baseOpts),
    ).rejects.toMatchObject({ kind: 'api', retryable: true, status: 503 });
  });

  it('404 → InvalidRequestError, retryable=false', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(404, { error: { message: 'Not found' } }),
    );
    await expect(
      httpJson({ path: '/x', method: 'POST', body: {} }, baseOpts),
    ).rejects.toMatchObject({ kind: 'invalid_request', retryable: false, status: 404 });
  });

  it('fetch 抛 AbortError → TimeoutError', async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(err);
    await expect(
      httpJson({ path: '/x', method: 'POST', body: {} }, baseOpts),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it('fetch 抛网络错误 → NetworkError', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      httpJson({ path: '/x', method: 'POST', body: {} }, baseOpts),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('200 但 body 非 JSON → NetworkError', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    );
    await expect(
      httpJson({ path: '/x', method: 'POST', body: {} }, baseOpts),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('外部 signal 已 abort → TimeoutError（在 fetch 前）', async () => {
    const ctrl = new AbortController();
    ctrl.abort(new Error('user cancel'));
    // fetch 会被 controller.signal 触发 abort，抛 AbortError
    const err = new Error('aborted');
    err.name = 'AbortError';
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(err);
    await expect(
      httpJson({ path: '/x', method: 'POST', body: {} }, { ...baseOpts, signal: ctrl.signal }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe('httpStream', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('200 返回原始 Response', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: hi\n\n'));
        c.close();
      },
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );
    const res = await httpStream({ path: '/x', method: 'POST', body: {} }, baseOpts);
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });

  it('401 → AuthError', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(401, { error: { message: 'bad key' } }),
    );
    await expect(
      httpStream({ path: '/x', method: 'POST', body: {} }, baseOpts),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('500 → ApiError', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse(500, { error: { message: 'upstream' } }),
    );
    await expect(
      httpStream({ path: '/x', method: 'POST', body: {} }, baseOpts),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
