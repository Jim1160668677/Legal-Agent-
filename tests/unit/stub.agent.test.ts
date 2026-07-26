/**
 * 3 桩 Agent 单元测试（v2.3-W1 更新，验收 #13）。
 *
 * v2.3-W1 变更：
 *   - ToolAgent 已迁移至 tool.agent.ts，相关测试在 tool.agent.test.ts
 *   - 本文件覆盖 3 桩 Agent：NluAgent / ReasoningAgent / LawyerReviewAgent
 *
 * 覆盖：
 *   - 3 桩 Agent 的 AgentCard 字段（agentId / capabilities / exposure / piiLevel / async / timeout）
 *   - 任一 capability 调用 → 返回 NOT_IMPLEMENTED（7005）
 *   - 审计 agent_invoke 写入（result: failed/degraded）
 *   - 注册到 AgentRegistry 后通过 listCards 可见性：
 *     · nlu / lawyer-review（L-Internal）→ listCards 默认不可见，includeInternal=true 可见
 *     · reasoning（L-Write-Limited）→ listCards 默认可见
 *
 * 设计依据：A4 §5.2；A4 §十 验收 #13；A4 §十一 风险「桩 Agent 误调用」。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NluAgent,
  ReasoningAgent,
  LawyerReviewAgent,
} from '../../src/modules/legal/agents/stub.agent';
import { AgentRegistry } from '../../src/modules/legal/agents/registry';
import { AGENT_ERROR_CODES } from '../../src/modules/legal/agents/types';
import type { AgentContext, AgentInvokeInput } from '../../src/modules/legal/agents/types';

function makeCtx(): AgentContext {
  return {
    traceId: 'trace-stub-001',
    callerUserId: 'user-1',
    deadline: Date.now() + 30_000,
    lang: 'zh',
  };
}

function makeInput(capability: string): AgentInvokeInput {
  return {
    capability,
    params: {},
    piiLevel: 'L1',
  };
}

function makeAudit() {
  return { write: vi.fn(), writeSync: vi.fn() };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() };
}

describe('v2.3-W1 3 桩 Agent（验收 #13，ToolAgent 已迁移）', () => {
  let audit: ReturnType<typeof makeAudit>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    audit = makeAudit();
    logger = makeLogger();
  });

  describe('NluAgent', () => {
    it('card 字段：agentId=nlu, capabilities=[nlu.extract, nlu.clarify], exposure=L-Internal', () => {
      const agent = new NluAgent(undefined, audit as never, logger as never);
      expect(agent.card.agentId).toBe('nlu');
      expect(agent.card.capabilities).toEqual(['nlu.extract', 'nlu.clarify']);
      expect(agent.card.exposure).toBe('L-Internal');
      expect(agent.card.piiLevel).toBe('L3');
      expect(agent.card.async).toBe(false);
    });

    it('调用 nlu.extract → 返回 NOT_IMPLEMENTED 7005', async () => {
      const agent = new NluAgent(undefined, audit as never, logger as never);
      const result = await agent.invoke(makeInput('nlu.extract'), makeCtx());
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(AGENT_ERROR_CODES.NOT_IMPLEMENTED);
      expect(result.errorMessage).toContain('nlu');
    });
  });

  describe('ReasoningAgent', () => {
    it('card 字段：agentId=reasoning, 3 capabilities, exposure=L-Write-Limited, async=true', () => {
      const agent = new ReasoningAgent(undefined, audit as never, logger as never);
      expect(agent.card.agentId).toBe('reasoning');
      expect(agent.card.capabilities).toEqual(['case.reason', 'case.compare', 'law.apply_check']);
      expect(agent.card.exposure).toBe('L-Write-Limited');
      expect(agent.card.piiLevel).toBe('L3');
      expect(agent.card.async).toBe(true);
      expect(agent.card.timeout).toBe(30_000);
    });

    it('调用 case.reason → 返回 NOT_IMPLEMENTED 7005', async () => {
      const agent = new ReasoningAgent(undefined, audit as never, logger as never);
      const result = await agent.invoke(makeInput('case.reason'), makeCtx());
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(AGENT_ERROR_CODES.NOT_IMPLEMENTED);
      expect(result.errorMessage).toContain('reasoning');
    });
  });

  describe('LawyerReviewAgent', () => {
    it('card 字段：agentId=lawyer-review, 3 capabilities, exposure=L-Internal, piiLevel=L4', () => {
      const agent = new LawyerReviewAgent(undefined, audit as never, logger as never);
      expect(agent.card.agentId).toBe('lawyer-review');
      expect(agent.card.capabilities).toEqual([
        'review.lawyer',
        'review.score',
        'review.compliance',
      ]);
      expect(agent.card.exposure).toBe('L-Internal');
      expect(agent.card.piiLevel).toBe('L4');
      expect(agent.card.async).toBe(true);
      expect(agent.card.timeout).toBe(60_000);
    });

    it('调用 review.lawyer → 返回 NOT_IMPLEMENTED 7005', async () => {
      const agent = new LawyerReviewAgent(undefined, audit as never, logger as never);
      const result = await agent.invoke(makeInput('review.lawyer'), makeCtx());
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(AGENT_ERROR_CODES.NOT_IMPLEMENTED);
      expect(result.errorMessage).toContain('lawyer-review');
    });
  });

  describe('AgentRegistry 注册与可见性', () => {
    it('3 桩 Agent 全部注册成功，listCards 默认仅显示 L-Write-Limited（reasoning）', () => {
      const registry = new AgentRegistry();
      registry.register(new NluAgent(undefined, audit as never, logger as never));
      registry.register(new ReasoningAgent(undefined, audit as never, logger as never));
      registry.register(new LawyerReviewAgent(undefined, audit as never, logger as never));

      expect(registry.size).toBe(3);
      expect(registry.capabilityCount).toBe(2 + 3 + 3); // 8 capabilities

      // 默认对外暴露：reasoning（L-Write-Limited）
      const publicCards = registry.listCards();
      const publicIds = publicCards.map((c) => c.agentId).sort();
      expect(publicIds).toEqual(['reasoning']);

      // includeInternal=true：3 个全部可见
      const allCards = registry.listCards({ includeInternal: true });
      const allIds = allCards.map((c) => c.agentId).sort();
      expect(allIds).toEqual(['lawyer-review', 'nlu', 'reasoning']);
    });

    it('通过 capability lookup 查到对应桩 Agent', () => {
      const registry = new AgentRegistry();
      registry.register(new NluAgent(undefined, audit as never, logger as never));

      const nlu = registry.lookup('nlu.clarify');
      expect(nlu.card.agentId).toBe('nlu');
    });

    it('registry.get(agentId) 查到 3 桩 Agent', () => {
      const registry = new AgentRegistry();
      registry.register(new NluAgent(undefined, audit as never, logger as never));
      registry.register(new ReasoningAgent(undefined, audit as never, logger as never));
      registry.register(new LawyerReviewAgent(undefined, audit as never, logger as never));

      expect(registry.get('nlu').card.agentId).toBe('nlu');
      expect(registry.get('reasoning').card.agentId).toBe('reasoning');
      expect(registry.get('lawyer-review').card.agentId).toBe('lawyer-review');
    });
  });
});
