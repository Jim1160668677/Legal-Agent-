/**
 * LawLookupAgent 单元测试（A4-W2）。
 *
 * 覆盖：
 *   - 正常场景：RuleEngine 命中法条 → ok=true, verified=true, source=law_article
 *   - 未命中场景：RuleEngine 返回 null → ok=false, errorCode=7003（建议降级 legal-qa）
 *   - 边界场景：空 query / RuleEngine 未注入
 *   - 模板方法：invoke 调用 → usage.durationMs 自动填充 + 审计 success
 *
 * 设计依据：A4 §五 5.1 #1；A4 §6.2 legal_qa 编排计划（串行短路）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LawLookupAgent } from '../../src/modules/legal/agents/law-lookup.agent';
import { DISCLAIMER_TEXT } from '../../src/modules/legal/chat/sse-frames';
import type { AgentContext, AgentInvokeInput } from '../../src/modules/legal/agents/types';
import type { RuleEngineService } from '../../src/modules/legal/rule/rule-engine.service';
import type { RuleResult } from '../../src/modules/legal/rule/rule-engine.service';

function makeCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    traceId: 'trace-law-lookup-001',
    callerUserId: 'user-1',
    deadline: Date.now() + 10_000,
    lang: 'zh',
    ...overrides,
  };
}

function makeInput(overrides: Partial<AgentInvokeInput> = {}): AgentInvokeInput {
  return {
    capability: 'law.lookup',
    params: { query: '民法典第一百四十三条' },
    piiLevel: 'L1',
    ...overrides,
  };
}

function makeRuleEngine(result: RuleResult | null = null) {
  return {
    query: vi.fn().mockResolvedValue(result),
  };
}

function makeAudit() {
  return { write: vi.fn(), writeSync: vi.fn() };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() };
}

describe('LawLookupAgent', () => {
  let audit: ReturnType<typeof makeAudit>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    audit = makeAudit();
    logger = makeLogger();
  });

  describe('AgentCard', () => {
    it('card 字段完整：agentId/capabilities/exposure/fallback', () => {
      const agent = new LawLookupAgent(undefined, undefined, audit as never, logger as never);
      expect(agent.card.agentId).toBe('law-lookup');
      expect(agent.card.capabilities).toEqual(['law.lookup']);
      expect(agent.card.exposure).toBe('L-Read');
      expect(agent.card.async).toBe(false);
      expect(agent.card.fallbackAgentId).toBe('legal-qa');
      expect(agent.card.piiLevel).toBe('L1');
    });
  });

  describe('正常场景：法条命中', () => {
    it('RuleEngine 命中 → ok=true, verified=true, source=law_article', async () => {
      const ruleResult: RuleResult = {
        answer: '民事法律行为有效需要具备相应条件…',
        source: 'law_article',
        matchedKey: '民法典#143',
        lawRefs: [{ ref: '民法典第一百四十三条', title: '民法典', verified: true }],
      };
      const ruleEngine = makeRuleEngine(ruleResult);
      const agent = new LawLookupAgent(
        ruleEngine as unknown as RuleEngineService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(true);
      expect(result.verified).toBe(true);
      expect(result.data.source).toBe('law_article');
      expect(result.data.matchedKey).toBe('民法典#143');
      expect(result.data.answer).toContain('民事法律行为');
      expect(result.lawRefs).toHaveLength(1);
      expect(result.lawRefs[0].ref).toBe('民法典第一百四十三条');
      expect(result.disclaimer).toBe(DISCLAIMER_TEXT);
      expect(result.usage.durationMs).toBeGreaterThanOrEqual(0);
      expect(ruleEngine.query).toHaveBeenCalledWith('民法典第一百四十三条');
    });

    it('FAQ 命中 → source=faq', async () => {
      const ruleResult: RuleResult = {
        answer: '我是法律智能助手',
        source: 'faq',
        matchedKey: '问候',
        lawRefs: [],
      };
      const ruleEngine = makeRuleEngine(ruleResult);
      const agent = new LawLookupAgent(
        ruleEngine as unknown as RuleEngineService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput({ params: { query: '你是谁' } }), makeCtx());

      expect(result.ok).toBe(true);
      expect(result.data.source).toBe('faq');
    });

    it('审计 agent_invoke success', async () => {
      const ruleEngine = makeRuleEngine({
        answer: 'ok',
        source: 'law_article',
        matchedKey: '民法典#143',
        lawRefs: [],
      });
      const agent = new LawLookupAgent(
        ruleEngine as unknown as RuleEngineService,
        undefined,
        audit as never,
        logger as never,
      );

      await agent.invoke(makeInput(), makeCtx());

      expect(audit.write).toHaveBeenCalledWith(
        'agent_invoke',
        expect.objectContaining({
          agentId: 'law-lookup',
          capability: 'law.lookup',
          result: 'success',
        }),
      );
    });
  });

  describe('未命中场景', () => {
    it('RuleEngine 返回 null → ok=false, errorCode=7003（建议降级）', async () => {
      const ruleEngine = makeRuleEngine(null);
      const agent = new LawLookupAgent(
        ruleEngine as unknown as RuleEngineService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({ params: { query: '量子力学的法律意义' } }),
        makeCtx(),
      );

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(7003);
      expect(result.errorMessage).toContain('降级');
      expect(result.verified).toBe(false);
      expect(result.disclaimer).toBe(DISCLAIMER_TEXT);
    });
  });

  describe('边界场景', () => {
    it('空 query → fail 1001', async () => {
      const ruleEngine = makeRuleEngine(null);
      const agent = new LawLookupAgent(
        ruleEngine as unknown as RuleEngineService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput({ params: { query: '' } }), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(1001);
      expect(result.errorMessage).toContain('查询文本');
    });

    it('纯空白 query → fail 1001', async () => {
      const ruleEngine = makeRuleEngine(null);
      const agent = new LawLookupAgent(
        ruleEngine as unknown as RuleEngineService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput({ params: { query: '   ' } }), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(1001);
    });

    it('query 为 undefined → fail 1001', async () => {
      const ruleEngine = makeRuleEngine(null);
      const agent = new LawLookupAgent(
        ruleEngine as unknown as RuleEngineService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput({ params: {} }), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(1001);
    });

    it('RuleEngine 未注入 → fail 5001', async () => {
      const agent = new LawLookupAgent(undefined, undefined, audit as never, logger as never);

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(5001);
      expect(result.errorMessage).toContain('RuleEngine');
    });
  });
});
