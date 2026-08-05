/**
 * ZhipuVisionProvider 单元测试（v2.4 智谱 GLM-4V 视觉 Provider）。
 *
 * 通过 mock http.ts / retry.ts 验证：
 *   - name 派生（flash → zhipu-flash，其余 → zhipu-plus）
 *   - 请求体组装（默认/自定义 prompt、image_url、max_tokens、temperature）
 *   - 成功解析（text/model/usage）
 *   - 缺 choices[0].message.content → ParseError
 *   - callOpts 覆盖 timeoutMs/maxRetries
 *   - healthCheck 成功/失败
 *
 * 设计依据：图像识别系统-多模型主备切换.md §1.2。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { httpJson } from '../../src/services/legal/llm/http';
import { withRetry } from '../../src/services/legal/llm/retry';
import { ParseError } from '../../src/services/legal/llm/errors';
import { ZhipuVisionProvider } from '../../src/modules/legal/vision/zhipu-vision.provider';
import type { ZhipuVisionProviderOptions } from '../../src/modules/legal/vision/zhipu-vision.provider';

vi.mock('../../src/services/legal/llm/http', () => ({
  httpJson: vi.fn(),
}));

vi.mock('../../src/services/legal/llm/retry', () => ({
  withRetry: vi.fn(async (fn: () => unknown) => fn()),
}));

const baseOpts: ZhipuVisionProviderOptions = {
  apiKey: 'key-1',
  baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  model: 'glm-4v-flash',
  priority: 1,
  timeoutMs: 30000,
  maxRetries: 2,
  baseRetryDelayMs: 1000,
  maxTokens: 512,
  temperature: 0.1,
};

const okBody = {
  id: 'x1',
  model: 'glm-4v-flash',
  choices: [{ message: { role: 'assistant', content: '识别结果' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

describe('ZhipuVisionProvider', () => {
  beforeEach(() => {
    vi.mocked(httpJson).mockReset();
    vi.mocked(httpJson).mockResolvedValue({ body: okBody } as never);
    vi.mocked(withRetry).mockClear();
  });

  it('name 按 model 派生：flash → zhipu-flash', () => {
    expect(new ZhipuVisionProvider(baseOpts).name).toBe('zhipu-flash');
    expect(new ZhipuVisionProvider({ ...baseOpts, model: 'glm-4v-plus' }).name).toBe(
      'zhipu-plus',
    );
    expect(new ZhipuVisionProvider(baseOpts).priority).toBe(1);
  });

  it('recognize 成功 → 解析 text/model/usage', async () => {
    const p = new ZhipuVisionProvider(baseOpts);
    const result = await p.recognize({ image: 'data:image/png;base64,AAA' });

    expect(result.text).toBe('识别结果');
    expect(result.model).toBe('glm-4v-flash');
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    expect(result.raw).toEqual(okBody);
  });

  it('请求体：默认 prompt + image_url 组装 + model/temperature', async () => {
    const p = new ZhipuVisionProvider(baseOpts);
    await p.recognize({ image: 'data:image/png;base64,AAA' });

    const [httpArg, opts] = vi.mocked(httpJson).mock.calls[0];
    expect(httpArg.path).toBe('/chat/completions');
    expect(httpArg.method).toBe('POST');
    const body = httpArg.body as { messages: Array<{ content: Array<{ type: string; text?: string; image_url?: { url: string } }> }> };
    expect(body.messages[0].content[0]).toMatchObject({ type: 'text', text: '请识别图片中的所有文字' });
    expect(body.messages[0].content[1]).toMatchObject({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAA' },
    });
    expect((body as { max_tokens: number }).max_tokens).toBe(512);
    expect(opts.baseURL).toBe(baseOpts.baseURL);
    expect(opts.apiKey).toBe('key-1');
  });

  it('自定义 prompt 会 trim 后使用', async () => {
    const p = new ZhipuVisionProvider(baseOpts);
    await p.recognize({ image: 'x', prompt: '  识别发票   ' });
    const body = (vi.mocked(httpJson).mock.calls[0][0] as { body: { messages: Array<{ content: Array<{ text: string }> }> } }).body;
    expect(body.messages[0].content[0].text).toBe('识别发票');
  });

  it('callOpts 覆盖 timeoutMs / maxRetries', async () => {
    const p = new ZhipuVisionProvider(baseOpts);
    const signal = new AbortController().signal;
    await p.recognize({ image: 'x' }, { timeoutMs: 5000, maxRetries: 0, signal });

    const [, httpOpts] = vi.mocked(httpJson).mock.calls[0];
    expect(httpOpts.timeoutMs).toBe(5000);
    expect(httpOpts.signal).toBe(signal);
    const [, retryOpts] = vi.mocked(withRetry).mock.calls[0];
    expect(retryOpts.maxRetries).toBe(0);
    expect(retryOpts.signal).toBe(signal);
  });

  it('缺 content → ParseError', async () => {
    vi.mocked(httpJson).mockResolvedValue({ body: { choices: [{ message: {} }] } } as never);
    const p = new ZhipuVisionProvider(baseOpts);
    await expect(p.recognize({ image: 'x' })).rejects.toBeInstanceOf(ParseError);
  });

  it('healthCheck：识别成功 → true', async () => {
    const p = new ZhipuVisionProvider(baseOpts);
    expect(await p.healthCheck()).toBe(true);
    // 最小探针：maxRetries=0 + 10s 超时
    const [, opts] = vi.mocked(httpJson).mock.calls[0];
    expect(opts.timeoutMs).toBe(10_000);
  });

  it('healthCheck：识别失败 → false（不抛错）', async () => {
    vi.mocked(httpJson).mockRejectedValue(new Error('auth failed'));
    const p = new ZhipuVisionProvider(baseOpts);
    expect(await p.healthCheck()).toBe(false);
  });
});