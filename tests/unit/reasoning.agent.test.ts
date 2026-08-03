/**
 * ReasoningAgent 单元测试（v2.3-W5，11 第 11 个 Agent）。
 *
 * 覆盖：
 *   - AgentCard 字段（agentId=reasoning, 3 capabilities, exposure=L-Write-Limited, async=true）
 *   - capability 'case.reason'：调用 IracReasonerService.reason
 *   - capability 'case.compare'：调用 CaseComparatorService.compare
 *   - capability 'law.apply_check'：调用 LawApplicationDeterminerService.determine
 *   - capability 路由：不支持的能力 → 7005
 *   - 服务未注入 → 7005
 *   - 入参缺失 → 7005
 *   - 执行异常 → 7003
 *   - AgentRegistry 注册与可见性
 *
 * 设计依据：11 reasoning Agent；A4 §五 5.3；16 §2-§5。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReasoningAgent } from '../../src/modules/legal/agents/reasoning.agent';
import { AgentRegistry } from '../../src/modules/legal/agents/registry';
import { AGENT_ERROR_CODES } from '../../src/modules/legal/agents/types';
import type { AgentContext, AgentInvokeInput } from '../../src/modules/legal/agents/types';
import { IRAC_DISCLAIMER_SUFFIX } from '../../src/modules/legal/reasoning/reasoning.types';

function makeCtx(): AgentContext {
  return {
    traceId: 'trace-reasoning-001',
    callerUserId: 'user-1',
    deadline: Date.now() + 30_000,
    lang: 'zh',
  };
}

function makeInput(capability: string, params: Record<string, unknown> = {}): AgentInvokeInput {
  return { capability, params, piiLevel: 'L3' };
}

function makeAudit() {
  return { write: vi.fn(), writeSync: vi.fn() };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
}

/** 构造 mock IracReasonerService */
function makeIracReasoner() {
  return {
    reason: vi.fn().mockResolvedValue({
      issues: [
        { issueText: '争议点', issueType: 'contract_dispute' as const, relatedLaws: ['art-001'] },
      ],
      rules: [
        { articleId: 'art-001', articleText: '法条1', conditions: [], legalConsequences: [] },
      ],
      applications: [
        {
          ruleId: 'art-001',
          factMatch: 'applicable' as const,
          matchedFacts: ['要件1'],
          unmatchedFacts: [],
        },
      ],
      conclusion: {
        summary: '租赁合同有效',
        confidence: 0.85,
        riskLevel: 'low' as const,
        disclaimer: IRAC_DISCLAIMER_SUFFIX,
        lawRefs: ['art-001'],
      },
      reasoningChainId: 'rc_test_001',
      degraded: 'none' as const,
      warnings: [],
      modelVersion: 'qwen-v1',
      promptVersion: 'irac_prompt_v1',
      tokensIn: 100,
      tokensOut: 50,
    }),
  };
}

/** 构造 mock CaseComparatorService */
function makeCaseComparator() {
  return {
    compare: vi.fn().mockResolvedValue({
      comparison: [
        {
          caseId: 'case-001',
          caseTitle: '案例1',
          similarity: 0.85,
          sharedFacts: ['案由：租赁合同纠纷'],
          diffFacts: [],
          verdictDiff: '案例判决与用户预期一致',
          outcomeLabel: '原告胜诉',
        },
      ],
      totalCases: 1,
      warnings: [],
    }),
  };
}

/** 构造 mock LawApplicationDeterminerService */
function makeLawApplicationDeterminer() {
  return {
    determine: vi.fn().mockResolvedValue({
      factMatch: 'applicable' as const,
      matchedFacts: ['要件1', '要件2'],
      unmatchedFacts: [],
      warnings: [],
    }),
  };
}

describe('v2.3-W5 ReasoningAgent（IRAC 推理 Agent）', () => {
  let audit: ReturnType<typeof makeAudit>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    audit = makeAudit();
    logger = makeLogger();
  });

  describe('AgentCard 字段', () => {
    it('agentId=reasoning, 3 capabilities, version=1.0.0', () => {
      const agent = new ReasoningAgent(
        undefined,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      expect(agent.card.agentId).toBe('reasoning');
      expect(agent.card.capabilities).toEqual(['case.reason', 'case.compare', 'law.apply_check']);
      expect(agent.card.version).toBe('1.0.0');
    });

    it('exposure=L-Write-Limited, piiLevel=L3, async=true, timeout=30_000', () => {
      const agent = new ReasoningAgent(
        undefined,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      expect(agent.card.exposure).toBe('L-Write-Limited');
      expect(agent.card.piiLevel).toBe('L3');
      expect(agent.card.async).toBe(true);
      expect(agent.card.timeout).toBe(30_000);
    });

    it('description 包含"IRAC 法律推理"', () => {
      const agent = new ReasoningAgent(
        undefined,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      expect(agent.card.description).toContain('IRAC 法律推理');
    });
  });

  describe('capability 路由', () => {
    it('不支持的能力 → errorCode 7005', async () => {
      const agent = new ReasoningAgent(
        undefined,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(makeInput('unknown.capability'), makeCtx());
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(AGENT_ERROR_CODES.NOT_IMPLEMENTED);
      expect(result.errorMessage).toContain('不支持 capability');
    });
  });

  describe('case.reason：IRAC 四步推理', () => {
    it('调用 IracReasonerService.reason → 返回 issues/rules/applications/conclusion', async () => {
      const irac = makeIracReasoner();
      const agent = new ReasoningAgent(
        irac as never,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput('case.reason', { caseDescription: '租赁合同纠纷', question: '合同有效吗' }),
        makeCtx(),
      );

      expect(result.ok).toBe(true);
      expect(irac.reason).toHaveBeenCalledTimes(1);
      const call = irac.reason.mock.calls[0][0];
      expect(call.caseDescription).toBe('租赁合同纠纷');
      expect(call.question).toBe('合同有效吗');
      expect(result.data.issues).toHaveLength(1);
      expect(result.data.rules).toHaveLength(1);
      expect(result.data.applications).toHaveLength(1);
      expect(result.data.conclusion.summary).toBe('租赁合同有效');
      expect(result.data.reasoningChainId).toBe('rc_test_001');
      expect(result.data.degraded).toBe('none');
      expect(result.disclaimer).toBe(IRAC_DISCLAIMER_SUFFIX);
      expect(result.lawRefs).toEqual([{ ref: 'art-001', verified: true }]);
      expect(result.usage.tokensIn).toBe(100);
      expect(result.usage.tokensOut).toBe(50);
    });

    it('caseDescription 为空 → errorCode 7005', async () => {
      const irac = makeIracReasoner();
      const agent = new ReasoningAgent(
        irac as never,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput('case.reason', {}), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(AGENT_ERROR_CODES.NOT_IMPLEMENTED);
      expect(result.errorMessage).toContain('caseDescription 不能为空');
    });

    it('IracReasonerService 未注入 → errorCode 7005', async () => {
      const agent = new ReasoningAgent(
        undefined,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput('case.reason', { caseDescription: '纠纷' }),
        makeCtx(),
      );

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(AGENT_ERROR_CODES.NOT_IMPLEMENTED);
      expect(result.errorMessage).toContain('IracReasonerService 未注入');
    });

    it('reason 抛异常 → errorCode 7003', async () => {
      const irac = {
        reason: vi.fn().mockRejectedValue(new Error('推理失败')),
      };
      const agent = new ReasoningAgent(
        irac as never,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput('case.reason', { caseDescription: '纠纷' }),
        makeCtx(),
      );

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(7003);
      expect(result.errorMessage).toContain('推理处理异常');
    });

    it('入参 entities 数组传入 → 透传给 reason', async () => {
      const irac = makeIracReasoner();
      const agent = new ReasoningAgent(
        irac as never,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );

      const entities = [
        { type: 'case_cause', value: '租赁纠纷', span: [0, 4], confidence: 0.9, source: 'dict' },
      ];
      await agent.invoke(
        makeInput('case.reason', { caseDescription: '纠纷', entities }),
        makeCtx(),
      );

      expect(irac.reason.mock.calls[0][0].entities).toEqual(entities);
    });
  });

  describe('case.compare：案例对比', () => {
    it('调用 CaseComparatorService.compare → 返回 comparison', async () => {
      const comparator = makeCaseComparator();
      const agent = new ReasoningAgent(
        undefined,
        comparator as never,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput('case.compare', {
          userFacts: { text: '租赁纠纷', entities: [] },
        }),
        makeCtx(),
      );

      expect(result.ok).toBe(true);
      expect(comparator.compare).toHaveBeenCalledTimes(1);
      expect(result.data.comparison).toHaveLength(1);
      expect(result.data.comparison[0].caseId).toBe('case-001');
      expect(result.data.totalCases).toBe(1);
      expect(result.lawRefs).toEqual([{ ref: 'case-001', verified: true }]);
    });

    it('userFacts 缺失 → errorCode 7005', async () => {
      const comparator = makeCaseComparator();
      const agent = new ReasoningAgent(
        undefined,
        comparator as never,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput('case.compare', {}), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(AGENT_ERROR_CODES.NOT_IMPLEMENTED);
      expect(result.errorMessage).toContain('userFacts 不能为空');
    });

    it('CaseComparatorService 未注入 → errorCode 7005', async () => {
      const agent = new ReasoningAgent(
        undefined,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput('case.compare', { userFacts: { text: '纠纷' } }),
        makeCtx(),
      );

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(AGENT_ERROR_CODES.NOT_IMPLEMENTED);
      expect(result.errorMessage).toContain('CaseComparatorService 未注入');
    });

    it('compare 抛异常 → errorCode 7003', async () => {
      const comparator = {
        compare: vi.fn().mockRejectedValue(new Error('对比失败')),
      };
      const agent = new ReasoningAgent(
        undefined,
        comparator as never,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput('case.compare', { userFacts: { text: '纠纷' } }),
        makeCtx(),
      );

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(7003);
    });
  });

  describe('law.apply_check：法条适用判定', () => {
    it('调用 LawApplicationDeterminerService.determine → 返回 factMatch', async () => {
      const determiner = makeLawApplicationDeterminer();
      const agent = new ReasoningAgent(
        undefined,
        undefined,
        determiner as never,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput('law.apply_check', {
          rule: { articleId: 'art-001', articleText: '法条内容', conditions: ['要件1'] },
          factEntities: [],
        }),
        makeCtx(),
      );

      expect(result.ok).toBe(true);
      expect(determiner.determine).toHaveBeenCalledTimes(1);
      expect(result.data.factMatch).toBe('applicable');
      expect(result.data.matchedFacts).toEqual(['要件1', '要件2']);
      expect(result.lawRefs).toEqual([{ ref: 'art-001', verified: true }]);
    });

    it('rule 缺失 → errorCode 7005', async () => {
      const determiner = makeLawApplicationDeterminer();
      const agent = new ReasoningAgent(
        undefined,
        undefined,
        determiner as never,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput('law.apply_check', {}), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(AGENT_ERROR_CODES.NOT_IMPLEMENTED);
      expect(result.errorMessage).toContain('rule 不能为空');
    });

    it('LawApplicationDeterminerService 未注入 → errorCode 7005', async () => {
      const agent = new ReasoningAgent(
        undefined,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput('law.apply_check', { rule: { articleId: 'art-001', articleText: '法条' } }),
        makeCtx(),
      );

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(AGENT_ERROR_CODES.NOT_IMPLEMENTED);
      expect(result.errorMessage).toContain('LawApplicationDeterminerService 未注入');
    });

    it('determine 抛异常 → errorCode 7003', async () => {
      const determiner = {
        determine: vi.fn().mockRejectedValue(new Error('判定失败')),
      };
      const agent = new ReasoningAgent(
        undefined,
        undefined,
        determiner as never,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput('law.apply_check', { rule: { articleId: 'art-001', articleText: '法条' } }),
        makeCtx(),
      );

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(7003);
    });
  });

  describe('AgentRegistry 注册与可见性', () => {
    it('注册成功，listCards 默认可见（L-Write-Limited）', () => {
      const registry = new AgentRegistry();
      const agent = new ReasoningAgent(
        undefined,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      registry.register(agent);

      expect(registry.size).toBe(1);
      expect(registry.capabilityCount).toBe(3);
      const cards = registry.listCards();
      expect(cards.map((c) => c.agentId)).toEqual(['reasoning']);
    });

    it('registry.get(reasoning) 查到 agent', () => {
      const registry = new AgentRegistry();
      const agent = new ReasoningAgent(
        undefined,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      registry.register(agent);

      expect(registry.get('reasoning').card.agentId).toBe('reasoning');
    });

    it('registry.lookup(case.reason) 路由到 reasoning agent', () => {
      const registry = new AgentRegistry();
      const agent = new ReasoningAgent(
        undefined,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      registry.register(agent);

      const resolved = registry.lookup('case.reason');
      expect(resolved?.card.agentId).toBe('reasoning');
    });
  });
});
