/**
 * MemoryAgent 单元测试（A4-W2）。
 *
 * 覆盖：
 *   - capability 路由：memory.read / memory.write
 *   - memory.read：返回 memories 列表（含 dialog/preference/usage 三类）
 *   - memory.write：透传 entry 给 saveMemory
 *   - 边界场景：缺 entry/entry 字段不全 / MemoryManager 未注入
 *   - 模板方法：usage + 审计
 *
 * 设计依据：A4 §五 5.1 #7；06 §八 MemoryManager；A4 §8.2 L-Internal 暴露层级。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryAgent } from '../../src/modules/legal/agents/memory.agent';
import { DISCLAIMER_TEXT } from '../../src/modules/legal/chat/sse-frames';
import type { AgentContext, AgentInvokeInput } from '../../src/modules/legal/agents/types';
import type {
  MemoryManagerService,
  MemoryEntry,
} from '../../src/modules/legal/memory/memory-manager.service';

function makeCtx(): AgentContext {
  return {
    traceId: 'trace-memory-001',
    callerUserId: 'user-1',
    deadline: Date.now() + 10_000,
    lang: 'zh',
  };
}

function makeInput(overrides: Partial<AgentInvokeInput> = {}): AgentInvokeInput {
  return {
    capability: 'memory.read',
    params: { intent: 'legal_qa' },
    piiLevel: 'L2',
    ...overrides,
  };
}

function makeMemoryManager(memories: MemoryEntry[] = []) {
  return {
    getRelevantMemories: vi.fn().mockResolvedValue(memories),
    saveMemory: vi.fn().mockResolvedValue(undefined),
    appendDialog: vi.fn(),
    getDialog: vi.fn(),
    getRecentTurns: vi.fn(),
    updateCase: vi.fn(),
    getCaseTimeline: vi.fn(),
    cleanupOldest: vi.fn(),
  };
}

function makeAudit() {
  return { write: vi.fn(), writeSync: vi.fn() };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() };
}

describe('MemoryAgent', () => {
  let audit: ReturnType<typeof makeAudit>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    audit = makeAudit();
    logger = makeLogger();
  });

  describe('AgentCard', () => {
    it('card 字段：双 capability + L-Internal 暴露层级', () => {
      const agent = new MemoryAgent(undefined, undefined, audit as never, logger as never);
      expect(agent.card.agentId).toBe('memory');
      expect(agent.card.capabilities).toEqual(['memory.read', 'memory.write']);
      expect(agent.card.exposure).toBe('L-Internal');
      expect(agent.card.async).toBe(false);
      expect(agent.card.piiLevel).toBe('L2');
    });
  });

  describe('memory.read', () => {
    it('返回 memories 列表（含 dialog/preference/usage 三类）', async () => {
      const memories: MemoryEntry[] = [
        {
          type: 'dialog',
          key: 'sess-1#2026-07-26T10:00:00Z',
          value: { role: 'user', content: '你好' },
          ts: '2026-07-26T10:00:00Z',
        },
        {
          type: 'preference',
          key: 'user_pref_user-1',
          value: { language: 'zh' },
          ts: '2026-07-26T10:00:00Z',
        },
        {
          type: 'usage',
          key: 'current_intent',
          value: 'legal_qa',
          ts: '2026-07-26T10:00:00Z',
        },
      ];
      const mm = makeMemoryManager(memories);
      const agent = new MemoryAgent(
        mm as unknown as MemoryManagerService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(true);
      expect(result.data.total).toBe(3);
      const items = result.data.memories as Array<{ type: string; key: string }>;
      expect(items).toHaveLength(3);
      expect(items.map((m) => m.type)).toEqual(['dialog', 'preference', 'usage']);
      expect(mm.getRelevantMemories).toHaveBeenCalledWith('legal_qa');
    });

    it('intent 默认值为 general_qa', async () => {
      const mm = makeMemoryManager([]);
      const agent = new MemoryAgent(
        mm as unknown as MemoryManagerService,
        undefined,
        audit as never,
        logger as never,
      );

      await agent.invoke(makeInput({ params: {} }), makeCtx());

      expect(mm.getRelevantMemories).toHaveBeenCalledWith('general_qa');
    });

    it('无记忆时返回空数组', async () => {
      const mm = makeMemoryManager([]);
      const agent = new MemoryAgent(
        mm as unknown as MemoryManagerService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(true);
      expect(result.data.total).toBe(0);
      expect(result.data.memories).toEqual([]);
    });
  });

  describe('memory.write', () => {
    it('透传 entry 给 saveMemory → 返回 saved=true', async () => {
      const mm = makeMemoryManager([]);
      const agent = new MemoryAgent(
        mm as unknown as MemoryManagerService,
        undefined,
        audit as never,
        logger as never,
      );

      const entry: MemoryEntry = {
        type: 'preference',
        key: 'preferred_language',
        value: 'zh-CN',
        ts: new Date().toISOString(),
      };
      const result = await agent.invoke(
        makeInput({
          capability: 'memory.write',
          params: { entry },
        }),
        makeCtx(),
      );

      expect(result.ok).toBe(true);
      expect(result.data.saved).toBe(true);
      expect(result.data.key).toBe('preferred_language');
      expect(result.data.type).toBe('preference');
      expect(mm.saveMemory).toHaveBeenCalledWith(entry);
    });

    it('entry 为空 → fail 1001', async () => {
      const mm = makeMemoryManager([]);
      const agent = new MemoryAgent(
        mm as unknown as MemoryManagerService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({
          capability: 'memory.write',
          params: {},
        }),
        makeCtx(),
      );

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(1001);
      expect(result.errorMessage).toContain('entry');
    });

    it('entry 缺 type → fail 1001', async () => {
      const mm = makeMemoryManager([]);
      const agent = new MemoryAgent(
        mm as unknown as MemoryManagerService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({
          capability: 'memory.write',
          params: { entry: { key: 'k', value: 'v', ts: 'now' } },
        }),
        makeCtx(),
      );

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(1001);
    });

    it('entry 缺 key → fail 1001', async () => {
      const mm = makeMemoryManager([]);
      const agent = new MemoryAgent(
        mm as unknown as MemoryManagerService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({
          capability: 'memory.write',
          params: { entry: { type: 'preference', value: 'v', ts: 'now' } },
        }),
        makeCtx(),
      );

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(1001);
    });
  });

  describe('边界场景', () => {
    it('memory.read + MemoryManager 未注入 → fail 5001', async () => {
      const agent = new MemoryAgent(undefined, undefined, audit as never, logger as never);

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(5001);
      expect(result.errorMessage).toContain('MemoryManagerService');
    });

    it('memory.write + MemoryManager 未注入 → fail 5001', async () => {
      const agent = new MemoryAgent(undefined, undefined, audit as never, logger as never);

      const result = await agent.invoke(
        makeInput({
          capability: 'memory.write',
          params: { entry: { type: 'preference', key: 'k', value: 'v', ts: 'now' } },
        }),
        makeCtx(),
      );

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(5001);
    });
  });

  describe('模板方法：审计 + 免责声明', () => {
    it('memory.read 调用 → 审计 success + disclaimer 注入', async () => {
      const mm = makeMemoryManager([]);
      const agent = new MemoryAgent(
        mm as unknown as MemoryManagerService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.usage.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.disclaimer).toBe(DISCLAIMER_TEXT);
      expect(audit.write).toHaveBeenCalledWith(
        'agent_invoke',
        expect.objectContaining({
          agentId: 'memory',
          capability: 'memory.read',
          result: 'success',
        }),
      );
    });
  });
});
