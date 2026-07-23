import { describe, it, expect } from 'vitest';
import {
  createAgnesService,
  hasAgnesKey,
  LONG_PROMPT,
  DEFAULT_OPTS,
} from '../../helpers/agnesFixture';
import { record } from '../../helpers/perfMetrics';
import { isLlmError } from '../../../src/services/legal/llm/errors';

/**
 * 边界条件集成测试 — 真实 Agnes API。
 *
 * 覆盖：空输入/超长/极小 max_tokens/temperature 边界/stop 序列。
 */

describe.skipIf(!hasAgnesKey())('Agnes 边界条件', () => {
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
    // 400 或其他 4xx 均可接受
    expect(['invalid_request', 'api']).toContain(kind);
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
      // 空内容或非空内容均可接受（API 可能返回提示语）
      console.log(`[boundary] empty prompt → 返回 content len=${result!.content.length}`);
    }
  });

  it('3. 超长 prompt（~2000 字）→ 正常返回', async () => {
    const service = createAgnesService();
    const t0 = Date.now();
    const r = await service.generate(LONG_PROMPT, { ...DEFAULT_OPTS, maxTokens: 300 });
    const dur = Date.now() - t0;
    record('boundary.long-prompt', dur, r.usage.promptTokens, r.usage.completionTokens);

    expect(r.content).toBeTruthy();
    expect(r.usage.promptTokens).toBeGreaterThan(100); // 长 prompt token 数应较多
  });

  it('4. max_tokens=1 → completionTokens<=1', async () => {
    const service = createAgnesService();
    const r = await service.generate('请写一首关于法律的诗歌。', {
      ...DEFAULT_OPTS,
      maxTokens: 1,
    });
    record('boundary.max-tokens-1', 0, r.usage.promptTokens, r.usage.completionTokens);

    expect(r.usage.completionTokens).toBeLessThanOrEqual(1);
    console.log(
      `[boundary] max_tokens=1 → completionTokens=${r.usage.completionTokens}, content="${r.content}"`,
    );
  });

  it('5. temperature=0 → 正常（边界下限）', async () => {
    const service = createAgnesService();
    const r = await service.generate('什么是法人？', {
      ...DEFAULT_OPTS,
      temperature: 0,
      maxTokens: 100,
    });
    expect(r.content).toBeTruthy();
    console.log(`[boundary] temperature=0 → finish=${r.finishReason}, len=${r.content.length}`);
  });

  it('6. temperature=2 → 正常（边界上限）', async () => {
    const service = createAgnesService();
    const r = await service.generate('什么是法人？', {
      ...DEFAULT_OPTS,
      temperature: 2,
      maxTokens: 100,
    });
    expect(r.content).toBeTruthy();
    console.log(`[boundary] temperature=2 → finish=${r.finishReason}, len=${r.content.length}`);
  });

  it('7. stop 序列命中 → content 在 stop 前截断', async () => {
    const service = createAgnesService();
    const r = await service.generate(
      '请按"第一点、第二点、第三点"的方式列举三种合同类型，到第三点结束。',
      {
        ...DEFAULT_OPTS,
        maxTokens: 300,
        stop: ['第三点'],
      },
    );
    record('boundary.stop', 0, r.usage.promptTokens, r.usage.completionTokens);

    expect(r.content).toBeTruthy();
    // content 不应包含 stop 序列（被截断）
    expect(r.content).not.toContain('第三点');
    console.log(`[boundary] stop=第三点 → content="${r.content.slice(0, 80)}..."`);
  });
});
