/**
 * OrchestratorService 单元测试（A1-W4）。
 *
 * 覆盖三类场景：
 *   - 正常场景：规则命中 / 规则未命中落 LLM / tool 占位 / general_qa 落 LLM
 *   - 边界场景：LLM 不可用降级 / LLM 空回复兜底
 *   - 异常场景：LLM 流式失败降级人工引导
 *
 * 实现注：手动 new OrchestratorService(...mocks) 绕过 DI，mock 各依赖。
 *       orchestrate 为 async generator，收集所有帧断言序列。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrchestratorService } from '../../src/modules/legal/orchestrator/orchestrator.service';
import type { IntentResult } from '../../src/types/intent';
import type { DialogContext } from '../../src/types/dialog';
import type { LlmService, LlmChunk, LawRefCheckResult } from '../../src/types/llm';
import { requestContext } from '../../src/common/context/request-context';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    log: vi.fn(),
  };
}

function makeAudit() {
  return { write: vi.fn(), writeSync: vi.fn() };
}

function makeIntentRouter(result: Partial<IntentResult> = {}) {
  const full: IntentResult = {
    intent: 'legal_qa',
    confidence: 0.9,
    route: 'rule',
    fallbackUsed: false,
    matchedKeywords: ['民法典'],
    matchedPatterns: [],
    ...result,
  };
  return { classify: vi.fn().mockResolvedValue(full) };
}

function makeRuleEngine(
  ruleResult: {
    answer: string;
    lawRefs: unknown[];
    source: 'law_article' | 'faq';
    matchedKey: string;
  } | null,
) {
  return { query: vi.fn().mockResolvedValue(ruleResult) };
}

function makeMemory() {
  return {
    appendDialog: vi.fn().mockResolvedValue(undefined),
    getRelevantMemories: vi.fn().mockResolvedValue([]),
  };
}

/** 构造 mock LlmService：stream 按给定 deltas 产出，validateLawRefs 返回空 */
function makeLlm(deltas: string[], opts?: { fail?: boolean; usage?: LlmChunk['usage'] }) {
  const stream = async function* (): AsyncIterable<LlmChunk> {
    if (opts?.fail) throw new Error('llm stream boom');
    for (const d of deltas) {
      yield { delta: d, done: false };
    }
    yield { delta: '', done: true, usage: opts?.usage };
  };
  const lawCheck: LawRefCheckResult = { verified: [], unverified: [], sanitizedText: '' };
  return {
    generate: vi.fn(),
    stream: vi.fn().mockImplementation(stream),
    validateLawRefs: vi.fn().mockResolvedValue(lawCheck),
  };
}

function makeCtx(): DialogContext {
  return { sessionId: 'sess-1', userId: 'u1', unresolvedCount: 0, recentTurns: [] };
}

/** 在 requestContext 内运行编排并收集所有帧 */
async function collectFrames(svc: OrchestratorService, input: string): Promise<unknown[]> {
  const frames: unknown[] = [];
  await new Promise<void>((resolve) => {
    requestContext.run({ traceId: 'trace-1', userId: 'u1', startedAt: 0 }, async () => {
      for await (const f of svc.orchestrate(input, makeCtx(), 'u1')) {
        frames.push(f);
      }
      resolve();
    });
  });
  return frames;
}

describe('OrchestratorService', () => {
  let logger: ReturnType<typeof makeLogger>;
  let audit: ReturnType<typeof makeAudit>;

  beforeEach(() => {
    logger = makeLogger();
    audit = makeAudit();
  });

  describe('正常场景：规则层命中', () => {
    it('route=rule 且 RuleEngine 命中 → chunk(answer)+meta(rule)+disclaimer+done', async () => {
      const svc = new OrchestratorService(
        makeIntentRouter({ intent: 'legal_qa', route: 'rule', confidence: 0.95 }) as never,
        makeRuleEngine({
          answer: '《民法典》第一百四十三条\n民事法律行为有效',
          lawRefs: [{ ref: '民法典#143', verified: true }],
          source: 'law_article',
          matchedKey: '民法典#143',
        }) as never,
        makeMemory() as never,
        undefined,
        audit as never,
        logger as never,
      );
      const frames = await collectFrames(svc, '民法典第一百四十三条');
      const types = frames.map((f) => (f as { type: string }).type);
      expect(types).toEqual(['chunk', 'meta', 'disclaimer', 'done']);
      const meta = frames[1] as { source: string; lawRefs: unknown[] };
      expect(meta.source).toBe('rule');
      expect(meta.lawRefs).toHaveLength(1);
      const chunk = frames[0] as { delta: string };
      expect(chunk.delta).toContain('民事法律行为有效');
    });

    it('规则层命中 FAQ → source=faq', async () => {
      const svc = new OrchestratorService(
        makeIntentRouter({ intent: 'legal_qa', route: 'rule', confidence: 0.95 }) as never,
        makeRuleEngine({
          answer: '我是法律智能助手',
          lawRefs: [],
          source: 'faq',
          matchedKey: '问候',
        }) as never,
        makeMemory() as never,
        undefined,
        audit as never,
        logger as never,
      );
      const frames = await collectFrames(svc, '你是谁');
      const meta = frames[1] as { source: string };
      expect(meta.source).toBe('faq');
    });
  });

  describe('正常场景：规则未命中落 LLM', () => {
    it('route=rule 规则未命中 → LLM 流式 chunk* + meta(llm) + disclaimer + done', async () => {
      const llm = makeLlm(['你好', '世界']);
      const svc = new OrchestratorService(
        makeIntentRouter({ intent: 'legal_qa', route: 'rule', confidence: 0.95 }) as never,
        makeRuleEngine(null) as never,
        makeMemory() as never,
        llm as unknown as LlmService,
        audit as never,
        logger as never,
      );
      const frames = await collectFrames(svc, '某个法律问题');
      const types = frames.map((f) => (f as { type: string }).type);
      // 两个 chunk + meta + disclaimer + done
      expect(types).toEqual(['chunk', 'chunk', 'meta', 'disclaimer', 'done']);
      const meta = frames[2] as { source: string; usage?: unknown };
      expect(meta.source).toBe('llm');
    });

    it('route=general_qa → 直接 LLM 流式', async () => {
      const llm = makeLlm(['通用', '回复']);
      const svc = new OrchestratorService(
        makeIntentRouter({
          intent: 'general_qa',
          route: 'general_qa',
          confidence: 0.3,
          fallbackUsed: true,
        }) as never,
        makeRuleEngine(null) as never,
        makeMemory() as never,
        llm as unknown as LlmService,
        audit as never,
        logger as never,
      );
      const frames = await collectFrames(svc, '你好');
      const meta = frames.find((f) => (f as { type: string }).type === 'meta') as {
        source: string;
      };
      expect(meta.source).toBe('llm');
    });
  });

  describe('正常场景：tool 占位', () => {
    it('route=tool → chunk(占位)+meta(tool)+disclaimer+done', async () => {
      const svc = new OrchestratorService(
        makeIntentRouter({
          intent: 'tool_invoke',
          route: 'tool',
          confidence: 0.95,
          toolId: 'period_calculator',
        }) as never,
        makeRuleEngine(null) as never,
        makeMemory() as never,
        undefined,
        audit as never,
        logger as never,
      );
      const frames = await collectFrames(svc, '期间计算');
      const chunk = frames[0] as { delta: string };
      expect(chunk.delta).toContain('period_calculator');
      const meta = frames[1] as { source: string };
      expect(meta.source).toBe('tool');
    });
  });

  describe('边界场景：LLM 不可用降级', () => {
    it('无 LLM 注入 → 人工引导 + meta(guide, fallbackUsed=true) + audit degradation', async () => {
      const svc = new OrchestratorService(
        makeIntentRouter({ intent: 'legal_qa', route: 'rule', confidence: 0.95 }) as never,
        makeRuleEngine(null) as never,
        makeMemory() as never,
        undefined, // 无 LLM
        audit as never,
        logger as never,
      );
      const frames = await collectFrames(svc, '法律问题');
      const chunk = frames[0] as { delta: string };
      expect(chunk.delta).toContain('稍后重试');
      const meta = frames[1] as { source: string; fallbackUsed: boolean };
      expect(meta.source).toBe('guide');
      expect(meta.fallbackUsed).toBe(true);
      expect(audit.write).toHaveBeenCalledWith(
        'degradation',
        expect.objectContaining({ reason: 'llm_unavailable' }),
      );
    });

    it('LLM 空回复 → 兜底人工引导文案', async () => {
      const llm = makeLlm(['', '']); // 全空 delta
      const svc = new OrchestratorService(
        makeIntentRouter({ intent: 'general_qa', route: 'general_qa', confidence: 0.3 }) as never,
        makeRuleEngine(null) as never,
        makeMemory() as never,
        llm as unknown as LlmService,
        audit as never,
        logger as never,
      );
      const frames = await collectFrames(svc, '你好');
      // 空回复触发兜底 chunk
      const chunks = frames.filter((f) => (f as { type: string }).type === 'chunk');
      const allDelta = chunks.map((c) => (c as { delta: string }).delta).join('');
      expect(allDelta).toContain('稍后重试');
    });
  });

  describe('异常场景：LLM 流式失败降级', () => {
    it('llm.stream 抛错 → 降级人工引导 + audit degradation + 不抛出', async () => {
      const llm = makeLlm([], { fail: true });
      const svc = new OrchestratorService(
        makeIntentRouter({ intent: 'legal_qa', route: 'rule', confidence: 0.95 }) as never,
        makeRuleEngine(null) as never,
        makeMemory() as never,
        llm as unknown as LlmService,
        audit as never,
        logger as never,
      );
      const frames = await collectFrames(svc, '法律问题');
      const meta = frames.find((f) => (f as { type: string }).type === 'meta') as {
        source: string;
        fallbackUsed: boolean;
      };
      expect(meta.source).toBe('guide');
      expect(meta.fallbackUsed).toBe(true);
      expect(audit.write).toHaveBeenCalledWith(
        'degradation',
        expect.objectContaining({ reason: 'llm_stream_failed' }),
      );
      // 以 done 帧收尾
      const done = frames[frames.length - 1] as { type: string };
      expect(done.type).toBe('done');
    });
  });

  describe('帧序列合规', () => {
    it('所有路径均以 disclaimer + done 收尾（免责声明 100% 附加）', async () => {
      const llm = makeLlm(['ok']);
      const svc = new OrchestratorService(
        makeIntentRouter({ intent: 'legal_qa', route: 'rule', confidence: 0.95 }) as never,
        makeRuleEngine(null) as never,
        makeMemory() as never,
        llm as unknown as LlmService,
        audit as never,
        logger as never,
      );
      const frames = await collectFrames(svc, '问题');
      const lastTwo = frames.slice(-2).map((f) => (f as { type: string }).type);
      expect(lastTwo).toEqual(['disclaimer', 'done']);
    });
  });
});
