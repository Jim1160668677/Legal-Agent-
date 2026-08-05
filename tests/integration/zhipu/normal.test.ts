import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  createZhipuService,
  hasZhipuKey,
  probeZhipuConnectivity,
  SHORT_PROMPT,
  DEFAULT_OPTS,
} from '../../helpers/zhipuFixture';
import type { ChatMessage } from '../../../src/types/llm';

/**
 * 正常场景集成测试 — 真实智谱 GLM API（LLM_PROVIDER=zhipu 时生效）。
 *
 * 覆盖：单轮/多轮/流式/主类入口/usage 统计。
 * 设计依据：agnres 集成测试同构；智谱 glm-4.7-flash OpenAI 兼容协议。
 */

describe.skipIf(!hasZhipuKey())('Zhipu 正常场景', () => {
  let zhipuReachable = false;

  beforeAll(async () => {
    zhipuReachable = await probeZhipuConnectivity();
  }, 15_000);

  beforeEach((ctx) => {
    if (!zhipuReachable) ctx.skip();
  });

  it('1. 单轮文本生成（SHORT_PROMPT）→ content 非空、model 含 glm、usage 正数', async () => {
    const service = createZhipuService();
    const r = await service.generate(SHORT_PROMPT, { ...DEFAULT_OPTS, maxTokens: 200 });

    expect(r.content).toBeTruthy();
    expect(r.content.length).toBeGreaterThan(0);
    expect(r.model).toContain('glm');
    expect(r.usage.promptTokens).toBeGreaterThan(0);
    expect(r.usage.completionTokens).toBeGreaterThan(0);
    expect(r.usage.totalTokens).toBeGreaterThanOrEqual(r.usage.promptTokens);
  });

  it('2. 多轮对话（system+user+assistant+user）→ content 含上下文呼应', async () => {
    const service = createZhipuService();
    const messages: ChatMessage[] = [
      { role: 'system', content: '你是一个法律助手，回答简洁。' },
      { role: 'user', content: '什么是诉讼时效？' },
      { role: 'assistant', content: '诉讼时效是权利人请求法院保护其民事权利的法定期间。' },
      { role: 'user', content: '请用一句话再解释一遍我刚才问的概念。' },
    ];
    const r = await service.generate(messages, { ...DEFAULT_OPTS, maxTokens: 200 });

    expect(r.content).toBeTruthy();
    expect(r.content).toMatch(/时效|期间/);
  });

  it('3. 流式累积 → 拼接后非空且分片数 > 0', async () => {
    const service = createZhipuService();
    let acc = '';
    let chunkCount = 0;
    for await (const ch of service.stream(SHORT_PROMPT, {
      ...DEFAULT_OPTS,
      maxTokens: 200,
    })) {
      acc += ch.delta;
      chunkCount++;
    }

    expect(acc).toBeTruthy();
    expect(acc.length).toBeGreaterThan(0);
    expect(chunkCount).toBeGreaterThan(0);
  });

  it('4. 经 LlmService.generate 主类 → 完整 LlmResponse 结构', async () => {
    const service = createZhipuService();
    const r = await service.generate('什么是违约责任？', { ...DEFAULT_OPTS, maxTokens: 150 });

    expect(r.content).toBeTruthy();
    expect(r.model).toContain('glm');
    expect(r).toHaveProperty('content');
    expect(r).toHaveProperty('model');
    expect(r).toHaveProperty('finishReason');
    expect(r).toHaveProperty('usage');
    expect(r).toHaveProperty('raw');
  });

  it('5. max_tokens=50 → completionTokens ≤ 50，截断时 finishReason=length', async () => {
    const service = createZhipuService();
    const r = await service.generate('请详细介绍中国民法典的编纂历史，至少300字。', {
      ...DEFAULT_OPTS,
      maxTokens: 50,
    });

    expect(r.usage.completionTokens).toBeLessThanOrEqual(50);
    if (r.usage.completionTokens >= 50) {
      expect(r.finishReason).toBe('length');
    }
  });
});