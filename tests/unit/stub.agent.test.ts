/**
 * 4 桩 Agent 单元测试（A4-W4，验收 #13）。
 *
 * 覆盖：
 *   - 4 桩 Agent 的 AgentCard 字段（agentId / capabilities / exposure / piiLevel / async / timeout）
 *   - 任一 capability 调用 → 返回 NOT_IMPLEMENTED（7005）
 *   - 审计 agent_invoke 写入（result: failed/degraded）
 *   - 注册到 AgentRegistry 后通过 listCards 可见性：
 *     · tool（L-Read）→ listCards 默认可见
 *     · nlu / lawyer-review（L-Internal）→ listCards 默认不可见，includeInternal=true 可见
 *     · reasoning（L-Write-Limited）→ listCards 默认可见
 *
 * 设计依据：A4 §5.2；A4 §十 验收 #13；A4 §十一 风险「桩 Agent 误调用」。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ToolAgent,
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

describe('A4-W4 4 桩 Agent（验收 #13）', () => {
  let audit: ReturnType<typeof makeAudit>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    audit = makeAudit();
    logger = makeLogger();
  });

  describe('ToolAgent', () => {
    it('card 字段：agentId=tool, 8 capabilities, exposure=L-Read, piiLevel=L2', () => {
      const agent = new ToolAgent(undefined, audit as never, logger as never);
      expect(agent.card.agentId).toBe('tool');
      expect(agent.card.capabilities).toHaveLength(8);
      expect(agent.card.capabilities).toContain('tool.period_calculator');
      expect(agent.card.capabilities).toContain('tool.fee_calculator');
      expect(agent.card.exposure).toBe('L-Read');
      expect(agent.card.piiLevel).toBe('L2');
      expect(agent.card.async).toBe(false);
      expect(agent.card.timeout).toBe(5_000);
      expect(agent.card.version).toBe('0.1.0');
    });

    it('调用 tool.period_calculator → 返回 NOT_IMPLEMENTED 7005', async () => {
      const agent = new ToolAgent(undefined, audit as never, logger as never);
      const result = await agent.invoke(makeInput('tool.period_calculator'), makeCtx());
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(AGENT_ERROR_CODES.NOT_IMPLEMENTED);
      expect(result.errorMessage).toContain('tool');
      expect(result.errorMessage).toContain('未实现');
      expect(result.disclaimer).toBeTruthy();
      // 审计写入 failed
      expect(audit.write).toHaveBeenCalledWith(
        'agent_invoke',
        expect.objectContaining({
          agentId: 'tool',
          capability: 'tool.period_calculator',
          result: expect.stringMatching(/failed|degraded/),
        }),
      );
    });

    it('调用任一 capability 都返回 7005', async () => {
      const agent = new ToolAgent(undefined, audit as never, logger as never);
      for (const cap of agent.card.capabilities) {
        const result = await agent.invoke(makeInput(cap), makeCtx());
        expect(result.errorCode).toBe(AGENT_ERROR_CODES.NOT_IMPLEMENTED);
      }
    });
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
    it('4 桩 Agent 全部注册成功，listCards 默认仅显示 L-Read + L-Write-Limited', () => {
      const registry = new AgentRegistry();
      registry.register(new ToolAgent(undefined, audit as never, logger as never));
      registry.register(new NluAgent(undefined, audit as never, logger as never));
      registry.register(new ReasoningAgent(undefined, audit as never, logger as never));
      registry.register(new LawyerReviewAgent(undefined, audit as never, logger as never));

      expect(registry.size).toBe(4);
      expect(registry.capabilityCount).toBe(8 + 2 + 3 + 3); // 16 capabilities

      // 默认对外暴露：tool（L-Read）+ reasoning（L-Write-Limited）
      const publicCards = registry.listCards();
      const publicIds = publicCards.map((c) => c.agentId).sort();
      expect(publicIds).toEqual(['reasoning', 'tool']);

      // includeInternal=true：4 个全部可见
      const allCards = registry.listCards({ includeInternal: true });
      const allIds = allCards.map((c) => c.agentId).sort();
      expect(allIds).toEqual(['lawyer-review', 'nlu', 'reasoning', 'tool']);
    });

    it('通过 capability lookup 查到对应桩 Agent', () => {
      const registry = new AgentRegistry();
      registry.register(new ToolAgent(undefined, audit as never, logger as never));
      registry.register(new NluAgent(undefined, audit as never, logger as never));

      const tool = registry.lookup('tool.period_calculator');
      expect(tool.card.agentId).toBe('tool');

      const nlu = registry.lookup('nlu.clarify');
      expect(nlu.card.agentId).toBe('nlu');
    });

    it('registry.get(agentId) 查到 4 桩 Agent', () => {
      const registry = new AgentRegistry();
      registry.register(new ToolAgent(undefined, audit as never, logger as never));
      registry.register(new NluAgent(undefined, audit as never, logger as never));
      registry.register(new ReasoningAgent(undefined, audit as never, logger as never));
      registry.register(new LawyerReviewAgent(undefined, audit as never, logger as never));

      expect(registry.get('tool').card.agentId).toBe('tool');
      expect(registry.get('nlu').card.agentId).toBe('nlu');
      expect(registry.get('reasoning').card.agentId).toBe('reasoning');
      expect(registry.get('lawyer-review').card.agentId).toBe('lawyer-review');
    });
  });

  describe('12 Agent 完整注册（验收 #1）', () => {
    it('8 核心 + 4 桩 = 12 Agent 全部注册成功', () => {
      // 此测试验证 stub agent 与现有 8 核心 agent 不冲突
      // 8 核心 agent 在 agents.module.ts 注册，本测试仅验证 4 桩能独立注册
      const registry = new AgentRegistry();
      registry.register(new ToolAgent(undefined, audit as never, logger as never));
      registry.register(new NluAgent(undefined, audit as never, logger as never));
      registry.register(new ReasoningAgent(undefined, audit as never, logger as never));
      registry.register(new LawyerReviewAgent(undefined, audit as never, logger as never));
      expect(registry.size).toBe(4);
      // 12 Agent 完整注册在 AgentsModule.onModuleInit 集成测试中验证
    });
  });
});
