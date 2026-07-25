/**
 * AgentRegistry 单元测试（A4-W1）。
 *
 * 覆盖：
 *   - register：成功 / agentId 重复 / capability 重复
 *   - lookup：按 capability 查找 / 未注册抛 7006
 *   - get：按 agentId 查找 / 未注册抛 7006
 *   - has / hasCapability
 *   - listCards：默认排除 L-Internal / includeInternal / exposure 过滤
 *   - size / capabilityCount / clearForTesting
 *   - assertExists / assertCapability
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AgentRegistry } from '../../src/modules/legal/agents/registry';
import type {
  AgentCard,
  LegalAgent,
  AgentInvokeInput,
  AgentContext,
  AgentInvokeOutput,
} from '../../src/modules/legal/agents/types';

/** 构造测试用 AgentCard */
function makeCard(overrides: Partial<AgentCard> = {}): AgentCard {
  return {
    agentId: 'test-agent',
    name: '测试 Agent',
    description: '测试用',
    version: '1.0.0',
    capabilities: ['test.capability'],
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    piiLevel: 'L1',
    exposure: 'L-Read',
    async: false,
    timeout: 5000,
    ...overrides,
  };
}

/** 构造测试用 LegalAgent（最小实现） */
function makeAgent(card: AgentCard): LegalAgent {
  return {
    card,
    async invoke(_input: AgentInvokeInput, _ctx: AgentContext): Promise<AgentInvokeOutput> {
      return {
        ok: true,
        data: {},
        lawRefs: [],
        disclaimer: 'test',
        verified: true,
        usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
      };
    },
  };
}

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  describe('register', () => {
    it('成功注册 agent', () => {
      const agent = makeAgent(makeCard());
      registry.register(agent);
      expect(registry.size).toBe(1);
      expect(registry.capabilityCount).toBe(1);
    });

    it('多 capability 一次注册', () => {
      const agent = makeAgent(makeCard({ capabilities: ['cap.a', 'cap.b'] }));
      registry.register(agent);
      expect(registry.size).toBe(1);
      expect(registry.capabilityCount).toBe(2);
    });

    it('agentId 重复抛 ConflictException', () => {
      const agent = makeAgent(makeCard({ agentId: 'dup' }));
      registry.register(agent);
      expect(() => registry.register(makeAgent(makeCard({ agentId: 'dup' })))).toThrow(
        ConflictException,
      );
    });

    it('capability 被其他 agent 占用抛 ConflictException', () => {
      registry.register(makeAgent(makeCard({ agentId: 'a', capabilities: ['shared.cap'] })));
      expect(() =>
        registry.register(makeAgent(makeCard({ agentId: 'b', capabilities: ['shared.cap'] }))),
      ).toThrow(ConflictException);
    });
  });

  describe('lookup', () => {
    it('按 capability 查找返回 agent', () => {
      const agent = makeAgent(makeCard({ agentId: 'law-lookup', capabilities: ['law.lookup'] }));
      registry.register(agent);
      expect(registry.lookup('law.lookup')).toBe(agent);
    });

    it('capability 未注册抛 NotFoundException（7006）', () => {
      try {
        registry.lookup('not.exist');
        throw new Error('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(NotFoundException);
        expect((err as NotFoundException).getResponse()).toMatchObject({ code: 7006 });
      }
    });
  });

  describe('get', () => {
    it('按 agentId 查找返回 agent', () => {
      const agent = makeAgent(makeCard({ agentId: 'legal-qa' }));
      registry.register(agent);
      expect(registry.get('legal-qa')).toBe(agent);
    });

    it('agentId 未注册抛 NotFoundException（7006）', () => {
      expect(() => registry.get('not-exist')).toThrow(NotFoundException);
    });
  });

  describe('has / hasCapability', () => {
    beforeEach(() => {
      registry.register(makeAgent(makeCard({ agentId: 'a', capabilities: ['cap.a', 'cap.b'] })));
    });

    it('has 返回 true/false', () => {
      expect(registry.has('a')).toBe(true);
      expect(registry.has('b')).toBe(false);
    });

    it('hasCapability 返回 true/false', () => {
      expect(registry.hasCapability('cap.a')).toBe(true);
      expect(registry.hasCapability('cap.b')).toBe(true);
      expect(registry.hasCapability('cap.c')).toBe(false);
    });
  });

  describe('listCards', () => {
    beforeEach(() => {
      registry.register(
        makeAgent(makeCard({ agentId: 'b-read', exposure: 'L-Read', capabilities: ['cap.read'] })),
      );
      registry.register(
        makeAgent(
          makeCard({
            agentId: 'a-write',
            exposure: 'L-Write-Limited',
            capabilities: ['cap.write'],
          }),
        ),
      );
      registry.register(
        makeAgent(
          makeCard({
            agentId: 'c-internal',
            exposure: 'L-Internal',
            capabilities: ['cap.internal'],
          }),
        ),
      );
    });

    it('默认排除 L-Internal', () => {
      const cards = registry.listCards();
      const ids = cards.map((c) => c.agentId);
      expect(ids).toEqual(['a-write', 'b-read']); // 按 agentId 排序
      expect(ids).not.toContain('c-internal');
    });

    it('includeInternal=true 包含 L-Internal', () => {
      const cards = registry.listCards({ includeInternal: true });
      const ids = cards.map((c) => c.agentId);
      expect(ids).toContain('c-internal');
      expect(ids).toHaveLength(3);
    });

    it('exposure 过滤：仅 L-Read', () => {
      const cards = registry.listCards({ exposure: ['L-Read'] });
      const ids = cards.map((c) => c.agentId);
      expect(ids).toEqual(['b-read']);
    });

    it('空 registry 返回空数组', () => {
      registry.clearForTesting();
      expect(registry.listCards()).toEqual([]);
    });

    it('结果按 agentId 字典序排序', () => {
      const cards = registry.listCards({ includeInternal: true });
      const ids = cards.map((c) => c.agentId);
      const sorted = [...ids].sort();
      expect(ids).toEqual(sorted);
    });
  });

  describe('assertExists / assertCapability', () => {
    it('assertExists 存在返回 agent', () => {
      const agent = makeAgent(makeCard({ agentId: 'x' }));
      registry.register(agent);
      expect(registry.assertExists('x')).toBe(agent);
    });

    it('assertExists 不存在抛异常', () => {
      expect(() => registry.assertExists('y')).toThrow(NotFoundException);
    });

    it('assertCapability 存在返回 agent', () => {
      const agent = makeAgent(makeCard({ agentId: 'x', capabilities: ['x.cap'] }));
      registry.register(agent);
      expect(registry.assertCapability('x.cap')).toBe(agent);
    });

    it('assertCapability 不存在抛异常', () => {
      expect(() => registry.assertCapability('y.cap')).toThrow(NotFoundException);
    });
  });

  describe('clearForTesting', () => {
    it('清空所有注册', () => {
      registry.register(makeAgent(makeCard()));
      expect(registry.size).toBe(1);
      registry.clearForTesting();
      expect(registry.size).toBe(0);
      expect(registry.capabilityCount).toBe(0);
    });
  });

  describe('size / capabilityCount', () => {
    it('多 agent 多 capability 统计正确', () => {
      registry.register(makeAgent(makeCard({ agentId: 'a', capabilities: ['cap.1', 'cap.2'] })));
      registry.register(makeAgent(makeCard({ agentId: 'b', capabilities: ['cap.3'] })));
      expect(registry.size).toBe(2);
      expect(registry.capabilityCount).toBe(3);
    });
  });
});
