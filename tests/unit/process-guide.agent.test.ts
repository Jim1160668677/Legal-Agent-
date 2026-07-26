/**
 * ProcessGuideAgent 单元测试（A4-W2）。
 *
 * 覆盖：
 *   - capability 路由：process.guide → type=process / material.checklist → type=material
 *   - 正常场景：按 category 精确查询 / 按 keyword 模糊查询
 *   - keyword 查询时按 type 过滤
 *   - 边界场景：缺 category/keyword / KnowledgeBase 未注入
 *   - lawRefs 聚合去重
 *
 * 设计依据：A4 §五 5.1 #4；A2 §三 KnowledgeBase。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessGuideAgent } from '../../src/modules/legal/agents/process-guide.agent';
import type { AgentContext, AgentInvokeInput } from '../../src/modules/legal/agents/types';
import type { KnowledgeBaseService } from '../../src/modules/legal/knowledge/knowledge-base.service';
import type { KnowledgeResult } from '../../src/modules/legal/knowledge/knowledge.types';

function makeCtx(): AgentContext {
  return {
    traceId: 'trace-process-guide-001',
    callerUserId: 'user-1',
    deadline: Date.now() + 10_000,
    lang: 'zh',
  };
}

function makeInput(overrides: Partial<AgentInvokeInput> = {}): AgentInvokeInput {
  return {
    capability: 'process.guide',
    params: { category: '立案' },
    piiLevel: 'L2',
    ...overrides,
  };
}

function makeKnowledgeBase(byType: KnowledgeResult[] = [], byKeyword: KnowledgeResult[] = []) {
  return {
    queryByType: vi.fn().mockResolvedValue(byType),
    queryByKeyword: vi.fn().mockResolvedValue(byKeyword),
    getById: vi.fn(),
  };
}

function makeAudit() {
  return { write: vi.fn(), writeSync: vi.fn() };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() };
}

describe('ProcessGuideAgent', () => {
  let audit: ReturnType<typeof makeAudit>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    audit = makeAudit();
    logger = makeLogger();
  });

  describe('AgentCard', () => {
    it('card 字段：双 capability（process.guide + material.checklist）', () => {
      const agent = new ProcessGuideAgent(undefined, undefined, audit as never, logger as never);
      expect(agent.card.agentId).toBe('process-guide');
      expect(agent.card.capabilities).toEqual(['process.guide', 'material.checklist']);
      expect(agent.card.exposure).toBe('L-Read');
    });
  });

  describe('capability 路由', () => {
    it('process.guide → queryType=process', async () => {
      const kb = makeKnowledgeBase(
        [
          {
            type: 'process',
            title: '民事立案流程',
            content: '1. 准备材料 2. 提交起诉状…',
            structured: { steps: ['准备', '提交', '缴费'] },
            lawRefs: [{ ref: '民事诉讼法第一百二十三条', verified: false }],
            score: 1.0,
          },
        ],
        [],
      );
      const agent = new ProcessGuideAgent(
        kb as unknown as KnowledgeBaseService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(true);
      expect(result.data.queryType).toBe('process');
      expect(kb.queryByType).toHaveBeenCalledWith('process', '立案', undefined);
      expect(kb.queryByKeyword).not.toHaveBeenCalled();
    });

    it('material.checklist → queryType=material', async () => {
      const kb = makeKnowledgeBase(
        [
          {
            type: 'material',
            title: '离婚诉讼材料清单',
            content: '1. 起诉状 2. 结婚证 3. 身份证…',
            lawRefs: [],
            score: 1.0,
          },
        ],
        [],
      );
      const agent = new ProcessGuideAgent(
        kb as unknown as KnowledgeBaseService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({
          capability: 'material.checklist',
          params: { category: '离婚' },
        }),
        makeCtx(),
      );

      expect(result.ok).toBe(true);
      expect(result.data.queryType).toBe('material');
      expect(kb.queryByType).toHaveBeenCalledWith('material', '离婚', undefined);
    });

    it('subCategory 透传给 queryByType', async () => {
      const kb = makeKnowledgeBase([], []);
      const agent = new ProcessGuideAgent(
        kb as unknown as KnowledgeBaseService,
        undefined,
        audit as never,
        logger as never,
      );

      await agent.invoke(
        makeInput({
          params: { category: '立案', subCategory: '民事立案' },
        }),
        makeCtx(),
      );

      expect(kb.queryByType).toHaveBeenCalledWith('process', '立案', '民事立案');
    });
  });

  describe('keyword 查询', () => {
    it('无 category 有 keyword → queryByKeyword + 按 type 过滤', async () => {
      const allResults: KnowledgeResult[] = [
        {
          type: 'process',
          title: '起诉流程',
          content: '起诉需要准备…',
          lawRefs: [{ ref: '民事诉讼法第一百一十九条', verified: false }],
          score: 1.0,
        },
        {
          type: 'material',
          title: '起诉材料',
          content: '起诉需要提交…',
          lawRefs: [],
          score: 0.6,
        },
        {
          type: 'faq',
          title: '起诉 FAQ',
          content: '起诉常见问题…',
          lawRefs: [],
          score: 0.3,
        },
      ];
      const kb = makeKnowledgeBase([], allResults);
      const agent = new ProcessGuideAgent(
        kb as unknown as KnowledgeBaseService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({
          capability: 'process.guide',
          params: { keyword: '起诉' },
        }),
        makeCtx(),
      );

      expect(result.ok).toBe(true);
      expect(kb.queryByKeyword).toHaveBeenCalledWith('起诉', { limit: 10 });
      // 过滤掉非 process 类型：仅保留 type === 'process' 的项
      const items = result.data.results as Array<{ title: string }>;
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('起诉流程');
    });

    it('material.checklist + keyword → 仅保留 type=material', async () => {
      const allResults: KnowledgeResult[] = [
        {
          type: 'material',
          title: '立案材料',
          content: '立案材料清单…',
          lawRefs: [],
          score: 0.8,
        },
        {
          type: 'process',
          title: '立案流程',
          content: '流程…',
          lawRefs: [],
          score: 1.0,
        },
      ];
      const kb = makeKnowledgeBase([], allResults);
      const agent = new ProcessGuideAgent(
        kb as unknown as KnowledgeBaseService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({
          capability: 'material.checklist',
          params: { keyword: '立案' },
        }),
        makeCtx(),
      );

      const items = result.data.results as Array<{ title: string }>;
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('立案材料');
    });
  });

  describe('lawRefs 聚合去重', () => {
    it('多条结果含相同法条 → 去重', async () => {
      const results: KnowledgeResult[] = [
        {
          type: 'process',
          title: '流程 A',
          content: '内容 A',
          lawRefs: [
            { ref: '民事诉讼法第一百一十九条', verified: false },
            { ref: '民事诉讼法第一百二十三条', verified: false },
          ],
          score: 1.0,
        },
        {
          type: 'process',
          title: '流程 B',
          content: '内容 B',
          lawRefs: [{ ref: '民事诉讼法第一百一十九条', verified: false }],
          score: 0.6,
        },
      ];
      const kb = makeKnowledgeBase(results, []);
      const agent = new ProcessGuideAgent(
        kb as unknown as KnowledgeBaseService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput({ params: { category: '立案' } }), makeCtx());

      expect(result.lawRefs).toHaveLength(2);
      const refs = result.lawRefs.map((r) => r.ref);
      expect(refs).toContain('民事诉讼法第一百一十九条');
      expect(refs).toContain('民事诉讼法第一百二十三条');
    });
  });

  describe('边界场景', () => {
    it('缺 category 与 keyword → fail 1001', async () => {
      const kb = makeKnowledgeBase([], []);
      const agent = new ProcessGuideAgent(
        kb as unknown as KnowledgeBaseService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput({ params: {} }), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(1001);
      expect(result.errorMessage).toContain('category');
    });

    it('KnowledgeBase 未注入 → fail 5001', async () => {
      const agent = new ProcessGuideAgent(undefined, undefined, audit as never, logger as never);

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(5001);
      expect(result.errorMessage).toContain('KnowledgeBase');
    });

    it('空 category + 空 keyword → fail 1001', async () => {
      const kb = makeKnowledgeBase([], []);
      const agent = new ProcessGuideAgent(
        kb as unknown as KnowledgeBaseService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({ params: { category: '   ', keyword: '' } }),
        makeCtx(),
      );

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(1001);
    });
  });
});
