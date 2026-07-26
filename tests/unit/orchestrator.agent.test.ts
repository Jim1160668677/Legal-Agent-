/**
 * OrchestratorAgent 单元测试（A4-W3）。
 *
 * 覆盖：
 *   - AgentCard 验证
 *   - 编排模式：single（process_guide）/ parallel+serial（case_analysis / document_generate）
 *   - 串行短路：legal_qa 命中 law-lookup 即返（不调 legal-qa）
 *   - 降级机制：agent 失败 → fallbackAgentId / 关键全失败 → 5001
 *   - 并行部分失败：不阻断编排
 *   - 入参派生：deriveInput 按 capability 提取字段
 *   - 输出聚合：lawRefs 合并去重 + usage 累加
 *   - 边界场景：空 message / 意图识别失败 / 未知意图
 *
 * 设计依据：A4 §六；A4 §6.2 PLAN_BY_INTENT；A4 §6.3 编排模式；A4 §6.4 降级。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrchestratorAgent } from '../../src/modules/legal/agents/orchestrator.agent';
import { DISCLAIMER_TEXT } from '../../src/modules/legal/chat/sse-frames';
import { AgentRegistry } from '../../src/modules/legal/agents/registry';
import type {
  AgentCard,
  AgentContext,
  AgentInvokeInput,
  AgentInvokeOutput,
  LegalAgent,
} from '../../src/modules/legal/agents/types';
import type { IntentRouterService } from '../../src/modules/legal/intent/intent-router.service';
import type { IntentResult } from '../../src/types/intent';

// ===== 测试辅助 =====

function makeCtx(): AgentContext {
  return {
    traceId: 'trace-orch-001',
    callerUserId: 'user-1',
    deadline: Date.now() + 30_000,
    lang: 'zh',
  };
}

function makeInput(overrides: Partial<AgentInvokeInput> = {}): AgentInvokeInput {
  return {
    capability: 'orchestrate',
    params: { message: '民法典第一百四十三条怎么理解' },
    piiLevel: 'L1',
    ...overrides,
  };
}

function makeIntentResult(intent: string, overrides: Partial<IntentResult> = {}): IntentResult {
  return {
    intent: intent as IntentResult['intent'],
    confidence: 0.9,
    route: 'rule',
    fallbackUsed: false,
    matchedKeywords: [],
    matchedPatterns: [],
    ...overrides,
  };
}

function makeIntentRouter(intent: string | IntentResult = 'legal_qa') {
  const result = typeof intent === 'string' ? makeIntentResult(intent) : intent;
  return {
    classify: vi.fn().mockResolvedValue(result),
  };
}

function makeAudit() {
  return { write: vi.fn(), writeSync: vi.fn() };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() };
}

/** 构造 mock LegalAgent */
function makeMockAgent(
  agentId: string,
  capabilities: string[],
  invokeImpl: (input: AgentInvokeInput) => Promise<AgentInvokeOutput>,
  overrides: Partial<AgentCard> = {},
): LegalAgent {
  const card: AgentCard = {
    agentId,
    name: agentId,
    description: `mock ${agentId}`,
    version: '1.0.0',
    capabilities,
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    piiLevel: 'L1',
    exposure: 'L-Read',
    async: false,
    timeout: 5000,
    ...overrides,
  };
  return {
    card,
    invoke: vi.fn(invokeImpl),
  };
}

/** 构造成功 agent 输出 */
function okOutput(
  data: Record<string, unknown> = {},
  extra: Partial<AgentInvokeOutput> = {},
): AgentInvokeOutput {
  return {
    ok: true,
    data,
    lawRefs: [],
    disclaimer: DISCLAIMER_TEXT,
    verified: false,
    usage: { durationMs: 10, tokensIn: 5, tokensOut: 10 },
    ...extra,
  };
}

/** 构造失败 agent 输出（业务未命中） */
function missOutput(errorCode = 7003, errorMessage = '未命中'): AgentInvokeOutput {
  return {
    ok: false,
    data: {},
    lawRefs: [],
    disclaimer: DISCLAIMER_TEXT,
    verified: false,
    usage: { durationMs: 5, tokensIn: 0, tokensOut: 0 },
    errorCode,
    errorMessage,
  };
}

/** 构造带预注册 agents 的 AgentRegistry */
function makeRegistry(agents: LegalAgent[]): AgentRegistry {
  const registry = new AgentRegistry();
  for (const a of agents) registry.register(a);
  return registry;
}

describe('OrchestratorAgent', () => {
  let audit: ReturnType<typeof makeAudit>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    audit = makeAudit();
    logger = makeLogger();
  });

  describe('AgentCard', () => {
    it('card 字段：agentId=orchestrator, exposure=L-Internal, capability=orchestrate', () => {
      const registry = new AgentRegistry();
      const router = makeIntentRouter();
      const agent = new OrchestratorAgent(
        registry,
        router as unknown as IntentRouterService,
        undefined,
        audit as never,
        logger as never,
      );
      expect(agent.card.agentId).toBe('orchestrator');
      expect(agent.card.capabilities).toEqual(['orchestrate']);
      expect(agent.card.exposure).toBe('L-Internal');
      expect(agent.card.async).toBe(false);
      expect(agent.card.timeout).toBe(30_000);
    });
  });

  describe('边界场景', () => {
    it('空 message → fail 1001', async () => {
      const registry = new AgentRegistry();
      const router = makeIntentRouter();
      const agent = new OrchestratorAgent(
        registry,
        router as unknown as IntentRouterService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput({ params: { message: '' } }), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(1001);
      expect(router.classify).not.toHaveBeenCalled();
    });

    it('意图识别失败 → fail 5001', async () => {
      const registry = new AgentRegistry();
      const router = {
        classify: vi.fn().mockRejectedValue(new Error('IntentRouter 不可用')),
      };
      const agent = new OrchestratorAgent(
        registry,
        router as unknown as IntentRouterService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(5001);
      expect(result.errorMessage).toContain('意图识别');
    });

    it('未注册的意图 → fail 7003', async () => {
      const registry = new AgentRegistry();
      const router = makeIntentRouter(makeIntentResult('unknown_intent'));
      const agent = new OrchestratorAgent(
        registry,
        router as unknown as IntentRouterService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(7003);
    });
  });

  describe('legal_qa 编排（串行短路）', () => {
    it('law-lookup 命中 → shortCircuit 返回（不调 legal-qa）', async () => {
      const lawLookup = makeMockAgent(
        'law-lookup',
        ['law.lookup'],
        async () =>
          okOutput(
            {
              answer: '民事法律行为有效需要具备相应条件…',
              source: 'law_article',
              matchedKey: '民法典#143',
            },
            { verified: true, lawRefs: [{ ref: '民法典第一百四十三条', verified: true }] },
          ),
        { fallbackAgentId: 'legal-qa' },
      );
      const legalQa = makeMockAgent('legal-qa', ['legal.qa'], async () =>
        okOutput({ answer: 'legal-qa 兜底' }),
      );
      const registry = makeRegistry([lawLookup, legalQa]);
      const router = makeIntentRouter('legal_qa');
      const agent = new OrchestratorAgent(
        registry,
        router as unknown as IntentRouterService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(true);
      expect(result.data.answer).toContain('民事法律行为');
      expect(result.data.intent).toBe('legal_qa');
      expect(result.data.route).toBe('rule');
      // legal-qa 不应被调用（短路）
      expect(legalQa.invoke).not.toHaveBeenCalled();
      // law-lookup 应以 query=message 调用
      expect(lawLookup.invoke).toHaveBeenCalledWith(
        expect.objectContaining({
          capability: 'law.lookup',
          params: { query: '民法典第一百四十三条怎么理解' },
        }),
        expect.anything(),
      );
    });

    it('law-lookup 未命中 → 走 legal-qa（fallbackAgentId）', async () => {
      const lawLookup = makeMockAgent(
        'law-lookup',
        ['law.lookup'],
        async () => missOutput(7003, '法条未命中'),
        { fallbackAgentId: 'legal-qa' },
      );
      const legalQa = makeMockAgent('legal-qa', ['legal.qa'], async () =>
        okOutput({
          answer: 'legal-qa 兜底答案',
          source: 'knowledge',
        }),
      );
      const registry = makeRegistry([lawLookup, legalQa]);
      const router = makeIntentRouter('legal_qa');
      const agent = new OrchestratorAgent(
        registry,
        router as unknown as IntentRouterService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(true);
      expect(result.data.answer).toContain('legal-qa');
      expect(legalQa.invoke).toHaveBeenCalled();
      // 审计 degradation（fallback 触发）
      expect(audit.write).toHaveBeenCalledWith(
        'degradation',
        expect.objectContaining({
          agentId: 'law-lookup',
          fallbackAgentId: 'legal-qa',
        }),
      );
    });
  });

  describe('process_guide 编排（single）', () => {
    it('单 agent 调用 → 返回流程指引', async () => {
      const processGuide = makeMockAgent('process-guide', ['process.guide'], async () =>
        okOutput(
          {
            results: [{ title: '民事立案流程', content: '1. 准备材料…' }],
            total: 1,
            queryType: 'process',
          },
          { lawRefs: [{ ref: '民事诉讼法第一百二十三条', verified: false }] },
        ),
      );
      const registry = makeRegistry([processGuide]);
      const router = makeIntentRouter('process_guide');
      const agent = new OrchestratorAgent(
        registry,
        router as unknown as IntentRouterService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({ params: { message: '立案流程', category: '立案' } }),
        makeCtx(),
      );

      expect(result.ok).toBe(true);
      expect(result.data.total).toBe(1);
      expect(result.data.intent).toBe('process_guide');
      expect(processGuide.invoke).toHaveBeenCalledWith(
        expect.objectContaining({
          capability: 'process.guide',
          params: expect.objectContaining({ category: '立案' }),
        }),
        expect.anything(),
      );
    });
  });

  describe('material_checklist 编排（single）', () => {
    it('单 agent 调用 → 返回材料清单', async () => {
      const processGuide = makeMockAgent(
        'process-guide',
        ['process.guide', 'material.checklist'],
        async () =>
          okOutput({
            results: [{ title: '离婚材料清单', content: '1. 起诉状…' }],
            total: 1,
            queryType: 'material',
          }),
      );
      const registry = makeRegistry([processGuide]);
      const router = makeIntentRouter('material_checklist');
      const agent = new OrchestratorAgent(
        registry,
        router as unknown as IntentRouterService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({ params: { message: '离婚需要什么材料', category: '离婚' } }),
        makeCtx(),
      );

      expect(result.ok).toBe(true);
      expect(result.data.queryType).toBe('material');
      expect(processGuide.invoke).toHaveBeenCalledWith(
        expect.objectContaining({ capability: 'material.checklist' }),
        expect.anything(),
      );
    });
  });

  describe('case_analysis 编排（parallel + serial）', () => {
    it('并行召回 case-search + law-lookup → 串行 case-analyze', async () => {
      const caseSearch = makeMockAgent('case-search', ['case.search'], async () =>
        okOutput(
          {
            results: [
              {
                id: 'c1',
                title: '类似案例',
                content: '借贷纠纷…',
                score: 0.85,
                collection: 'case_precedent',
              },
            ],
            total: 1,
          },
          { lawRefs: [{ ref: '民法典第六百六十七条', verified: true }] },
        ),
      );
      const lawLookup = makeMockAgent('law-lookup', ['law.lookup'], async () =>
        okOutput(
          {
            answer: '民法典第六百六十七条：借款合同…',
            source: 'law_article',
          },
          { lawRefs: [{ ref: '民法典第六百六十七条', verified: true }] },
        ),
      );
      const caseAnalysis = makeMockAgent('case-analysis', ['case.analyze'], async (input) => {
        // 验证 retrievedContext 包含并行召回结果
        const ctx = String(input.params.retrievedContext ?? '');
        expect(ctx).toContain('类似案例');
        expect(ctx).toContain('民法典第六百六十七条');
        return okOutput(
          {
            analysis: '本案为民间借贷纠纷…',
            retrievedCases: [{ title: '类似案例', content: '借贷纠纷…', score: 0.85 }],
            model: 'agnes-2.0-flash',
          },
          {
            verified: true,
            usage: { durationMs: 100, tokensIn: 500, tokensOut: 200 },
          },
        );
      });
      const registry = makeRegistry([caseSearch, lawLookup, caseAnalysis]);
      const router = makeIntentRouter('case_analysis');
      const agent = new OrchestratorAgent(
        registry,
        router as unknown as IntentRouterService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({ params: { message: '张某借款10万不还', caseDescription: '张某借款10万不还' } }),
        makeCtx(),
      );

      expect(result.ok).toBe(true);
      expect(result.data.analysis).toContain('民间借贷');
      expect(result.data.intent).toBe('case_analysis');
      // 并行 agent 都被调用
      expect(caseSearch.invoke).toHaveBeenCalled();
      expect(lawLookup.invoke).toHaveBeenCalled();
      // 串行 agent 被调用
      expect(caseAnalysis.invoke).toHaveBeenCalled();
      // lawRefs 聚合去重（两条民法典第六百六十七条 → 去重为 1）
      const refSet = new Set(result.lawRefs.map((r) => r.ref));
      expect(refSet.has('民法典第六百六十七条')).toBe(true);
    });

    it('并行 agent 部分失败 → 不阻断编排', async () => {
      const caseSearch = makeMockAgent('case-search', ['case.search'], async () =>
        okOutput({ results: [], total: 0 }),
      );
      const lawLookup = makeMockAgent(
        'law-lookup',
        ['law.lookup'],
        async () => {
          throw new Error('law-lookup 服务异常');
        },
        { fallbackAgentId: 'legal-qa' },
      );
      const legalQa = makeMockAgent('legal-qa', ['legal.qa'], async () =>
        missOutput(7003, '未命中'),
      );
      const caseAnalysis = makeMockAgent('case-analysis', ['case.analyze'], async (input) => {
        // law-lookup 失败，retrievedContext 仅来自 case-search
        expect(String(input.params.retrievedContext)).toBe('');
        return okOutput({ analysis: '基于有限上下文分析' });
      });
      const registry = makeRegistry([caseSearch, lawLookup, legalQa, caseAnalysis]);
      const router = makeIntentRouter('case_analysis');
      const agent = new OrchestratorAgent(
        registry,
        router as unknown as IntentRouterService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({ params: { message: '案件描述', caseDescription: '案件描述' } }),
        makeCtx(),
      );

      expect(result.ok).toBe(true);
      expect(result.data.analysis).toContain('有限上下文');
      expect(caseAnalysis.invoke).toHaveBeenCalled();
    });
  });

  describe('document_generate 编排（parallel + serial，异步）', () => {
    it('并行 law-lookup + process-guide → 串行 document', async () => {
      const lawLookup = makeMockAgent('law-lookup', ['law.lookup'], async () =>
        okOutput({ answer: '相关法条…', source: 'law_article' }),
      );
      const processGuide = makeMockAgent('process-guide', ['process.guide'], async () =>
        okOutput({ results: [{ title: '流程', content: '步骤' }], total: 1 }),
      );
      const document = makeMockAgent(
        'document',
        ['document.generate', 'document.export'],
        async (input) => {
          expect(input.params.templateCode).toBe('civil_complaint_v1');
          return okOutput({
            docId: 'doc-001',
            templateCode: 'civil_complaint_v1',
            templateTitle: '民事起诉状',
            renderedText: '原告…被告…',
            exportReady: true,
          });
        },
        { async: true, timeout: 60_000 },
      );
      const registry = makeRegistry([lawLookup, processGuide, document]);
      const router = makeIntentRouter('document_generate');
      const agent = new OrchestratorAgent(
        registry,
        router as unknown as IntentRouterService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({
          params: {
            message: '帮我生成民事起诉状',
            templateCode: 'civil_complaint_v1',
            vars: { plaintiff: '张某', defendant: '李某' },
          },
        }),
        makeCtx(),
      );

      expect(result.ok).toBe(true);
      expect(result.data.docId).toBe('doc-001');
      expect(result.data.intent).toBe('document_generate');
      // document agent 应被调用
      expect(document.invoke).toHaveBeenCalled();
    });
  });

  describe('general_qa 编排（serial，无 shortCircuit）', () => {
    it('legal-qa → case-analysis 串行', async () => {
      const legalQa = makeMockAgent('legal-qa', ['legal.qa'], async () =>
        okOutput({ answer: 'legal-qa 答案', source: 'knowledge' }),
      );
      const caseAnalysis = makeMockAgent('case-analysis', ['case.analyze'], async () =>
        okOutput({ analysis: 'case-analysis 补充分析' }),
      );
      const registry = makeRegistry([legalQa, caseAnalysis]);
      const router = makeIntentRouter('general_qa');
      const agent = new OrchestratorAgent(
        registry,
        router as unknown as IntentRouterService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(true);
      expect(legalQa.invoke).toHaveBeenCalled();
      // general_qa 无 shortCircuit，应继续调 case-analysis
      expect(caseAnalysis.invoke).toHaveBeenCalled();
    });
  });

  describe('降级机制', () => {
    it('关键 agent 全失败 → fail 5001 + 审计 degradation', async () => {
      // legal_qa 编排：law-lookup 抛错 → fallback legal-qa 也抛错 → 全失败
      const lawLookup = makeMockAgent(
        'law-lookup',
        ['law.lookup'],
        async () => {
          throw new Error('law-lookup 不可用');
        },
        { fallbackAgentId: 'legal-qa' },
      );
      const legalQa = makeMockAgent('legal-qa', ['legal.qa'], async () => {
        throw new Error('legal-qa 也不可用');
      });
      const registry = makeRegistry([lawLookup, legalQa]);
      const router = makeIntentRouter('legal_qa');
      const agent = new OrchestratorAgent(
        registry,
        router as unknown as IntentRouterService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(5001);
      expect(audit.write).toHaveBeenCalledWith(
        'degradation',
        expect.objectContaining({
          agentId: 'orchestrator',
          reason: 'critical_agents_failed',
        }),
      );
    });

    it('agent 无 fallback + 抛错 → 触发 5001', async () => {
      const processGuide = makeMockAgent(
        'process-guide',
        ['process.guide'],
        async () => {
          throw new Error('process-guide 完全不可用');
        },
        // 无 fallbackAgentId
      );
      const registry = makeRegistry([processGuide]);
      const router = makeIntentRouter('process_guide');
      const agent = new OrchestratorAgent(
        registry,
        router as unknown as IntentRouterService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({ params: { message: '立案流程', category: '立案' } }),
        makeCtx(),
      );

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(5001);
    });
  });

  describe('输出聚合', () => {
    it('lawRefs 合并去重 + usage tokens 累加', async () => {
      const caseSearch = makeMockAgent('case-search', ['case.search'], async () =>
        okOutput(
          {
            results: [{ title: 'c1', content: 'x', score: 0.9, collection: 'case_precedent' }],
            total: 1,
          },
          {
            lawRefs: [
              { ref: '民法典A', verified: true },
              { ref: '民法典B', verified: true },
            ],
            usage: { durationMs: 50, tokensIn: 100, tokensOut: 50 },
          },
        ),
      );
      const lawLookup = makeMockAgent('law-lookup', ['law.lookup'], async () =>
        okOutput(
          {
            answer: 'ok',
            source: 'law_article',
          },
          {
            lawRefs: [
              { ref: '民法典A', verified: true },
              { ref: '民法典C', verified: true },
            ],
            usage: { durationMs: 20, tokensIn: 50, tokensOut: 30 },
          },
        ),
      );
      const caseAnalysis = makeMockAgent('case-analysis', ['case.analyze'], async () =>
        okOutput(
          { analysis: '分析结论' },
          {
            lawRefs: [{ ref: '民法典D', verified: false }],
            usage: { durationMs: 200, tokensIn: 500, tokensOut: 200 },
          },
        ),
      );
      const registry = makeRegistry([caseSearch, lawLookup, caseAnalysis]);
      const router = makeIntentRouter('case_analysis');
      const agent = new OrchestratorAgent(
        registry,
        router as unknown as IntentRouterService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({ params: { message: '案件', caseDescription: '案件' } }),
        makeCtx(),
      );

      // lawRefs 去重：A 出现两次，最终应为 A/B/C/D 共 4 条
      expect(result.lawRefs).toHaveLength(4);
      const refs = result.lawRefs.map((r) => r.ref).sort();
      expect(refs).toEqual(['民法典A', '民法典B', '民法典C', '民法典D']);
      // usage tokens 累加：100+50+500 = 650 in, 50+30+200 = 280 out
      expect(result.usage.tokensIn).toBe(650);
      expect(result.usage.tokensOut).toBe(280);
    });
  });

  describe('入参派生', () => {
    it('document.generate 派生 templateCode + vars', async () => {
      const document = makeMockAgent(
        'document',
        ['document.generate', 'document.export'],
        async (input) => {
          expect(input.params.templateCode).toBe('standard_contract_v1');
          expect(input.params.vars).toEqual({ partyA: '甲' });
          return okOutput({ docId: 'd1' });
        },
        { async: true },
      );
      const registry = makeRegistry([document]);
      const router = makeIntentRouter('document_generate');
      const agent = new OrchestratorAgent(
        registry,
        router as unknown as IntentRouterService,
        undefined,
        audit as never,
        logger as never,
      );

      await agent.invoke(
        makeInput({
          params: {
            message: '生成合同',
            templateCode: 'standard_contract_v1',
            vars: { partyA: '甲' },
          },
        }),
        makeCtx(),
      );

      expect(document.invoke).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            templateCode: 'standard_contract_v1',
            vars: { partyA: '甲' },
          }),
        }),
        expect.anything(),
      );
    });

    it('case.analyze 派生 caseDescription（默认用 message）', async () => {
      // general_qa 计划：legal-qa → case-analysis 串行
      // 需先注册 legal-qa 让串行链路走通，再验证 case-analysis 接收 caseDescription
      const legalQa = makeMockAgent('legal-qa', ['legal.qa'], async () =>
        okOutput({ answer: 'legal-qa 答案' }),
      );
      const caseAnalysis = makeMockAgent('case-analysis', ['case.analyze'], async (input) => {
        expect(input.params.caseDescription).toBe('用户原始消息');
        return okOutput({ analysis: 'ok' });
      });
      const registry = makeRegistry([legalQa, caseAnalysis]);
      const router = makeIntentRouter('general_qa');
      const agent = new OrchestratorAgent(
        registry,
        router as unknown as IntentRouterService,
        undefined,
        audit as never,
        logger as never,
      );

      await agent.invoke(makeInput({ params: { message: '用户原始消息' } }), makeCtx());

      expect(caseAnalysis.invoke).toHaveBeenCalled();
    });
  });

  describe('模板方法：审计 + 免责声明', () => {
    it('成功路径 → 审计 agent_invoke success + disclaimer 注入', async () => {
      const processGuide = makeMockAgent('process-guide', ['process.guide'], async () =>
        okOutput({ results: [], total: 0 }),
      );
      const registry = makeRegistry([processGuide]);
      const router = makeIntentRouter('process_guide');
      const agent = new OrchestratorAgent(
        registry,
        router as unknown as IntentRouterService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({ params: { message: '流程', category: '立案' } }),
        makeCtx(),
      );

      expect(result.usage.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.disclaimer).toBe(DISCLAIMER_TEXT);
      expect(audit.write).toHaveBeenCalledWith(
        'agent_invoke',
        expect.objectContaining({
          agentId: 'orchestrator',
          capability: 'orchestrate',
          result: 'success',
        }),
      );
    });
  });
});
