import { describe, it, expect, beforeAll } from 'vitest';
import {
  createAgnesService,
  createServiceWithConfig,
  cloneConfig,
  ensureAgnesReady,
  DEFAULT_OPTS,
} from '../helpers/agnesFixture';
import { createDefaultRegistry } from '../../src/services/legal/llm/registry';
import { LlmServiceImpl } from '../../src/services/legal/llm';
import { NotImplementedError } from '../../src/services/legal/llm/provider';

/**
 * E2E 测试 — 经 LlmService 主类端到端验证。
 *
 * 覆盖：
 * 1. agnes active → generate 成功
 * 2. 切换 active=qwen → 抛 NotImplementedError（桩）
 * 3. validateLawRefs 正则提取
 */

let agnesReady = false;

describe('LlmService E2E', () => {
  beforeAll(async () => {
    agnesReady = await ensureAgnesReady();
    if (!agnesReady) {
      console.warn('[LlmService E2E] Agnes API not available, skipping E2E tests');
    }
  });

  it.skipIf(!agnesReady)(
    '1. 经 LlmService.generate（agnes active）端到端 → 返回 pong',
    async () => {
      const service = createAgnesService();
      const r = await service.generate('Reply with exactly pong.', {
        ...DEFAULT_OPTS,
        maxTokens: 8,
      });
      expect(r.content).toBeTruthy();
      expect(r.content.toLowerCase()).toContain('pong');
      expect(r.model).toContain('agnes');
    },
  );

  it.skipIf(!agnesReady)(
    '2. 切换 active=qwen → LlmService.generate 抛 NotImplementedError',
    async () => {
      const cfg = cloneConfig();
      // 强制 agnes provider 注册（.env 可能 LLM_PROVIDER=zhipu），再切换到 qwen
      cfg.llm.provider = 'agnes';
      // 构造 registry 并切到 qwen
      const registry = createDefaultRegistry(cfg);
      registry.setActive('qwen');
      const service = new LlmServiceImpl(registry);

      await expect(service.generate('hi', { ...DEFAULT_OPTS })).rejects.toBeInstanceOf(
        NotImplementedError,
      );

      // stream 同样抛
      await expect(
        (async () => {
          for await (const _ of service.stream('hi', { ...DEFAULT_OPTS })) {
            // 迭代即抛
          }
        })(),
      ).rejects.toBeInstanceOf(NotImplementedError);
    },
  );

  it.skipIf(!agnesReady)('3. validateLawRefs 正则提取 → unverified 含法条引用', async () => {
    const service = createAgnesService();
    // 使用《》规范引用格式（标准法律引用），避免裸名前接 CJK 连词导致过度匹配
    const text = '根据《民法典》第一百四十三条及《刑法》第二百六十四条的规定，行为人...';
    const result = await service.validateLawRefs(text);

    // MVP：全部归 unverified（不查法律库）
    expect(result.verified).toEqual([]);
    expect(result.unverified.length).toBeGreaterThanOrEqual(2);
    expect(result.unverified.some((r) => r.ref === '民法典第一百四十三条')).toBe(true);
    expect(result.unverified.some((r) => r.ref === '刑法第二百六十四条')).toBe(true);
    expect(result.unverified.every((r) => r.verified === false)).toBe(true);
    expect(result.sanitizedText).toBe(text);
  });

  it.skipIf(!agnesReady)('4. complete 兼容别名 → 返回纯字符串 content', async () => {
    const service = createAgnesService();
    const content = await service.complete('Reply with exactly pong.', {
      ...DEFAULT_OPTS,
      maxTokens: 8,
    });
    expect(typeof content).toBe('string');
    expect(content.toLowerCase()).toContain('pong');
  });
});

/** 补充：无 key 时也验证 validateLawRefs（纯本地，不消耗 tokens） */
describe('LlmService.validateLawRefs（本地，无网络）', () => {
  it('提取多条法条引用并全部标 unverified', async () => {
    const cfg = cloneConfig();
    cfg.agnes.apiKey = 'sk-not-used'; // validateLawRefs 不调用 API
    const service = createServiceWithConfig(cfg);
    const text = '民法典第143条与《婚姻法》第二十一条均适用';
    const result = await service.validateLawRefs(text);
    expect(result.verified).toEqual([]);
    expect(result.unverified).toHaveLength(2);
    expect(result.unverified.map((r) => r.ref).sort()).toEqual([
      '婚姻法第二十一条',
      '民法典第143条',
    ]);
  });

  it('无法条引用时返回空数组', async () => {
    const cfg = cloneConfig();
    cfg.agnes.apiKey = 'sk-not-used';
    const service = createServiceWithConfig(cfg);
    const result = await service.validateLawRefs('今天天气不错');
    expect(result.verified).toEqual([]);
    expect(result.unverified).toEqual([]);
    expect(result.sanitizedText).toBe('今天天气不错');
  });
});
