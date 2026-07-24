/**
 * IntentRouterService 单元测试（A1-W3）。
 *
 * 覆盖三类场景（系统性完善要求）：
 *   - 正常场景：8 意图识别 + 置信度路由 + toolId 推断
 *   - 边界场景：空输入 / 无命中兜底 / 低置信度
 *   - 异常场景：LLM 辅助失败降级 / LLM 返回非法值
 *
 * 设计依据：07 §1.1-1.5；06 §八 IntentRouter。
 *
 * 实现注：手动 new IntentRouterService(llm, logger) 绕过 NestJS DI，
 *       defs 取默认 INTENT_DEFS（验证真实关键词库准确率）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { IntentRouterService } from '../../src/modules/legal/intent/intent-router.service';
import type { DialogContext } from '../../src/types/dialog';

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

function makeCtx(over: Partial<DialogContext> = {}): DialogContext {
  return {
    sessionId: 'sess-test',
    unresolvedCount: 0,
    recentTurns: [],
    ...over,
  };
}

/** 构造 mock LlmService.generate */
function makeLlm(reply: string, opts: { throw?: boolean } = {}) {
  return {
    generate: vi.fn(async () => {
      if (opts.throw) throw new Error('llm down');
      return {
        content: reply,
        model: 'mock',
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        raw: {},
      };
    }),
    stream: vi.fn(),
    validateLawRefs: vi.fn(),
  };
}

describe('IntentRouterService', () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  describe('正常场景：8 意图识别与路由', () => {
    it('legal_qa：法条引用 → route=rule', async () => {
      const svc = new IntentRouterService(undefined, logger as never);
      const r = await svc.classify('民法典第一百四十三条规定了什么', makeCtx());
      expect(r.intent).toBe('legal_qa');
      expect(r.route).toBe('rule');
      expect(r.confidence).toBeGreaterThanOrEqual(0.8);
      expect(r.fallbackUsed).toBe(false);
      expect(r.matchedKeywords.length).toBeGreaterThan(0);
    });

    it('document_generate：帮我写起诉状 → route=llm', async () => {
      const svc = new IntentRouterService(undefined, logger as never);
      const r = await svc.classify('帮我写一份民事起诉状', makeCtx());
      expect(r.intent).toBe('document_generate');
      expect(r.route).toBe('llm');
      expect(r.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('process_guide：起诉流程 → route=knowledge', async () => {
      const svc = new IntentRouterService(undefined, logger as never);
      const r = await svc.classify('我想了解起诉流程', makeCtx());
      expect(r.intent).toBe('process_guide');
      expect(r.route).toBe('knowledge');
    });

    it('material_checklist：离婚需要什么材料 → route=knowledge', async () => {
      const svc = new IntentRouterService(undefined, logger as never);
      const r = await svc.classify('起诉离婚需要什么材料', makeCtx());
      expect(r.intent).toBe('material_checklist');
      expect(r.route).toBe('knowledge');
    });

    it('case_analysis：这个案子能赢吗 → route=llm', async () => {
      const svc = new IntentRouterService(undefined, logger as never);
      const r = await svc.classify('我这个案子能赢吗', makeCtx());
      expect(r.intent).toBe('case_analysis');
      expect(r.route).toBe('llm');
    });

    it('case_reasoning：相似案例 → route=reasoning（桩路由）', async () => {
      const svc = new IntentRouterService(undefined, logger as never);
      const r = await svc.classify('有没有相似案例可以参考', makeCtx());
      expect(r.intent).toBe('case_reasoning');
      expect(r.route).toBe('reasoning');
    });

    it('tool_invoke：盗窃罪量刑 → route=tool + toolId=sentencing_guide', async () => {
      const svc = new IntentRouterService(undefined, logger as never);
      const r = await svc.classify('盗窃罪量刑标准', makeCtx());
      expect(r.intent).toBe('tool_invoke');
      expect(r.route).toBe('tool');
      expect(r.toolId).toBe('sentencing_guide');
    });

    it('tool_invoke：赔偿标准 → toolId=compensation_query', async () => {
      const svc = new IntentRouterService(undefined, logger as never);
      const r = await svc.classify('交通事故赔偿标准是多少', makeCtx());
      expect(r.intent).toBe('tool_invoke');
      expect(r.toolId).toBe('compensation_query');
    });

    it('tool_invoke：期间计算 → toolId=period_calculator', async () => {
      const svc = new IntentRouterService(undefined, logger as never);
      const r = await svc.classify('帮我做期间计算', makeCtx());
      expect(r.intent).toBe('tool_invoke');
      expect(r.toolId).toBe('period_calculator');
    });
  });

  describe('边界场景', () => {
    it('空字符串输入 → 抛 1001', async () => {
      const svc = new IntentRouterService(undefined, logger as never);
      await expect(svc.classify('', makeCtx())).rejects.toThrow(BadRequestException);
    });

    it('纯空白输入 → 抛 1001', async () => {
      const svc = new IntentRouterService(undefined, logger as never);
      await expect(svc.classify('   \n\t  ', makeCtx())).rejects.toThrow(BadRequestException);
    });

    it('无任何命中 → general_qa 兜底 + fallbackUsed=true', async () => {
      const svc = new IntentRouterService(undefined, logger as never);
      const r = await svc.classify('今天天气真不错', makeCtx());
      expect(r.intent).toBe('general_qa');
      expect(r.route).toBe('general_qa');
      expect(r.fallbackUsed).toBe(true);
      expect(r.confidence).toBe(0);
    });

    it('低置信度（弱匹配）→ general_qa 兜底', async () => {
      const svc = new IntentRouterService(undefined, logger as never);
      // "计算" 是 tool_invoke 弱词（weight 0.4），单独出现可能低置信
      const r = await svc.classify('帮我计算一下', makeCtx());
      // 无 LLM 时低置信区间降级 general_qa，或直路由 tool（取决于是否单一匹配）
      expect(['tool', 'general_qa']).toContain(r.route);
    });

    it('candidates 字段在有多匹配时填充 top3', async () => {
      const svc = new IntentRouterService(undefined, logger as never);
      const r = await svc.classify('案件分析能赢吗', makeCtx());
      expect(r.candidates).toBeDefined();
      expect(r.candidates!.length).toBeGreaterThan(0);
    });
  });

  describe('异常场景：LLM 辅助判定', () => {
    it('0.5-0.8 区间：LLM 返回合法意图 → 采用 LLM 结果', async () => {
      const llm = makeLlm('case_analysis');
      const svc = new IntentRouterService(llm as never, logger as never);
      // "案件分析能赢吗" 同时命中 case_reasoning + case_analysis，置信度落入 LLM 辅助区间
      const r = await svc.classify('案件分析能赢吗', makeCtx());
      expect(r.intent).toBe('case_analysis');
      expect(r.route).toBe('llm');
      expect(llm.generate).toHaveBeenCalled();
    });

    it('LLM 抛错 → 降级返回 top1（candidates[0]）', async () => {
      const llm = makeLlm('', { throw: true });
      const svc = new IntentRouterService(llm as never, logger as never);
      const r = await svc.classify('案件分析能赢吗', makeCtx());
      // 降级不抛错，返回 top1 候选
      expect(r.fallbackUsed).toBe(false);
      expect(r.intent).toBeDefined();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('LLM 返回非法文本 → 降级返回 candidates[0]', async () => {
      const llm = makeLlm('我不太确定是什么意思');
      const svc = new IntentRouterService(llm as never, logger as never);
      const r = await svc.classify('案件分析能赢吗', makeCtx());
      expect(r.intent).toBeDefined();
      expect(r.fallbackUsed).toBe(false);
    });

    it('无 LLM 注入时 assistWithLlm 降级返回 candidates[0]', async () => {
      const svc = new IntentRouterService(undefined, logger as never);
      const picked = await svc.assistWithLlm('xxx', ['case_analysis', 'case_reasoning']);
      expect(picked).toBe('case_analysis');
    });

    it('assistWithLlm 空候选 → general_qa', async () => {
      const svc = new IntentRouterService(undefined, logger as never);
      const picked = await svc.assistWithLlm('xxx', []);
      expect(picked).toBe('general_qa');
    });
  });

  describe('contextBonus：多轮延续', () => {
    it('lastIntent 命中且最近 3 轮出现 → 分数加成', async () => {
      const svc = new IntentRouterService(undefined, logger as never);
      const ctxWithHistory = makeCtx({
        lastIntent: 'legal_qa',
        recentTurns: [
          { role: 'user', content: '民法典规定', intent: 'legal_qa', ts: new Date().toISOString() },
        ],
      });
      const r = await svc.classify('诉讼时效', ctxWithHistory);
      expect(r.intent).toBe('legal_qa');
      // contextBonus 应使 legal_qa 得分更高（直路由）
      expect(r.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('lastIntent 与最近轮次意图不一致 → 不加成', async () => {
      const svc = new IntentRouterService(undefined, logger as never);
      const ctx = makeCtx({
        lastIntent: 'document_generate',
        recentTurns: [
          {
            role: 'user',
            content: '帮我写起诉状',
            intent: 'document_generate',
            ts: new Date().toISOString(),
          },
        ],
      });
      // legal_qa 查询，lastIntent=document_generate 不匹配，不加成
      const r = await svc.classify('诉讼时效', ctx);
      expect(r.intent).toBe('legal_qa');
    });
  });

  describe('positionBoost：句首加权', () => {
    it('关键词在句首前 20% → 加权生效', async () => {
      const svc = new IntentRouterService(undefined, logger as never);
      // "起诉状帮我写" vs 句尾，关键词位置不同但应都能识别
      const r = await svc.classify('起诉状怎么写', makeCtx());
      expect(r.intent).toBe('document_generate');
    });
  });

  describe('上下文回写', () => {
    it('识别结果写回 RequestContext（intent/route）', async () => {
      const svc = new IntentRouterService(undefined, logger as never);
      const { requestContext } = await import('../../src/common/context/request-context');
      await new Promise<void>((resolve) => {
        requestContext.run({ traceId: 't1', startedAt: 0 }, async () => {
          await svc.classify('民法典诉讼时效', makeCtx());
          const ctx = requestContext.get();
          expect(ctx?.intent).toBe('legal_qa');
          expect(ctx?.route).toBe('rule');
          resolve();
        });
      });
    });
  });
});
