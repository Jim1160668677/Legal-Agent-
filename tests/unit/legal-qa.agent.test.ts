/**
 * LegalQaAgent 单元测试（A4-W2）。
 *
 * 覆盖：
 *   - 正常场景：RuleEngine 命中 / KnowledgeBase 命中 / 三层降级链
 *   - 未命中场景：RuleEngine + KnowledgeBase 均未命中 → ok=false, errorCode=7003
 *   - 边界场景：空 query / 服务未注入
 *   - 模板方法：invoke 调用 → usage.durationMs 自动填充 + 审计
 *
 * 设计依据：A4 §五 5.1 #2；A4 §6.2 legal_qa 编排计划。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LegalQaAgent } from '../../src/modules/legal/agents/legal-qa.agent';
import type { AgentContext, AgentInvokeInput } from '../../src/modules/legal/agents/types';
import type {
  RuleEngineService,
  RuleResult,
} from '../../src/modules/legal/rule/rule-engine.service';
import type { KnowledgeBaseService } from '../../src/modules/legal/knowledge/knowledge-base.service';
import type { KnowledgeResult } from '../../src/modules/legal/knowledge/knowledge.types';

function makeCtx(): AgentContext {
  return {
    traceId: 'trace-legal-qa-001',
    callerUserId: 'user-1',
    deadline: Date.now() + 10_000,
    lang: 'zh',
  };
}

function makeInput(overrides: Partial<AgentInvokeInput> = {}): AgentInvokeInput {
  return {
    capability: 'legal.qa',
    params: { query: '什么是诉讼时效' },
    piiLevel: 'L2',
    ...overrides,
  };
}

function makeRuleEngine(result: RuleResult | null = null) {
  return { query: vi.fn().mockResolvedValue(result) };
}

function makeKnowledgeBase(results: KnowledgeResult[] = []) {
  return {
    queryByKeyword: vi.fn().mockResolvedValue(results),
    queryByType: vi.fn().mockResolvedValue(results),
    getById: vi.fn(),
  };
}

function makeAudit() {
  return { write: vi.fn(), writeSync: vi.fn() };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() };
}

describe('LegalQaAgent', () => {
  let audit: ReturnType<typeof makeAudit>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    audit = makeAudit();
    logger = makeLogger();
  });

  describe('AgentCard', () => {
    it('card 字段：agentId=legal-qa, piiLevel=L2, exposure=L-Read', () => {
      const agent = new LegalQaAgent(
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      expect(agent.card.agentId).toBe('legal-qa');
      expect(agent.card.capabilities).toEqual(['legal.qa']);
      expect(agent.card.piiLevel).toBe('L2');
      expect(agent.card.exposure).toBe('L-Read');
      expect(agent.card.async).toBe(false);
    });
  });

  describe('第一层：RuleEngine 命中', () => {
    it('RuleEngine 命中法条 → source=law_article, verified=true', async () => {
      const ruleResult: RuleResult = {
        answer: '诉讼时效为三年…',
        source: 'law_article',
        matchedKey: '民法典#188',
        lawRefs: [{ ref: '民法典第一百八十八条', verified: true }],
      };
      const ruleEngine = makeRuleEngine(ruleResult);
      const kb = makeKnowledgeBase([]);
      const agent = new LegalQaAgent(
        ruleEngine as unknown as RuleEngineService,
        kb as unknown as KnowledgeBaseService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(true);
      expect(result.verified).toBe(true);
      expect(result.data.source).toBe('law_article');
      expect(result.data.answer).toContain('诉讼时效');
      // RuleEngine 命中后不应再调 KnowledgeBase
      expect(kb.queryByKeyword).not.toHaveBeenCalled();
    });

    it('RuleEngine 命中 FAQ → source=faq', async () => {
      const ruleEngine = makeRuleEngine({
        answer: '我是法律智能助手',
        source: 'faq',
        matchedKey: '问候',
        lawRefs: [],
      });
      const agent = new LegalQaAgent(
        ruleEngine as unknown as RuleEngineService,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput({ params: { query: '你是谁' } }), makeCtx());

      expect(result.ok).toBe(true);
      expect(result.data.source).toBe('faq');
    });
  });

  describe('第二层：KnowledgeBase 命中（RuleEngine 未命中）', () => {
    it('RuleEngine null + KB 命中 → source=knowledge, verified=false', async () => {
      const ruleEngine = makeRuleEngine(null);
      const kbResults: KnowledgeResult[] = [
        {
          type: 'term',
          title: '诉讼时效',
          content: '诉讼时效是指权利人请求法院保护其民事权利的法定期间…',
          lawRefs: [{ ref: '民法典第一百八十八条', verified: false }],
          score: 1.0,
        },
        {
          type: 'faq',
          title: '诉讼时效中断',
          content: '诉讼时效因提起诉讼、当事人一方提出要求…',
          lawRefs: [],
          score: 0.6,
        },
      ];
      const kb = makeKnowledgeBase(kbResults);
      const agent = new LegalQaAgent(
        ruleEngine as unknown as RuleEngineService,
        kb as unknown as KnowledgeBaseService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(true);
      expect(result.data.source).toBe('knowledge');
      expect(result.data.matchedTitle).toBe('诉讼时效');
      expect(result.data.score).toBe(1.0);
      expect(result.verified).toBe(false);
      expect(result.lawRefs).toHaveLength(1);
      expect(result.data.answer).toContain('诉讼时效');
      expect(result.data.answer).toContain('诉讼时效中断');
      expect(kb.queryByKeyword).toHaveBeenCalledWith('什么是诉讼时效', { limit: 3 });
    });
  });

  describe('第三层：均未命中', () => {
    it('RuleEngine + KB 均未命中 → ok=false, errorCode=7003', async () => {
      const ruleEngine = makeRuleEngine(null);
      const kb = makeKnowledgeBase([]);
      const agent = new LegalQaAgent(
        ruleEngine as unknown as RuleEngineService,
        kb as unknown as KnowledgeBaseService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(7003);
      expect(result.errorMessage).toContain('降级');
      expect(result.data.source).toBe('none');
    });

    it('RuleEngine 未注入 + KB 未命中 → ok=false, errorCode=7003', async () => {
      const kb = makeKnowledgeBase([]);
      const agent = new LegalQaAgent(
        undefined,
        kb as unknown as KnowledgeBaseService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(7003);
    });
  });

  describe('边界场景', () => {
    it('空 query → fail 1001', async () => {
      const ruleEngine = makeRuleEngine(null);
      const agent = new LegalQaAgent(
        ruleEngine as unknown as RuleEngineService,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput({ params: { query: '' } }), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(1001);
    });

    it('query 为 undefined → fail 1001', async () => {
      const agent = new LegalQaAgent(
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput({ params: {} }), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(1001);
    });

    it('两个服务都未注入 → RuleEngine 跳过，KB 跳过，ok=false 7003', async () => {
      const agent = new LegalQaAgent(
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(7003);
    });
  });

  describe('模板方法：usage + 审计', () => {
    it('invoke 调用 → usage.durationMs 自动填充 + 审计 success', async () => {
      const ruleEngine = makeRuleEngine({
        answer: 'ok',
        source: 'law_article',
        matchedKey: '民法典#188',
        lawRefs: [],
      });
      const agent = new LegalQaAgent(
        ruleEngine as unknown as RuleEngineService,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.usage.durationMs).toBeGreaterThanOrEqual(0);
      expect(audit.write).toHaveBeenCalledWith(
        'agent_invoke',
        expect.objectContaining({
          agentId: 'legal-qa',
          capability: 'legal.qa',
          result: 'success',
        }),
      );
    });
  });
});
