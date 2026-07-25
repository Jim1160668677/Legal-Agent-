/**
 * BaseAgent 单元测试（A4-W1）。
 *
 * 覆盖模板方法模式的横切关注点：
 *   - PII 边界校验：input L4 > card L1 抛 7004 + 审计 blocked
 *   - 成功路径：usage.durationMs 自动填充 + 审计 success
 *   - 免责声明兜底：output 缺 disclaimer 注入 FALLBACK_DISCLAIMER
 *   - 超时保护：execute 慢于 timeout 抛 7003 + 审计 degraded
 *   - execute 抛错：原样传播 + 审计 failed
 *   - resolveTimeout：deadline 剩余预算 < card.timeout 时取较小值
 *   - PiiService 未注入时跳过边界校验
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { BaseAgent } from '../../src/modules/legal/agents/base.agent';
import { FALLBACK_DISCLAIMER } from '../../src/modules/legal/agents/agents.constants';
import type {
  AgentCard,
  AgentContext,
  AgentInvokeInput,
  AgentInvokeOutput,
} from '../../src/modules/legal/agents/types';
import type { PiiService } from '../../src/modules/platform/pii/pii.service';
import type { AuditLogService } from '../../src/modules/platform/audit/audit-log.service';
import type { AppLoggerService } from '../../src/modules/platform/logger/logger.service';

/** 构造测试用 AgentCard */
function makeCard(overrides: Partial<AgentCard> = {}): AgentCard {
  return {
    agentId: 'test-agent',
    name: '测试 Agent',
    description: '测试用',
    version: '1.0.0',
    capabilities: ['test.cap'],
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    piiLevel: 'L1',
    exposure: 'L-Read',
    async: false,
    timeout: 200, // 200ms，便于测试超时
    ...overrides,
  };
}

/** 构造测试用 AgentContext */
function makeCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    traceId: 'trace-test-001',
    callerUserId: 'user-1',
    deadline: Date.now() + 10_000,
    lang: 'zh',
    ...overrides,
  };
}

/** 构造测试用 AgentInvokeInput */
function makeInput(overrides: Partial<AgentInvokeInput> = {}): AgentInvokeInput {
  return {
    capability: 'test.cap',
    params: { q: 'hello' },
    piiLevel: 'L1',
    ...overrides,
  };
}

/** 构造 mock PiiService */
function makePii() {
  return {
    assertBoundary: vi.fn(),
    classify: vi.fn(() => 'L1' as const),
    mask: vi.fn((s: string) => s),
    detectAndMask: vi.fn(),
    encrypt: vi.fn((s: string) => `ENC(${s})`),
    decrypt: vi.fn((s: string) => s.replace(/^ENC\((.*)\)$/, '$1')),
  };
}

/** 构造 mock AuditLogService */
function makeAudit() {
  return { write: vi.fn(), writeSync: vi.fn() };
}

/** 构造 mock AppLoggerService */
function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() };
}

/**
 * 测试用具体 Agent：可注入 execute 实现。
 */
class TestAgent extends BaseAgent {
  readonly card: AgentCard;
  private readonly executeImpl: (
    input: AgentInvokeInput,
    ctx: AgentContext,
  ) => Promise<AgentInvokeOutput>;

  constructor(
    executeImpl: (input: AgentInvokeInput, ctx: AgentContext) => Promise<AgentInvokeOutput>,
    card: AgentCard,
    pii?: PiiService,
    audit?: AuditLogService,
    logger?: AppLoggerService,
  ) {
    super(pii, audit, logger);
    this.card = card;
    this.executeImpl = executeImpl;
  }

  protected execute(input: AgentInvokeInput, ctx: AgentContext): Promise<AgentInvokeOutput> {
    return this.executeImpl(input, ctx);
  }
}

describe('BaseAgent', () => {
  let pii: ReturnType<typeof makePii>;
  let audit: ReturnType<typeof makeAudit>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    pii = makePii();
    audit = makeAudit();
    logger = makeLogger();
  });

  describe('PII 边界校验', () => {
    it('input L4 > card L1 抛 BadRequestException（7004）', async () => {
      pii.assertBoundary.mockImplementation(() => {
        throw new BadRequestException({ code: 7004, message: 'PII 边界违规' });
      });
      const agent = new TestAgent(
        vi.fn().mockResolvedValue({
          ok: true,
          data: {},
          lawRefs: [],
          disclaimer: 'x',
          verified: true,
          usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
        }),
        makeCard({ piiLevel: 'L1' }),
        pii as never,
        audit as never,
        logger as never,
      );

      await expect(agent.invoke(makeInput({ piiLevel: 'L4' }), makeCtx())).rejects.toThrow(
        BadRequestException,
      );
      // 审计 blocked
      expect(audit.write).toHaveBeenCalledWith(
        'agent_invoke',
        expect.objectContaining({ result: 'blocked', reason: 'pii_boundary_violation' }),
      );
    });

    it('PiiService 未注入时跳过边界校验', async () => {
      const agent = new TestAgent(
        vi.fn().mockResolvedValue({
          ok: true,
          data: {},
          lawRefs: [],
          disclaimer: 'x',
          verified: true,
          usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
        }),
        makeCard({ piiLevel: 'L1' }),
        undefined,
        audit as never,
        logger as never,
      );
      // 不抛错即通过
      const result = await agent.invoke(makeInput({ piiLevel: 'L4' }), makeCtx());
      expect(result.ok).toBe(true);
    });
  });

  describe('成功路径', () => {
    it('usage.durationMs 自动填充', async () => {
      const agent = new TestAgent(
        vi.fn().mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 20));
          return {
            ok: true,
            data: { a: 1 },
            lawRefs: [],
            disclaimer: 'ok',
            verified: true,
            usage: { durationMs: 0, tokensIn: 5, tokensOut: 10 },
          };
        }),
        makeCard(),
        pii as never,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());
      expect(result.ok).toBe(true);
      expect(result.usage.durationMs).toBeGreaterThanOrEqual(15);
      expect(result.usage.tokensIn).toBe(5);
      expect(result.usage.tokensOut).toBe(10);
    });

    it('审计 agent_invoke success', async () => {
      const agent = new TestAgent(
        vi.fn().mockResolvedValue({
          ok: true,
          data: {},
          lawRefs: [],
          disclaimer: 'ok',
          verified: true,
          usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
        }),
        makeCard({ agentId: 'law-lookup' }),
        pii as never,
        audit as never,
        logger as never,
      );

      await agent.invoke(makeInput({ capability: 'law.lookup' }), makeCtx());
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

  describe('免责声明兜底', () => {
    it('output 缺 disclaimer 注入 FALLBACK_DISCLAIMER', async () => {
      const agent = new TestAgent(
        vi.fn().mockResolvedValue({
          ok: true,
          data: {},
          lawRefs: [],
          disclaimer: '',
          verified: true,
          usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
        }),
        makeCard(),
        pii as never,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());
      expect(result.disclaimer).toBe(FALLBACK_DISCLAIMER);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('disclaimer'),
        expect.anything(),
      );
    });

    it('output 有 disclaimer 保留原值', async () => {
      const agent = new TestAgent(
        vi.fn().mockResolvedValue({
          ok: true,
          data: {},
          lawRefs: [],
          disclaimer: 'custom',
          verified: true,
          usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
        }),
        makeCard(),
        pii as never,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());
      expect(result.disclaimer).toBe('custom');
    });
  });

  describe('超时保护', () => {
    it('execute 超时抛 7003 + 审计 degraded', async () => {
      const agent = new TestAgent(
        vi.fn().mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 500)); // 超过 200ms timeout
          return {
            ok: true,
            data: {},
            lawRefs: [],
            disclaimer: 'x',
            verified: true,
            usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
          };
        }),
        makeCard({ timeout: 200 }),
        pii as never,
        audit as never,
        logger as never,
      );

      const err = await agent.invoke(makeInput(), makeCtx()).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('超时');
      // 审计 degraded
      expect(audit.write).toHaveBeenCalledWith(
        'agent_invoke',
        expect.objectContaining({ result: 'degraded' }),
      );
    });

    it('deadline 已过立即超时', async () => {
      const agent = new TestAgent(
        vi.fn().mockResolvedValue({
          ok: true,
          data: {},
          lawRefs: [],
          disclaimer: 'x',
          verified: true,
          usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
        }),
        makeCard({ timeout: 5000 }),
        pii as never,
        audit as never,
        logger as never,
      );

      const err = await agent
        .invoke(makeInput(), makeCtx({ deadline: Date.now() - 100 }))
        .catch((e) => e);
      expect((err as Error).message).toContain('超时');
    });
  });

  describe('execute 抛错', () => {
    it('原样传播错误 + 审计 failed', async () => {
      const agent = new TestAgent(
        vi.fn().mockRejectedValue(new Error('业务逻辑失败')),
        makeCard(),
        pii as never,
        audit as never,
        logger as never,
      );

      await expect(agent.invoke(makeInput(), makeCtx())).rejects.toThrow('业务逻辑失败');
      expect(audit.write).toHaveBeenCalledWith(
        'agent_invoke',
        expect.objectContaining({ result: 'failed', errorMessage: '业务逻辑失败' }),
      );
    });
  });

  describe('resolveTimeout', () => {
    it('deadline 剩余预算 < card.timeout 取较小值', async () => {
      // 通过观察超时时间验证：card.timeout=5000，deadline 剩余 300ms，应在 300ms 超时
      const agent = new TestAgent(
        vi.fn().mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 1000));
          return {
            ok: true,
            data: {},
            lawRefs: [],
            disclaimer: 'x',
            verified: true,
            usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
          };
        }),
        makeCard({ timeout: 5000 }),
        pii as never,
        audit as never,
        logger as never,
      );

      const start = Date.now();
      const err = await agent
        .invoke(makeInput(), makeCtx({ deadline: start + 300 }))
        .catch((e) => e);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(500); // 应在 300ms 左右超时，而非 5000ms
      expect((err as Error).message).toContain('超时');
    });
  });
});
