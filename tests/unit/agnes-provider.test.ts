/**
 * AgnesProvider 单元测试（Agnes 大模型核心实现，OpenAI 兼容协议）。
 *
 * 通过 mock http/retry/sse 模块验证：
 *   - generate：请求体组装（model/messages/temperature/max_tokens/top_p/stop/stream）
 *   - generate：成功解析（content/model/finishReason/usage/raw）、缺 content → ParseError
 *   - generate：runtime 兜底超时/重试 + callOpts 覆盖
 *   - stream：chunk 流式翻译、[DONE] 终止、finish_reason 携带 usage、
 *             JSON 解析失败 → ParseError、无 body → ParseError、自然结束兜底 done
 *   - healthCheck 成功/失败
 *
 * 设计依据：docs/design/06-api-spec.md 第八章 LlmService 契约。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { httpJson, httpStream } from '../../src/services/legal/llm/http';
import { parseSse } from '../../src/services/legal/llm/sse';
import { withRetry } from '../../src/services/legal/llm/retry';
import { ParseError } from '../../src/services/legal/llm/errors';
import { AgnesProvider } from '../../src/services/legal/llm/agnesProvider';
import type { ProviderConfig, LlmRuntimeConfig } from '../../src/config/types';

vi.mock('../../src/services/legal/llm/http', () => ({
  httpJson: vi.fn(),
  httpStream: vi.fn(),
}));

vi.mock('../../src/services/legal/llm/retry', () => ({
  withRetry: vi.fn(async (fn: () => unknown) => fn()),
}));

vi.mock('../../src/services/legal/llm/sse', () => ({
  parseSse: vi.fn(),
}));

const cfg: ProviderConfig = {
  apiKey: 'sk-agnes',
  baseURL: 'https://apihub.agnes-ai.com/v1',
  defaultModel: 'agnes-2.0-flash',
};

const runtime: LlmRuntimeConfig = {
  provider: 'agnes',
  timeoutMs: 30_000,
  maxRetries: 3,
  baseRetryDelayMs: 1_000,
  logLevel: 'info',
};

const okBody = {
  id: 'x1',
  model: 'agnes-2.0-flash',
  choices: [{ message: { role: 'assistant', content: '你好' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
};

describe('AgnesProvider', () => {
  let provider: AgnesProvider;

  async function consume(stream: AsyncIterable<unknown>): Promise<unknown[]> {
    const out: unknown[] = [];
    for await (const c of stream) out.push(c);
    return out;
  }

  beforeEach(() => {
    provider = new AgnesProvider(cfg, runtime);
    vi.mocked(httpJson).mockReset();
    vi.mocked(httpJson).mockResolvedValue({ body: okBody } as never);
    vi.mocked(httpStream).mockReset();
    vi.mocked(withRetry).mockClear();
    vi.mocked(parseSse).mockReset();
  });

  it('name/defaultModel 暴露', () => {
    expect(provider.name).toBe('agnes');
    expect(provider.defaultModel).toBe('agnes-2.0-flash');
  });

  it('generate 成功 → 解析 content/model/finishReason/usage', async () => {
    const res = await provider.generate([{ role: 'user', content: '问' }]);
    expect(res.content).toBe('你好');
    expect(res.model).toBe('agnes-2.0-flash');
    expect(res.finishReason).toBe('stop');
    expect(res.usage).toEqual({ promptTokens: 12, completionTokens: 4, totalTokens: 16 });
    expect(res.raw).toEqual(okBody);
  });

  it('generate 请求体：默认 model + messages + stream=false，含可选参数', async () => {
    await provider.generate(
      [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ],
      { model: 'agnes-2.1', temperature: 0.3, maxTokens: 100, topP: 0.9, stop: ['\n'] },
    );

    const [httpArg, httpOpts] = vi.mocked(httpJson).mock.calls[0];
    expect(httpArg.path).toBe('/chat/completions');
    expect(httpArg.body).toEqual({
      model: 'agnes-2.1',
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ],
      temperature: 0.3,
      max_tokens: 100,
      top_p: 0.9,
      stop: ['\n'],
    });
    expect(httpOpts.baseURL).toBe(cfg.baseURL);
    expect(httpOpts.apiKey).toBe('sk-agnes');
  });

  it('generate：runtime 兜底 timeoutMs/maxRetries，callOpts 可覆盖', async () => {
    await provider.generate([{ role: 'user', content: 'q' }]);
    let [, opts] = vi.mocked(httpJson).mock.calls[0];
    expect(opts.timeoutMs).toBe(30_000);
    expect(vi.mocked(withRetry).mock.calls[0][1].maxRetries).toBe(3);

    const signal = new AbortController().signal;
    await provider.generate([{ role: 'user', content: 'q' }], { timeoutMs: 9000, maxRetries: 0, signal });
    [, opts] = vi.mocked(httpJson).mock.calls[1];
    expect(opts.timeoutMs).toBe(9000);
    expect(opts.signal).toBe(signal);
    expect(vi.mocked(withRetry).mock.calls[1][1].maxRetries).toBe(0);
  });

  it('generate：缺 content → ParseError', async () => {
    vi.mocked(httpJson).mockResolvedValue({ body: { choices: [{ finish_reason: 'stop' }] } } as never);
    await expect(provider.generate([{ role: 'user', content: 'q' }])).rejects.toBeInstanceOf(ParseError);
  });

  it('finishReason 未知值透传 / 缺失兜底 stop', async () => {
    vi.mocked(httpJson).mockResolvedValue({
      body: { choices: [{ message: { content: 'x' }, finish_reason: 'content_filter' }] },
    } as never);
    expect((await provider.generate([{ role: 'user', content: 'q' }])).finishReason).toBe('content_filter');

    vi.mocked(httpJson).mockResolvedValue({ body: { choices: [{ message: { content: 'x' } }] } } as never);
    expect((await provider.generate([{ role: 'user', content: 'q' }])).finishReason).toBe('stop');
  });

  it('stream：chunk 翻译 + finish_reason 携带 usage + [DONE] 终止', async () => {
    vi.mocked(httpStream).mockResolvedValue({ body: {} } as never);
    vi.mocked(parseSse).mockImplementation(async function* () {
      yield { data: '{"choices":[{"delta":{"content":"你"},"finish_reason":null}]}' };
      yield { data: '{"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8}}' };
      yield { data: '[DONE]' };
    });

    const chunks = [];
    for await (const c of provider.stream([{ role: 'user', content: 'q' }])) {
      chunks.push(c);
    }

    expect(chunks).toEqual([
      { delta: '你', done: false, usage: undefined },
      { delta: '好', done: true, usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 } },
      { delta: '', done: true, usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 } },
    ]);

    const [httpArg] = vi.mocked(httpStream).mock.calls[0];
    expect((httpArg.body as { stream: boolean }).stream).toBe(true);
  });

  it('stream：JSON 分片解析失败 → ParseError', async () => {
    vi.mocked(httpStream).mockResolvedValue({ body: {} } as never);
    vi.mocked(parseSse).mockImplementation(async function* () {
      yield { data: 'not-json' };
    });
    await expect(consume(provider.stream([{ role: 'user', content: 'q' }]))).rejects.toBeInstanceOf(
      ParseError,
    );
  });

  it('stream：响应无 body → ParseError', async () => {
    vi.mocked(httpStream).mockResolvedValue({ body: undefined } as never);
    await expect(consume(provider.stream([{ role: 'user', content: 'q' }]))).rejects.toThrow(
      'no body',
    );
  });

  it('stream：流自然结束（无 [DONE]）→ 兜底 done', async () => {
    vi.mocked(httpStream).mockResolvedValue({ body: {} } as never);
    vi.mocked(parseSse).mockImplementation(async function* () {
      yield { data: '{"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}' };
    });
    const chunks = [];
    for await (const c of provider.stream([{ role: 'user', content: 'q' }])) {
      chunks.push(c);
    }
    expect(chunks).toEqual([{ delta: 'hi', done: false, usage: undefined }, { delta: '', done: true, usage: undefined }]);
  });

  it('healthCheck：成功 → true / 失败 → false', async () => {
    expect(await provider.healthCheck()).toBe(true);
    vi.mocked(httpJson).mockRejectedValue(new Error('boom'));
    expect(await provider.healthCheck()).toBe(false);
  });
});