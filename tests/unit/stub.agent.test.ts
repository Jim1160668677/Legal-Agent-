/**
 * LawyerReviewAgent 卡片注册与可见性测试（v2.3 阶段十更新）。
 *
 * v2.3 演进：
 *   - v2.3-W1：ToolAgent 迁移至 tool.agent.ts，相关测试在 tool.agent.test.ts
 *   - v2.3-W4：NluAgent 迁移至 nlu.agent.ts，相关测试在 nlu.agent.test.ts
 *   - v2.3-W5：ReasoningAgent 迁移至 reasoning.agent.ts，相关测试在 reasoning.agent.test.ts
 *   - v2.3 阶段十：LawyerReviewAgent 迁移至 lawyer-review.agent.ts（完整实现，不再是桩）
 *
 * 本文件覆盖 LawyerReviewAgent 的：
 *   - AgentCard 字段（agentId / capabilities / exposure / piiLevel / async / timeout）
 *   - 注册到 AgentRegistry 后通过 listCards 可见性：
 *     · lawyer-review（L-Internal）→ listCards 默认不可见，includeInternal=true 可见
 *
 * 注：完整功能测试（sample/claim/submit/scan/reflow）见 lawyer-review.agent.test.ts
 *
 * 设计依据：A4 §5.2；17 §8 Agent 编排。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LawyerReviewAgent } from '../../src/modules/legal/agents/lawyer-review.agent';
import { AgentRegistry } from '../../src/modules/legal/agents/registry';

function makeAudit() {
  return { write: vi.fn(), writeSync: vi.fn() };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() };
}

describe('LawyerReviewAgent 卡片注册与可见性（v2.3 阶段十完整实现）', () => {
  let audit: ReturnType<typeof makeAudit>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    audit = makeAudit();
    logger = makeLogger();
  });

  describe('LawyerReviewAgent card', () => {
    it('card 字段：agentId=lawyer-review, 3 capabilities, exposure=L-Internal, piiLevel=L4', () => {
      const agent = new LawyerReviewAgent(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
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
  });

  describe('AgentRegistry 注册与可见性', () => {
    it('LawyerReviewAgent 注册成功，listCards 默认不显示（L-Internal）', () => {
      const registry = new AgentRegistry();
      registry.register(
        new LawyerReviewAgent(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          audit as never,
          logger as never,
        ),
      );

      expect(registry.size).toBe(1);
      expect(registry.capabilityCount).toBe(3);

      // 默认对外暴露：lawyer-review（L-Internal）→ 不可见
      const publicCards = registry.listCards();
      expect(publicCards).toEqual([]);

      // includeInternal=true：可见
      const allCards = registry.listCards({ includeInternal: true });
      const allIds = allCards.map((c) => c.agentId);
      expect(allIds).toEqual(['lawyer-review']);
    });

    it('registry.get(lawyer-review) 查到 Agent', () => {
      const registry = new AgentRegistry();
      registry.register(
        new LawyerReviewAgent(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          audit as never,
          logger as never,
        ),
      );

      expect(registry.get('lawyer-review').card.agentId).toBe('lawyer-review');
    });

    it('registry.lookup(review.lawyer) 路由到 lawyer-review agent', () => {
      const registry = new AgentRegistry();
      registry.register(
        new LawyerReviewAgent(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          audit as never,
          logger as never,
        ),
      );

      const resolved = registry.lookup('review.lawyer');
      expect(resolved?.card.agentId).toBe('lawyer-review');
    });
  });
});
