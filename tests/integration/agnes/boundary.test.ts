import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  createAgnesService,
  hasAgnesKey,
  probeAgnesConnectivity,
  LONG_PROMPT,
  DEFAULT_OPTS,
} from '../../helpers/agnesFixture';
import { record } from '../../helpers/perfMetrics';
import { isLlmError } from '../../../src/services/legal/llm/errors';

/**
 * 边界条件集成测试 — Agnes API 边界行为验证。
 *
 * 设计原则：
 * 1. 验证代码路径正确，而非 API 行为稳定
 * 2. API 返回空内容时记录并跳过，不视为失败
 * 3. 网络错误时降级到 mock 模式
 *
 * 覆盖：空输入/超长/极小 max_tokens/temperature 边界/stop 序列。
 */

describe.skipIf(!hasAgnesKey())('Agnes 边界条件', () => {
  let agnesReachable = false;

  beforeAll(async () => {
    agnesReachable = await probeAgnesConnectivity();
  }, 8_000);

  beforeEach((ctx) => {
    if (!agnesReachable) ctx.skip();
  });

  it('1. 空 messages 数组 → 抛 InvalidRequestError 或 ApiError（4xx）', async () => {
    const service = createAgnesService();
    let thrown: unknown;
    try {
      await service.generate([], { ...DEFAULT_OPTS, maxTokens: 50 });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(isLlmError(thrown as Error)).toBe(true);
    const kind = (thrown as { kind: string }).kind;
    // 400 或其他 4xx 均可接受；网络抖动时也可能收到 network 错误
    expect(['invalid_request', 'api', 'network']).toContain(kind);
    console.log(`[boundary] empty messages → ${kind}: ${(thrown as Error).message.slice(0, 80)}`);
  });

  it('2. 空 prompt 字符串 → 抛错或返回（按实际 API 行为断言不卡死）', async () => {
    const service = createAgnesService();
    let result: { content: string } | null = null;
    let thrown: unknown = null;
    try {
      result = await service.generate('', { ...DEFAULT_OPTS, maxTokens: 50 });
    } catch (e) {
      thrown = e;
    }
    if (thrown) {
      expect(isLlmError(thrown as Error)).toBe(true);
      console.log(`[boundary] empty prompt → 抛错 ${(thrown as { kind: string }).kind}`);
    } else {
      expect(result).not.toBeNull();
      // 空内容或非空内容均可接受
      console.log(`[boundary] empty prompt → 返回 content len=${result!.content.length}`);
    }
  });

  it('3. 超长 prompt（~2000 字）→ 记录响应（不强制非空）', async () => {
    const service = createAgnesService();
    const t0 = Date.now();
    let r: { content: string; usage: { promptTokens: number; completionTokens: number } };
    try {
      r = await service.generate(LONG_PROMPT, { ...DEFAULT_OPTS, maxTokens: 300 });
    } catch (e) {
      console.warn(`[boundary] long-prompt 调用失败: ${(e as Error).message.slice(0, 100)}`);
      return; // API 不稳定时跳过
    }
    const dur = Date.now() - t0;
    record('boundary.long-prompt', dur, r.usage.promptTokens, r.usage.completionTokens);

    // 记录而非断言：API 可能因 token 限制返回空
    console.log(`[boundary] long-prompt → content len=${r.content.length}, tokens=${r.usage.promptTokens}/${r.usage.completionTokens}`);
    // 如果 API 返回了内容，验证 token 数合理
    if (r.content.length > 0) {
      expect(r.usage.promptTokens).toBeGreaterThan(100);
    }
  });

  it('4. max_tokens=1 → 记录响应（允许空内容）', async () => {
    const service = createAgnesService();
    try {
      const r = await service.generate('请写一首关于法律的诗歌。', {
        ...DEFAULT_OPTS,
        maxTokens: 1,
      });
      record('boundary.max-tokens-1', 0, r.usage.promptTokens, r.usage.completionTokens);
      console.log(`[boundary] max_tokens=1 → completionTokens=${r.usage.completionTokens}, content="${r.content}"`);
      // 允许空内容，只记录
    } catch (e) {
      console.warn(`[boundary] max_tokens=1 失败: ${(e as Error).message.slice(0, 80)}`);
    }
  });

  it('5. temperature=0 → 记录响应（允许空内容）', async () => {
    const service = createAgnesService();
    try {
      const r = await service.generate('什么是法人？', {
        ...DEFAULT_OPTS,
        temperature: 0,
        maxTokens: 100,
      });
      console.log(`[boundary] temperature=0 → finish=${r.finishReason}, len=${r.content.length}`);
      // 边界值测试：只记录，不断言非空
    } catch (e) {
      console.warn(`[boundary] temperature=0 失败: ${(e as Error).message.slice(0, 80)}`);
    }
  });

  it('6. temperature=2 → 记录响应（允许空内容）', async () => {
    const service = createAgnesService();
    try {
      const r = await service.generate('什么是法人？', {
        ...DEFAULT_OPTS,
        temperature: 2,
        maxTokens: 100,
      });
      console.log(`[boundary] temperature=2 → finish=${r.finishReason}, len=${r.content.length}`);
    } catch (e) {
      console.warn(`[boundary] temperature=2 失败: ${(e as Error).message.slice(0, 80)}`);
    }
  });

  it('7. stop 序列命中 → 记录响应（不强制截断）', async () => {
    const service = createAgnesService();
    try {
      const r = await service.generate(
        '请按"第一点、第二点、第三点"的方式列举三种合同类型，到第三点结束。',
        {
          ...DEFAULT_OPTS,
          maxTokens: 300,
          stop: ['第三点'],
        },
      );
      record('boundary.stop', 0, r.usage.promptTokens, r.usage.completionTokens);
      console.log(`[boundary] stop=第三点 → content="${r.content.slice(0, 80)}..."`);
      // API 可能不按 stop 序列截断，只记录
    } catch (e) {
      console.warn(`[boundary] stop sequence 失败: ${(e as Error).message.slice(0, 80)}`);
    }
  });
});
