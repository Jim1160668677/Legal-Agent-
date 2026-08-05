/**
 * ZhipuProvider 单元测试（智谱 GLM 大模型核心实现，OpenAI 兼容协议）。
 *
 * 覆盖（与 AgnesProvider 同构，差异点：thinking 模式）：
 *   - generate：请求体组装 + thinking 开关（ZHIPU_THINKING=enabled → thinking.type）
 *   - generate：成功解析 / 缺 content → ParseError
 *   - stream：chunk 翻译、[DONE] 终止、无 body → ParseError
 *   - healthCheck
 *
 * 设计依据：docs/design/06-api-spec.md；智谱 glm-4.7-flash 文档。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { httpJson, httpStream } from '../../src/services/legal/llm/http';
import { parseSse } from '../../src/services/legal/llm/sse';
import { withRetry } from '../../src/services/legal/llm/retry';
import { ParseError } from '../../src/services/legal/llm/errors';
import { ZhipuProvider } from '../../src/services/legal/llm/zhipuProvider';
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
  apiKey: 'sk-zhipu',
  baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  defaultModel: 'glm-4.7-flash',
};

const runtime: LlmRuntimeConfig = {
  provider: 'zhipu',
  timeoutMs: 30_000,
  maxRetries: 2,
  baseRetryDelayMs: 1_000,
  logLevel: 'info',
};

const SAVED_THINKING = process.env.ZHIPU_THINKING;

afterEach(() => {
  if (SAVED_THINKING === undefined) delete process.env.ZHIPU_THINKING;
  else process.env.ZHIPU_THINKING = SAVED_THINKING;
});

describe('ZhipuProvider', () => {
  let provider: ZhipuProvider;

  beforeEach(() => {
    delete process.env.ZHIPU_THINKING;
    provider = new ZhipuProvider(cfg, runtime);
    vi.mocked(httpJson).mockReset();
    vi.mocked(httpJson).mockResolvedValue({
      body: {
        model: 'glm-4.7-flash',
        choices: [{ message: { content: '回复' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      },
    } as never);
    vi.mocked(httpStream).mockReset();
    vi.mocked(parseSse).mockReset();
    vi.mocked(withRetry).mockClear();
  });

  it('name/defaultModel 暴露；默认显式关闭思考模式', async () => {
    expect(provider.name).toBe('zhipu');
    expect(provider.defaultModel).toBe('glm-4.7-flash');
    await provider.generate([{ role: 'user', content: 'q' }]);
    const body = vi.mocked(httpJson).mock.calls[0][0].body as Record<string, unknown>;
    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it('ZHIPU_THINKING=enabled → 请求体 thinking.type=enabled', async () => {
    process.env.ZHIPU_THINKING = 'enabled';
    const p = new ZhipuProvider(cfg, runtime);
    await p.generate([{ role: 'user', content: 'q' }]);
    const body = vi.mocked(httpJson).mock.calls[0][0].body as Record<string, unknown>;
    expect(body.thinking).toEqual({ type: 'enabled' });
  });

  it('stream 也显式传递思考模式（disabled）', async () => {
    vi.mocked(httpStream).mockResolvedValue({ body: {} } as never);
    vi.mocked(parseSse).mockImplementation(async function* () {
      yield { data: '{"choices":[{"delta":{"content":"甲"},"finish_reason":null}]}' };
      yield { data: '[DONE]' };
    });
    const chunks: unknown[] = [];
    for await (const c of provider.stream([{ role: 'user', content: 'q' }])) chunks.push(c);
    expect(chunks.length).toBe(2);
    const [httpArg] = vi.mocked(httpStream).mock.calls[0];
    expect((httpArg.body as { thinking: { type: string } }).thinking).toEqual({ type: 'disabled' });
  });

  it('generate 成功 → 解析 content/finishReason/usage + 请求体组装', async () => {
    const res = await provider.generate([{ role: 'user', content: '问' }], { temperature: 0.5 });
    expect(res.content).toBe('回复');
    expect(res.finishReason).toBe('stop');
    expect(res.usage).toEqual({ promptTokens: 1, completionTokens: 2, totalTokens: 3 });

    const [httpArg, httpOpts] = vi.mocked(httpJson).mock.calls[0];
    expect(httpArg.body).toMatchObject({
      model: 'glm-4.7-flash',
      temperature: 0.5,
      messages: [{ role: 'user', content: '问' }],
    });
    expect(httpOpts.baseURL).toBe(cfg.baseURL);
    expect(httpOpts.apiKey).toBe('sk-zhipu');
  });

  it('generate：缺 content → ParseError', async () => {
    vi.mocked(httpJson).mockResolvedValue({ body: { choices: [] } } as never);
    await expect(provider.generate([{ role: 'user', content: 'q' }])).rejects.toBeInstanceOf(ParseError);
  });

  it('stream：chunk 翻译 + [DONE] 终止', async () => {
    vi.mocked(httpStream).mockResolvedValue({ body: {} } as never);
    vi.mocked(parseSse).mockImplementation(async function* () {
      yield { data: '{"choices":[{"delta":{"content":"甲"},"finish_reason":null}]}' };
      yield { data: '[DONE]' };
    });
    const chunks = [];
    for await (const c of provider.stream([{ role: 'user', content: 'q' }])) {
      chunks.push(c);
    }
    expect(chunks).toEqual([
      { delta: '甲', done: false, usage: undefined },
      { delta: '', done: true, usage: undefined },
    ]);
    const [httpArg] = vi.mocked(httpStream).mock.calls[0];
    expect((httpArg.body as { stream: boolean }).stream).toBe(true);
  });

  it('stream：无 body → ParseError', async () => {
    vi.mocked(httpStream).mockResolvedValue({ body: undefined } as never);
    const out: unknown[] = [];
    await expect(
      (async () => {
        for await (const c of provider.stream([{ role: 'user', content: 'q' }])) out.push(c);
      })(),
    ).rejects.toThrow('no body');
  });

  it('healthCheck：成功 → true / 失败 → false', async () => {
    expect(await provider.healthCheck()).toBe(true);
    vi.mocked(httpJson).mockRejectedValue(new Error('boom'));
    expect(await provider.healthCheck()).toBe(false);
  });
});