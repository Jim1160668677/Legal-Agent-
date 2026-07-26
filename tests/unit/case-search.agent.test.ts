/**
 * CaseSearchAgent 单元测试（A4-W2）。
 *
 * 覆盖：
 *   - 正常场景：RagService 返回结果 → 聚合 lawRefs + 截断 content
 *   - 空结果场景：RagService 返回 [] → ok=true, total=0
 *   - 边界场景：空 query / RagService 未注入
 *   - topK 参数透传
 *   - 模板方法：usage + 审计
 *
 * 设计依据：A4 §五 5.1 #3；A2 §4.2 RagService 三路召回。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CaseSearchAgent } from '../../src/modules/legal/agents/case-search.agent';
import type { AgentContext, AgentInvokeInput } from '../../src/modules/legal/agents/types';
import type { RagService } from '../../src/modules/legal/retrieval/rag.service';
import type { RetrievalResult } from '../../src/modules/legal/retrieval/retrieval.types';

function makeCtx(): AgentContext {
  return {
    traceId: 'trace-case-search-001',
    callerUserId: 'user-1',
    deadline: Date.now() + 10_000,
    lang: 'zh',
  };
}

function makeInput(overrides: Partial<AgentInvokeInput> = {}): AgentInvokeInput {
  return {
    capability: 'case.search',
    params: { query: '民间借贷纠纷案例', topK: 5 },
    piiLevel: 'L2',
    ...overrides,
  };
}

function makeRagService(results: RetrievalResult[] = []) {
  return {
    retrieve: vi.fn().mockResolvedValue(results),
  };
}

function makeAudit() {
  return { write: vi.fn(), writeSync: vi.fn() };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() };
}

describe('CaseSearchAgent', () => {
  let audit: ReturnType<typeof makeAudit>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    audit = makeAudit();
    logger = makeLogger();
  });

  describe('AgentCard', () => {
    it('card 字段：agentId=case-search, exposure=L-Read, timeout=10000', () => {
      const agent = new CaseSearchAgent(undefined, undefined, audit as never, logger as never);
      expect(agent.card.agentId).toBe('case-search');
      expect(agent.card.capabilities).toEqual(['case.search']);
      expect(agent.card.exposure).toBe('L-Read');
      expect(agent.card.timeout).toBe(10_000);
    });
  });

  describe('正常场景：检索命中', () => {
    it('RagService 返回多条 → 聚合 lawRefs + 截断 content 到 500 字符', async () => {
      const longContent = '案'.repeat(800);
      const results: RetrievalResult[] = [
        {
          id: 'case-001',
          collection: 'case_precedent',
          title: '张某诉李某民间借贷案',
          content: longContent,
          pathScore: 0.95,
          rrfScore: 0.85,
          paths: ['bm25', 'vector'],
          lawRefs: [{ ref: '民法典第六百六十七条', verified: true }],
        },
        {
          id: 'law-001',
          collection: 'law_article',
          title: '民法典借款合同',
          content: '借款合同是借款人向贷款人借款…',
          pathScore: 0.7,
          paths: ['structured'],
          lawRefs: [
            { ref: '民法典第六百六十七条', verified: true },
            { ref: '民法典第六百七十九条', verified: false },
          ],
        },
      ];
      const rag = makeRagService(results);
      const agent = new CaseSearchAgent(
        rag as unknown as RagService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(true);
      expect(result.data.total).toBe(2);
      const items = result.data.results as Array<{ id: string; content: string; score: number }>;
      expect(items[0].id).toBe('case-001');
      expect(items[0].content.length).toBe(500); // 截断
      expect(items[0].score).toBe(0.85); // 用 rrfScore
      expect(items[1].score).toBe(0.7); // 无 rrfScore 时用 pathScore
      // lawRefs 去重
      expect(result.lawRefs).toHaveLength(2);
      const refs = result.lawRefs.map((r) => r.ref);
      expect(refs).toContain('民法典第六百六十七条');
      expect(refs).toContain('民法典第六百七十九条');
    });

    it('topK 参数透传给 RagService', async () => {
      const rag = makeRagService([]);
      const agent = new CaseSearchAgent(
        rag as unknown as RagService,
        undefined,
        audit as never,
        logger as never,
      );

      await agent.invoke(makeInput({ params: { query: '离婚案例', topK: 20 } }), makeCtx());

      expect(rag.retrieve).toHaveBeenCalledWith(
        expect.objectContaining({
          text: '离婚案例',
          finalTopK: 20,
          collections: ['case_precedent', 'law_article'],
        }),
      );
    });

    it('topK 未指定 → 默认 10', async () => {
      const rag = makeRagService([]);
      const agent = new CaseSearchAgent(
        rag as unknown as RagService,
        undefined,
        audit as never,
        logger as never,
      );

      await agent.invoke(makeInput({ params: { query: '合同纠纷' } }), makeCtx());

      expect(rag.retrieve).toHaveBeenCalledWith(expect.objectContaining({ finalTopK: 10 }));
    });
  });

  describe('空结果场景', () => {
    it('RagService 返回 [] → ok=true, total=0', async () => {
      const rag = makeRagService([]);
      const agent = new CaseSearchAgent(
        rag as unknown as RagService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(true);
      expect(result.data.total).toBe(0);
      expect(result.lawRefs).toHaveLength(0);
    });
  });

  describe('边界场景', () => {
    it('空 query → fail 1001', async () => {
      const rag = makeRagService([]);
      const agent = new CaseSearchAgent(
        rag as unknown as RagService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput({ params: { query: '' } }), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(1001);
      expect(rag.retrieve).not.toHaveBeenCalled();
    });

    it('query 为 undefined → fail 1001', async () => {
      const rag = makeRagService([]);
      const agent = new CaseSearchAgent(
        rag as unknown as RagService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput({ params: {} }), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(1001);
    });

    it('RagService 未注入 → fail 5001', async () => {
      const agent = new CaseSearchAgent(undefined, undefined, audit as never, logger as never);

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(5001);
      expect(result.errorMessage).toContain('RagService');
    });
  });

  describe('模板方法：usage + 审计', () => {
    it('invoke 调用 → usage.durationMs + 审计 success', async () => {
      const rag = makeRagService([]);
      const agent = new CaseSearchAgent(
        rag as unknown as RagService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.usage.durationMs).toBeGreaterThanOrEqual(0);
      expect(audit.write).toHaveBeenCalledWith(
        'agent_invoke',
        expect.objectContaining({
          agentId: 'case-search',
          capability: 'case.search',
          result: 'success',
        }),
      );
    });
  });
});
