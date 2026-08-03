import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  createAgnesService,
  hasAgnesKey,
  probeAgnesConnectivity,
  SHORT_PROMPT,
  DEFAULT_OPTS,
} from '../../helpers/agnesFixture';
import { record } from '../../helpers/perfMetrics';
import type { ChatMessage } from '../../../src/types/llm';

/**
 * 正常场景集成测试 — 真实 Agnes API。
 *
 * 覆盖：单轮/多轮/temperature/max_tokens/流式/主类入口。
 */

describe.skipIf(!hasAgnesKey())('Agnes 正常场景', () => {
  let agnesReachable = false;

  // 连通性预检在 beforeAll 中执行（避免 top-level await 阻塞模块加载导致 vitest worker RPC 超时）
  beforeAll(async () => {
    agnesReachable = await probeAgnesConnectivity();
  }, 8_000);

  // 网络不可达时跳过所有测试（而非逐个超时失败）
  beforeEach((ctx) => {
    if (!agnesReachable) ctx.skip();
  });

  it('1. 单轮文本生成（SHORT_PROMPT）→ content 非空、model 含 agnes、usage 正数', async () => {
    const service = createAgnesService();
    const t0 = Date.now();
    const r = await service.generate(SHORT_PROMPT, { ...DEFAULT_OPTS, maxTokens: 200 });
    const dur = Date.now() - t0;
    record('normal.single-turn', dur, r.usage.promptTokens, r.usage.completionTokens);

    expect(r.content).toBeTruthy();
    expect(r.content.length).toBeGreaterThan(0);
    expect(r.model).toContain('agnes');
    expect(r.usage.promptTokens).toBeGreaterThan(0);
    expect(r.usage.completionTokens).toBeGreaterThan(0);
    expect(r.usage.totalTokens).toBeGreaterThanOrEqual(r.usage.promptTokens);
  });

  it('2. 多轮对话（system+user+assistant+user）→ content 含上下文呼应', async () => {
    const service = createAgnesService();
    const messages: ChatMessage[] = [
      { role: 'system', content: '你是一个法律助手，回答简洁。' },
      { role: 'user', content: '什么是诉讼时效？' },
      { role: 'assistant', content: '诉讼时效是权利人请求法院保护其民事权利的法定期间。' },
      { role: 'user', content: '请用一句话再解释一遍我刚才问的概念。' },
    ];
    const t0 = Date.now();
    const r = await service.generate(messages, { ...DEFAULT_OPTS, maxTokens: 200 });
    const dur = Date.now() - t0;
    record('normal.multi-turn', dur, r.usage.promptTokens, r.usage.completionTokens);

    expect(r.content).toBeTruthy();
    expect(r.content.length).toBeGreaterThan(0);
    // 上下文呼应：回答应与"诉讼时效"相关
    expect(r.content).toMatch(/时效|期间/);
  });

  it('3. temperature=0 两次调用 → 均成功返回非空内容', async () => {
    const service = createAgnesService();
    const prompt = 'Reply with exactly: 合同是双方意思表示一致的协议。';
    const [r1, r2] = await Promise.all([
      service.generate(prompt, { ...DEFAULT_OPTS, temperature: 0, maxTokens: 80 }),
      service.generate(prompt, { ...DEFAULT_OPTS, temperature: 0, maxTokens: 80 }),
    ]);
    record('normal.temp0-1', 0, r1.usage.promptTokens, r1.usage.completionTokens);
    record('normal.temp0-2', 0, r2.usage.promptTokens, r2.usage.completionTokens);

    expect(r1.content).toBeTruthy();
    expect(r2.content).toBeTruthy();
    // 记录是否一致（确定性观察，不硬断言，避免上游非完全确定导致 flaky）
    if (r1.content === r2.content) {
      console.log(`[temp=0] 两次结果一致 ✓ (len=${r1.content.length})`);
    } else {
      console.log(`[temp=0] 两次结果不一致（上游 temp=0 非完全确定）`);
      console.log(`  r1: ${r1.content.slice(0, 60)}`);
      console.log(`  r2: ${r2.content.slice(0, 60)}`);
    }
  });

  it('4. temperature=1 两次调用 → 均成功返回（允许一致或不一致）', async () => {
    const service = createAgnesService();
    const prompt = '用一个比喻形容合同。';
    const [r1, r2] = await Promise.all([
      service.generate(prompt, { ...DEFAULT_OPTS, temperature: 1, maxTokens: 80 }),
      service.generate(prompt, { ...DEFAULT_OPTS, temperature: 1, maxTokens: 80 }),
    ]);
    record('normal.temp1-1', 0, r1.usage.promptTokens, r1.usage.completionTokens);
    record('normal.temp1-2', 0, r2.usage.promptTokens, r2.usage.completionTokens);

    expect(r1.content).toBeTruthy();
    expect(r2.content).toBeTruthy();
  });

  it('5. max_tokens=50 → finishReason 为 length 或 completionTokens<=50', async () => {
    const service = createAgnesService();
    const r = await service.generate('请详细介绍中国民法典的编篆历史，至少300字。', {
      ...DEFAULT_OPTS,
      maxTokens: 50,
    });
    record('normal.max-tokens-50', 0, r.usage.promptTokens, r.usage.completionTokens);

    expect(r.usage.completionTokens).toBeLessThanOrEqual(50);
    // 截断时 finishReason 应为 'length'
    if (r.usage.completionTokens >= 50) {
      expect(r.finishReason).toBe('length');
    }
  });

  it('6. 流式累积 → 拼接后非空', async () => {
    const service = createAgnesService();
    const t0 = Date.now();
    let acc = '';
    let chunkCount = 0;
    for await (const ch of service.stream(SHORT_PROMPT, {
      ...DEFAULT_OPTS,
      maxTokens: 200,
    })) {
      acc += ch.delta;
      chunkCount++;
    }
    const dur = Date.now() - t0;
    record('normal.stream', dur, undefined, undefined);

    expect(acc).toBeTruthy();
    expect(acc.length).toBeGreaterThan(0);
    expect(chunkCount).toBeGreaterThan(0);
  });

  it('7. 经 LlmService.generate 主类 → 等价 provider 直调（返回 content 非空）', async () => {
    const service = createAgnesService();
    const t0 = Date.now();
    const r = await service.generate('什么是违约责任？', { ...DEFAULT_OPTS, maxTokens: 150 });
    const dur = Date.now() - t0;
    record('normal.via-service', dur, r.usage.promptTokens, r.usage.completionTokens);

    expect(r.content).toBeTruthy();
    expect(r.model).toContain('agnes');
    // 主类完整 LlmResponse 结构
    expect(r).toHaveProperty('content');
    expect(r).toHaveProperty('model');
    expect(r).toHaveProperty('finishReason');
    expect(r).toHaveProperty('usage');
    expect(r).toHaveProperty('raw');
  });
});
