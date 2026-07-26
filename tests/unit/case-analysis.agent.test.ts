/**
 * CaseAnalysisAgent 单元测试（A4-W2）。
 *
 * 覆盖：
 *   - 正常场景：RAG 召回 + LLM 生成 + 法条校验通过 → verified=true
 *   - 法条校验失败 → verified=false
 *   - RAG 召回失败 → 降级到无上下文 LLM 生成（不阻塞）
 *   - 编排器提供 retrievedContext → 跳过 RAG 直接用
 *   - 边界场景：空 caseDescription / LLM 未注入 / RAG 未注入
 *   - 模板方法：usage tokens 透传 + 审计
 *
 * 设计依据：A4 §五 5.1 #6；A2 §4.2 RagService；A3 LlmService。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CaseAnalysisAgent } from '../../src/modules/legal/agents/case-analysis.agent';
import type { AgentContext, AgentInvokeInput } from '../../src/modules/legal/agents/types';
import type { RagService } from '../../src/modules/legal/retrieval/rag.service';
import type { RetrievalResult } from '../../src/modules/legal/retrieval/retrieval.types';
import type { LlmService, LlmResponse, LawRefCheckResult, LawRef } from '../../src/types/llm';

function makeCtx(): AgentContext {
  return {
    traceId: 'trace-case-analysis-001',
    callerUserId: 'user-1',
    deadline: Date.now() + 10_000,
    lang: 'zh',
  };
}

function makeInput(overrides: Partial<AgentInvokeInput> = {}): AgentInvokeInput {
  return {
    capability: 'case.analyze',
    params: { caseDescription: '张某借款10万元未还，李某起诉要求还款' },
    piiLevel: 'L3',
    ...overrides,
  };
}

function makeRagService(results: RetrievalResult[] = [], shouldThrow = false) {
  return {
    retrieve: shouldThrow
      ? vi.fn().mockRejectedValue(new Error('RAG 服务不可用'))
      : vi.fn().mockResolvedValue(results),
  };
}

function makeLlmService(
  response: Partial<LlmResponse> = {},
  checkResult?: Partial<LawRefCheckResult>,
  checkShouldThrow = false,
) {
  return {
    generate: vi.fn().mockResolvedValue({
      content: '本案为民间借贷纠纷，依据民法典第六百六十七条…',
      model: 'agnes-2.0-flash',
      finishReason: 'stop' as const,
      usage: { promptTokens: 500, completionTokens: 200, totalTokens: 700 },
      raw: null,
      ...response,
    }),
    stream: vi.fn(),
    validateLawRefs: checkShouldThrow
      ? vi.fn().mockRejectedValue(new Error('法条校验服务异常'))
      : vi.fn().mockResolvedValue({
          verified: [{ ref: '民法典第六百六十七条', verified: true }] as LawRef[],
          unverified: [] as LawRef[],
          sanitizedText: '...',
          ...checkResult,
        }),
  };
}

function makeAudit() {
  return { write: vi.fn(), writeSync: vi.fn() };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() };
}

describe('CaseAnalysisAgent', () => {
  let audit: ReturnType<typeof makeAudit>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    audit = makeAudit();
    logger = makeLogger();
  });

  describe('AgentCard', () => {
    it('card 字段：agentId=case-analysis, exposure=L-Write-Limited, async=true', () => {
      const agent = new CaseAnalysisAgent(
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      expect(agent.card.agentId).toBe('case-analysis');
      expect(agent.card.capabilities).toEqual(['case.analyze']);
      expect(agent.card.exposure).toBe('L-Write-Limited');
      expect(agent.card.async).toBe(true);
      expect(agent.card.piiLevel).toBe('L3');
      expect(agent.card.timeout).toBe(60_000);
    });
  });

  describe('正常场景：RAG + LLM + 法条校验通过', () => {
    it('RAG 命中 + LLM 生成 + 法条全部 verified → verified=true', async () => {
      const ragResults: RetrievalResult[] = [
        {
          id: 'case-001',
          collection: 'case_precedent',
          title: '类似民间借贷案例',
          content: '借款合同是借款人向贷款人借款…',
          pathScore: 0.9,
          rrfScore: 0.85,
          paths: ['bm25', 'vector'],
        },
      ];
      const rag = makeRagService(ragResults);
      const llm = makeLlmService();
      const agent = new CaseAnalysisAgent(
        rag as unknown as RagService,
        llm as unknown as LlmService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(true);
      expect(result.verified).toBe(true);
      expect(result.data.analysis).toContain('民间借贷');
      expect(result.data.model).toBe('agnes-2.0-flash');
      expect(result.data.finishReason).toBe('stop');
      const retrievedCases = result.data.retrievedCases as Array<{ title: string }>;
      expect(retrievedCases).toHaveLength(1);
      expect(retrievedCases[0].title).toBe('类似民间借贷案例');
      expect(result.lawRefs).toHaveLength(1);
      // usage tokens 透传
      expect(result.usage.tokensIn).toBe(500);
      expect(result.usage.tokensOut).toBe(200);
      // RAG 调用参数
      expect(rag.retrieve).toHaveBeenCalledWith(
        expect.objectContaining({ text: '张某借款10万元未还，李某起诉要求还款', finalTopK: 5 }),
      );
      // LLM 调用参数
      expect(llm.generate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user' }),
        ]),
        expect.objectContaining({ temperature: 0.3, maxTokens: 2000 }),
      );
    });

    it('LLM temperature=0.3, maxTokens=2000 透传', async () => {
      const rag = makeRagService([]);
      const llm = makeLlmService();
      const agent = new CaseAnalysisAgent(
        rag as unknown as RagService,
        llm as unknown as LlmService,
        undefined,
        audit as never,
        logger as never,
      );

      await agent.invoke(makeInput(), makeCtx());

      expect(llm.generate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ temperature: 0.3, maxTokens: 2000 }),
      );
    });
  });

  describe('法条校验', () => {
    it('部分法条 unverified → verified=false，lawRefs 合并', async () => {
      const rag = makeRagService([]);
      const llm = makeLlmService(
        {},
        {
          verified: [{ ref: '民法典第六百六十七条', verified: true }] as LawRef[],
          unverified: [{ ref: '不存在的法条第一条', verified: false }] as LawRef[],
          sanitizedText: '...',
        },
      );
      const agent = new CaseAnalysisAgent(
        rag as unknown as RagService,
        llm as unknown as LlmService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(true);
      expect(result.verified).toBe(false);
      expect(result.lawRefs).toHaveLength(2);
    });

    it('法条校验抛错 → 降级 verified=false, lawRefs=[]', async () => {
      const rag = makeRagService([]);
      const llm = makeLlmService({}, {}, true);
      const agent = new CaseAnalysisAgent(
        rag as unknown as RagService,
        llm as unknown as LlmService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(true);
      expect(result.verified).toBe(false);
      expect(result.lawRefs).toHaveLength(0);
    });
  });

  describe('RAG 失败降级', () => {
    it('RAG 抛错 → 降级到无上下文 LLM 生成（不阻塞）', async () => {
      const rag = makeRagService([], true);
      const llm = makeLlmService();
      const agent = new CaseAnalysisAgent(
        rag as unknown as RagService,
        llm as unknown as LlmService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(true);
      expect(result.data.analysis).toContain('民间借贷');
      // retrievedCases 为空
      const retrievedCases = result.data.retrievedCases as unknown[];
      expect(retrievedCases).toHaveLength(0);
      // LLM 仍被调用
      expect(llm.generate).toHaveBeenCalled();
      // 警告日志
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('RAG 召回失败'),
        expect.anything(),
      );
    });
  });

  describe('编排器提供 retrievedContext', () => {
    it('input.params.retrievedContext 非空 → 跳过 RAG 直接用 LLM', async () => {
      const rag = makeRagService([
        {
          id: 'x',
          collection: 'case_precedent',
          title: '不应被召回',
          content: '...',
          pathScore: 1,
          paths: ['bm25'],
        },
      ]);
      const llm = makeLlmService();
      const agent = new CaseAnalysisAgent(
        rag as unknown as RagService,
        llm as unknown as LlmService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({
          params: {
            caseDescription: '案件描述',
            retrievedContext: '编排器已召回：民法典第六百六十七条…',
          },
        }),
        makeCtx(),
      );

      expect(result.ok).toBe(true);
      expect(rag.retrieve).not.toHaveBeenCalled();
      const retrievedCases = result.data.retrievedCases as unknown[];
      expect(retrievedCases).toHaveLength(0);
    });
  });

  describe('RAG 未注入', () => {
    it('RagService 未注入 → 直接走 LLM 无上下文生成', async () => {
      const llm = makeLlmService();
      const agent = new CaseAnalysisAgent(
        undefined,
        llm as unknown as LlmService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(true);
      expect(result.data.analysis).toBeDefined();
    });
  });

  describe('边界场景', () => {
    it('空 caseDescription → fail 1001', async () => {
      const llm = makeLlmService();
      const agent = new CaseAnalysisAgent(
        undefined,
        llm as unknown as LlmService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput({ params: { caseDescription: '' } }), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(1001);
      expect(llm.generate).not.toHaveBeenCalled();
    });

    it('caseDescription 为 undefined → fail 1001', async () => {
      const llm = makeLlmService();
      const agent = new CaseAnalysisAgent(
        undefined,
        llm as unknown as LlmService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput({ params: {} }), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(1001);
    });

    it('LlmService 未注入 → fail 5001', async () => {
      const agent = new CaseAnalysisAgent(
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(5001);
      expect(result.errorMessage).toContain('LlmService');
    });
  });

  describe('模板方法：审计', () => {
    it('audit.write 被调用 success', async () => {
      const rag = makeRagService([]);
      const llm = makeLlmService();
      const agent = new CaseAnalysisAgent(
        rag as unknown as RagService,
        llm as unknown as LlmService,
        undefined,
        audit as never,
        logger as never,
      );

      await agent.invoke(makeInput(), makeCtx());

      expect(audit.write).toHaveBeenCalledWith(
        'agent_invoke',
        expect.objectContaining({
          agentId: 'case-analysis',
          capability: 'case.analyze',
          result: 'success',
        }),
      );
    });
  });
});
