/**
 * IracReasonerService 单元测试（v2.3-W5，16 §2）。
 *
 * 覆盖 IRAC 四步推理 + 降级链路：
 *   - Issue：LLM 解析 / relatedLaws 核实 / issueType 归一化 / 空 issues 降级
 *   - Rule：RagService 召回 / 时效校验（repealed 过滤）/ CitationGraph 扩展失败降级
 *   - Application：编排 LawApplicationDeterminer / 跳过 Application 步
 *   - Conclusion：置信度归一化 / riskLevel 推断 / 免责声明强制 / lawRefs 聚合
 *   - 持久化：reasoning_chain 写入成功 / 写入失败不阻塞
 *   - 降级：LLM 全失败 / 仅 Application 失败 / 无争议点空结果
 *
 * 设计依据：16 §2 IRAC 推理框架；16 §7 降级策略。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IracReasonerService } from '../../src/modules/legal/reasoning/irac-reasoner.service';
import {
  IRAC_DISCLAIMER_SUFFIX,
  IRAC_PROMPT_VERSION,
} from '../../src/modules/legal/reasoning/reasoning.types';
import type { Entity } from '../../src/modules/legal/nlu/nlu.types';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
}

/** 构造 mock LlmService，generate 按序返回指定响应 */
function makeLlmSequence(
  responses: Array<{ content: string; usage?: { promptTokens: number; completionTokens: number } }>,
) {
  let idx = 0;
  return {
    generate: vi.fn().mockImplementation(() => {
      const r = responses[Math.min(idx, responses.length - 1)];
      idx++;
      return Promise.resolve({
        content: r.content,
        model: 'qwen-v1',
        finishReason: 'stop',
        usage: r.usage ?? { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        raw: {},
      });
    }),
    stream: vi.fn(),
    validateLawRefs: vi.fn(),
  };
}

function makeRag(
  results: Array<{
    id: string;
    content: string;
    title?: string;
    meta?: Record<string, unknown>;
  }> = [],
) {
  return {
    retrieve: vi.fn().mockResolvedValue(results),
  };
}

function makeChainModel() {
  return {
    create: vi.fn().mockResolvedValue({}),
  };
}

function makeLawApplicationDeterminer() {
  return {
    determine: vi.fn().mockResolvedValue({
      factMatch: 'applicable' as const,
      matchedFacts: ['要件1'],
      unmatchedFacts: [],
      warnings: [],
    }),
  };
}

function makeEntities(): Entity[] {
  return [
    { type: 'case_cause', value: '租赁合同纠纷', span: [0, 6], confidence: 0.9, source: 'dict' },
    { type: 'amount', value: '5万元', span: [10, 13], confidence: 0.95, source: 'regex' },
  ];
}

function makeCtx() {
  return {
    userId: 'user-1',
    msgId: 'msg-001',
    traceId: 'trace-001',
  };
}

describe('v2.3-W5 IracReasonerService（IRAC 四步推理编排）', () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  describe('Issue 争议点识别（16 §2.1）', () => {
    it('LLM 返回有效 issues → 解析 + 后处理', async () => {
      const llm = makeLlmSequence([
        {
          // Issue 步
          content: JSON.stringify({
            issues: [
              {
                issueText: '租赁合同效力争议',
                issueType: 'contract_dispute',
                relatedLaws: ['art-001'],
              },
            ],
          }),
        },
        {
          // Conclusion 步
          content: JSON.stringify({
            summary: '租赁合同有效',
            confidence: 0.85,
            riskLevel: 'low',
            lawRefs: ['art-001'],
          }),
        },
      ]);
      const rag = makeRag([{ id: 'art-001', content: '法条内容', meta: { status: 'effective' } }]);
      const determiner = makeLawApplicationDeterminer();
      const svc = new IracReasonerService(
        llm as never,
        rag as never,
        determiner as never,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '原告与被告签订租赁合同后产生纠纷',
        question: '合同是否有效',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(result.issues.length).toBe(1);
      expect(result.issues[0].issueText).toBe('租赁合同效力争议');
      expect(result.issues[0].issueType).toBe('contract_dispute');
      expect(result.issues[0].relatedLaws).toContain('art-001');
    });

    it('relatedLaws 不存在 → 移除 + warning', async () => {
      const llm = makeLlmSequence([
        {
          content: JSON.stringify({
            issues: [
              {
                issueText: '争议',
                issueType: 'contract_dispute',
                relatedLaws: ['nonexistent-law'],
              },
            ],
          }),
        },
        {
          content: JSON.stringify({
            summary: '结论',
            confidence: 0.5,
            riskLevel: 'medium',
            lawRefs: [],
          }),
        },
      ]);
      // RagService 召回为空 → relatedLaws 不存在
      const rag = makeRag([]);
      const determiner = makeLawApplicationDeterminer();
      const svc = new IracReasonerService(
        llm as never,
        rag as never,
        determiner as never,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '原告与被告争议',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      // relatedLaws 不存在 → 移除（verifyArticleId 返回 false）
      expect(result.issues[0].relatedLaws).toEqual([]);
      expect(result.warnings.some((w) => w.includes('不存在，已移除'))).toBe(true);
    });

    it('issueType 归一化：中文"合同" → contract_dispute', async () => {
      const llm = makeLlmSequence([
        {
          content: JSON.stringify({
            issues: [{ issueText: '争议', issueType: '合同纠纷', relatedLaws: [] }],
          }),
        },
        {
          content: JSON.stringify({
            summary: '结论',
            confidence: 0.5,
            riskLevel: 'medium',
            lawRefs: [],
          }),
        },
      ]);
      const svc = new IracReasonerService(
        llm as never,
        undefined,
        undefined,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '合同争议',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(result.issues[0].issueType).toBe('contract_dispute');
    });

    it('LLM 返回空 issues → 关键词降级匹配', async () => {
      const llm = makeLlmSequence([
        {
          // 空 issues
          content: JSON.stringify({ issues: [] }),
        },
        {
          // Conclusion
          content: JSON.stringify({
            summary: '结论',
            confidence: 0.5,
            riskLevel: 'medium',
            lawRefs: [],
          }),
        },
      ]);
      const svc = new IracReasonerService(
        llm as never,
        undefined,
        undefined,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '本案涉及违约，原告要求赔偿',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      // 关键词"违约"映射到 contract_dispute
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.some((i) => i.issueType === 'contract_dispute')).toBe(true);
    });

    it('LLM 返回空 issues + 无关键词 → 兜底"待识别争议点"', async () => {
      const llm = makeLlmSequence([
        { content: JSON.stringify({ issues: [] }) },
        {
          content: JSON.stringify({
            summary: '结论',
            confidence: 0.5,
            riskLevel: 'medium',
            lawRefs: [],
          }),
        },
      ]);
      const svc = new IracReasonerService(
        llm as never,
        undefined,
        undefined,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '某段无关键词的描述',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(result.issues.length).toBe(1);
      expect(result.issues[0].issueText).toBe('待识别争议点');
      expect(result.issues[0].issueType).toBe('other');
    });
  });

  describe('Rule 法条规则抽取（16 §2.2）', () => {
    it('RagService 召回法条 → 加入 rules', async () => {
      const llm = makeLlmSequence([
        {
          content: JSON.stringify({
            issues: [{ issueText: '租赁争议', issueType: 'contract_dispute', relatedLaws: [] }],
          }),
        },
        {
          content: JSON.stringify({
            summary: '结论',
            confidence: 0.7,
            riskLevel: 'low',
            lawRefs: ['art-001'],
          }),
        },
      ]);
      const rag = makeRag([
        { id: 'art-001', content: '法条1', meta: { status: 'effective' } },
        { id: 'art-002', content: '法条2', meta: { status: 'effective' } },
      ]);
      const svc = new IracReasonerService(
        llm as never,
        rag as never,
        undefined,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '租赁争议',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(result.rules.length).toBe(2);
      expect(result.rules.map((r) => r.articleId).sort()).toEqual(['art-001', 'art-002']);
    });

    it('法条 status=repealed → 过滤 + warning', async () => {
      const llm = makeLlmSequence([
        {
          content: JSON.stringify({
            issues: [{ issueText: '争议', issueType: 'contract_dispute', relatedLaws: [] }],
          }),
        },
        {
          content: JSON.stringify({
            summary: '结论',
            confidence: 0.5,
            riskLevel: 'medium',
            lawRefs: [],
          }),
        },
      ]);
      const rag = makeRag([
        { id: 'art-old', content: '已废止法条', meta: { status: 'repealed' } },
        { id: 'art-new', content: '有效法条', meta: { status: 'effective' } },
      ]);
      const svc = new IracReasonerService(
        llm as never,
        rag as never,
        undefined,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '争议',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(result.rules.length).toBe(1);
      expect(result.rules[0].articleId).toBe('art-new');
      expect(result.warnings.some((w) => w.includes('已废止'))).toBe(true);
    });

    it('RagService 召回失败 → warning + rules 为空', async () => {
      const llm = makeLlmSequence([
        {
          content: JSON.stringify({
            issues: [{ issueText: '争议', issueType: 'contract_dispute', relatedLaws: [] }],
          }),
        },
        {
          content: JSON.stringify({
            summary: '结论',
            confidence: 0.3,
            riskLevel: 'high',
            lawRefs: [],
          }),
        },
      ]);
      const rag = {
        retrieve: vi.fn().mockRejectedValue(new Error('RagService 不可用')),
      };
      const svc = new IracReasonerService(
        llm as never,
        rag as never,
        undefined,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '争议',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(result.rules).toEqual([]);
      expect(result.warnings.some((w) => w.includes('RagService 召回法条失败'))).toBe(true);
    });

    it('同一法条被多个 issue 召回 → 去重', async () => {
      const llm = makeLlmSequence([
        {
          content: JSON.stringify({
            issues: [
              { issueText: '争议1', issueType: 'contract_dispute', relatedLaws: [] },
              { issueText: '争议2', issueType: 'tort', relatedLaws: [] },
            ],
          }),
        },
        {
          content: JSON.stringify({
            summary: '结论',
            confidence: 0.5,
            riskLevel: 'medium',
            lawRefs: [],
          }),
        },
      ]);
      // 两次召回都返回相同的法条
      const rag = {
        retrieve: vi
          .fn()
          .mockResolvedValue([{ id: 'art-001', content: '法条1', meta: { status: 'effective' } }]),
      };
      const svc = new IracReasonerService(
        llm as never,
        rag as never,
        undefined,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '争议',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(result.rules.length).toBe(1);
    });
  });

  describe('Application 事实映射（16 §2.3）', () => {
    it('rules 非空 + LawApplicationDeterminer 注入 → 调用 determine', async () => {
      const llm = makeLlmSequence([
        {
          content: JSON.stringify({
            issues: [{ issueText: '争议', issueType: 'contract_dispute', relatedLaws: [] }],
          }),
        },
        {
          content: JSON.stringify({
            summary: '结论',
            confidence: 0.8,
            riskLevel: 'low',
            lawRefs: ['art-001'],
          }),
        },
      ]);
      const rag = makeRag([{ id: 'art-001', content: '法条1' }]);
      const determiner = makeLawApplicationDeterminer();
      const svc = new IracReasonerService(
        llm as never,
        rag as never,
        determiner as never,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '争议',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(determiner.determine).toHaveBeenCalledTimes(1);
      expect(result.applications.length).toBe(1);
      expect(result.applications[0].ruleId).toBe('art-001');
      expect(result.applications[0].factMatch).toBe('applicable');
    });

    it('rules 为空 → 跳过 Application + warning', async () => {
      const llm = makeLlmSequence([
        {
          content: JSON.stringify({
            issues: [{ issueText: '争议', issueType: 'contract_dispute', relatedLaws: [] }],
          }),
        },
        {
          content: JSON.stringify({
            summary: '结论',
            confidence: 0.3,
            riskLevel: 'high',
            lawRefs: [],
          }),
        },
      ]);
      // RagService 召回为空 → rules 为空
      const rag = makeRag([]);
      const determiner = makeLawApplicationDeterminer();
      const svc = new IracReasonerService(
        llm as never,
        rag as never,
        determiner as never,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '争议',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(determiner.determine).not.toHaveBeenCalled();
      expect(result.applications).toEqual([]);
      expect(result.warnings.some((w) => w.includes('跳过 Application'))).toBe(true);
      expect(result.degraded).toBe('application_skipped');
    });

    it('LawApplicationDeterminer 未注入 → 跳过 Application', async () => {
      const llm = makeLlmSequence([
        {
          content: JSON.stringify({
            issues: [{ issueText: '争议', issueType: 'contract_dispute', relatedLaws: [] }],
          }),
        },
        {
          content: JSON.stringify({
            summary: '结论',
            confidence: 0.3,
            riskLevel: 'high',
            lawRefs: [],
          }),
        },
      ]);
      const rag = makeRag([{ id: 'art-001', content: '法条1' }]);
      const svc = new IracReasonerService(
        llm as never,
        rag as never,
        undefined,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '争议',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(result.applications).toEqual([]);
      expect(result.warnings.some((w) => w.includes('LawApplicationDeterminer 未注入'))).toBe(true);
      expect(result.degraded).toBe('application_skipped');
    });

    it('determine 抛异常 → 该 rule 标记 partial + 继续', async () => {
      const llm = makeLlmSequence([
        {
          content: JSON.stringify({
            issues: [{ issueText: '争议', issueType: 'contract_dispute', relatedLaws: [] }],
          }),
        },
        {
          content: JSON.stringify({
            summary: '结论',
            confidence: 0.5,
            riskLevel: 'medium',
            lawRefs: [],
          }),
        },
      ]);
      const rag = makeRag([{ id: 'art-001', content: '法条1' }]);
      const determiner = {
        determine: vi.fn().mockRejectedValue(new Error('判定失败')),
      };
      const svc = new IracReasonerService(
        llm as never,
        rag as never,
        determiner as never,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '争议',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(result.applications.length).toBe(1);
      expect(result.applications[0].factMatch).toBe('partial');
      expect(result.applications[0].unmatchedFacts).toContain('判定失败');
    });
  });

  describe('Conclusion 综合结论（16 §2.4）', () => {
    it('confidence ∈ [0,1]：LLM 返回 1.5 → clamp 到 1', async () => {
      const llm = makeLlmSequence([
        {
          content: JSON.stringify({
            issues: [{ issueText: '争议', issueType: 'contract_dispute', relatedLaws: [] }],
          }),
        },
        {
          content: JSON.stringify({
            summary: '结论',
            confidence: 1.5, // 越界
            riskLevel: 'low',
            lawRefs: [],
          }),
        },
      ]);
      // 提供 RagService + LawApplicationDeterminer，使 rules 非空 + applicationSkipped=false（不被强制降至 0.3）
      const rag = makeRag([{ id: 'art-001', content: '法条1' }]);
      const determiner = makeLawApplicationDeterminer();
      const svc = new IracReasonerService(
        llm as never,
        rag as never,
        determiner as never,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '争议',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(result.conclusion.confidence).toBe(1);
    });

    it('riskLevel 推断：confidence ≥ 0.8 → low', async () => {
      const llm = makeLlmSequence([
        {
          content: JSON.stringify({
            issues: [{ issueText: '争议', issueType: 'contract_dispute', relatedLaws: [] }],
          }),
        },
        {
          content: JSON.stringify({
            summary: '结论',
            confidence: 0.9,
            // riskLevel 缺失 → 由 inferRiskLevel 推断
          }),
        },
      ]);
      // 提供 RagService + LawApplicationDeterminer，使 rules 非空 + applicationSkipped=false
      const rag = makeRag([{ id: 'art-001', content: '法条1' }]);
      const determiner = makeLawApplicationDeterminer();
      const svc = new IracReasonerService(
        llm as never,
        rag as never,
        determiner as never,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '争议',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(result.conclusion.riskLevel).toBe('low');
    });

    it('免责声明强制附加（IRAC_DISCLAIMER_SUFFIX）', async () => {
      const llm = makeLlmSequence([
        {
          content: JSON.stringify({
            issues: [{ issueText: '争议', issueType: 'contract_dispute', relatedLaws: [] }],
          }),
        },
        {
          content: JSON.stringify({
            summary: '结论',
            confidence: 0.5,
            riskLevel: 'medium',
            lawRefs: [],
          }),
        },
      ]);
      const svc = new IracReasonerService(
        llm as never,
        undefined,
        undefined,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '争议',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(result.conclusion.disclaimer).toBe(IRAC_DISCLAIMER_SUFFIX);
    });

    it('lawRefs 聚合：applications applicable/partial 的 ruleId + LLM 输出', async () => {
      const llm = makeLlmSequence([
        {
          content: JSON.stringify({
            issues: [{ issueText: '争议', issueType: 'contract_dispute', relatedLaws: [] }],
          }),
        },
        {
          content: JSON.stringify({
            summary: '结论',
            confidence: 0.8,
            riskLevel: 'low',
            lawRefs: ['llm-law-1'],
          }),
        },
      ]);
      const rag = makeRag([{ id: 'art-001', content: '法条1' }]);
      const determiner = makeLawApplicationDeterminer(); // 返回 applicable
      const svc = new IracReasonerService(
        llm as never,
        rag as never,
        determiner as never,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '争议',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      // art-001 来自 applications 聚合，llm-law-1 来自 LLM 输出
      expect(result.conclusion.lawRefs).toContain('art-001');
      expect(result.conclusion.lawRefs).toContain('llm-law-1');
    });

    it('Application 跳过时 confidence 强制降至 0.3', async () => {
      const llm = makeLlmSequence([
        {
          content: JSON.stringify({
            issues: [{ issueText: '争议', issueType: 'contract_dispute', relatedLaws: [] }],
          }),
        },
        {
          content: JSON.stringify({
            summary: '结论',
            confidence: 0.9, // LLM 返回 0.9，但 Application 跳过 → 强制降至 0.3
            riskLevel: 'low',
            lawRefs: [],
          }),
        },
      ]);
      // RagService 召回为空 → rules 空 → Application 跳过
      const rag = makeRag([]);
      const svc = new IracReasonerService(
        llm as never,
        rag as never,
        undefined,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '争议',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(result.conclusion.confidence).toBe(0.3);
      expect(result.degraded).toBe('application_skipped');
      expect(result.warnings.some((w) => w.includes('强制降至 0.3'))).toBe(true);
    });
  });

  describe('reasoning_chain 持久化（16 §6）', () => {
    it('chainModel.create 成功 → 返回 chainId', async () => {
      const llm = makeLlmSequence([
        {
          content: JSON.stringify({
            issues: [{ issueText: '争议', issueType: 'contract_dispute', relatedLaws: [] }],
          }),
        },
        {
          content: JSON.stringify({
            summary: '结论',
            confidence: 0.5,
            riskLevel: 'medium',
            lawRefs: [],
          }),
        },
      ]);
      const chainModel = makeChainModel();
      const svc = new IracReasonerService(
        llm as never,
        undefined,
        undefined,
        undefined,
        undefined,
        chainModel as never,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '争议',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(chainModel.create).toHaveBeenCalledTimes(1);
      expect(result.reasoningChainId).toMatch(/^rc_/);
    });

    it('chainModel.create 抛异常 → reasoningChainId=undefined + warning', async () => {
      const llm = makeLlmSequence([
        {
          content: JSON.stringify({
            issues: [{ issueText: '争议', issueType: 'contract_dispute', relatedLaws: [] }],
          }),
        },
        {
          content: JSON.stringify({
            summary: '结论',
            confidence: 0.5,
            riskLevel: 'medium',
            lawRefs: [],
          }),
        },
      ]);
      const chainModel = {
        create: vi.fn().mockRejectedValue(new Error('DB 不可用')),
      };
      const svc = new IracReasonerService(
        llm as never,
        undefined,
        undefined,
        undefined,
        chainModel as never,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '争议',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(result.reasoningChainId).toBeUndefined();
      expect(result.warnings.some((w) => w.includes('reasoning_chain 写入失败'))).toBe(true);
    });

    it('chainModel 未注入 → 跳过持久化 + reasoningChainId=undefined', async () => {
      const llm = makeLlmSequence([
        {
          content: JSON.stringify({
            issues: [{ issueText: '争议', issueType: 'contract_dispute', relatedLaws: [] }],
          }),
        },
        {
          content: JSON.stringify({
            summary: '结论',
            confidence: 0.5,
            riskLevel: 'medium',
            lawRefs: [],
          }),
        },
      ]);
      const svc = new IracReasonerService(
        llm as never,
        undefined,
        undefined,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '争议',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(result.reasoningChainId).toBeUndefined();
    });
  });

  describe('LLM 全失败降级（16 §7 第 1 条）', () => {
    it('LlmService 未注入 → fallbackNoLlm + degraded=llm_unavailable', async () => {
      const rag = makeRag([{ id: 'art-001', content: '法条1', meta: { status: 'effective' } }]);
      const svc = new IracReasonerService(
        undefined,
        rag as never,
        undefined,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '争议',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(result.degraded).toBe('llm_unavailable');
      expect(result.issues).toEqual([]);
      expect(result.rules.length).toBe(1);
      expect(result.conclusion.confidence).toBe(0.2);
      expect(result.conclusion.riskLevel).toBe('high');
      expect(result.warnings.some((w) => w.includes('LlmService 未注入'))).toBe(true);
    });

    it('fallbackNoLlm：RagService 召回失败 → warnings 含失败信息', async () => {
      const rag = {
        retrieve: vi.fn().mockRejectedValue(new Error('RagService 不可用')),
      };
      const svc = new IracReasonerService(
        undefined,
        rag as never,
        undefined,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '争议',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(result.rules).toEqual([]);
      expect(result.warnings.some((w) => w.includes('RagService 召回失败'))).toBe(true);
    });
  });

  describe('promptVersion 与 modelVersion', () => {
    it('正常推理 → modelVersion=qwen-v1, promptVersion=irac_prompt_v1', async () => {
      const llm = makeLlmSequence([
        {
          content: JSON.stringify({
            issues: [{ issueText: '争议', issueType: 'contract_dispute', relatedLaws: [] }],
          }),
        },
        {
          content: JSON.stringify({
            summary: '结论',
            confidence: 0.5,
            riskLevel: 'medium',
            lawRefs: [],
          }),
        },
      ]);
      const svc = new IracReasonerService(
        llm as never,
        undefined,
        undefined,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '争议',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(result.modelVersion).toBe('qwen-v1');
      expect(result.promptVersion).toBe(IRAC_PROMPT_VERSION);
    });
  });

  describe('JSON 解析容错', () => {
    it('LLM 返回非 JSON 文本 → issues 降级为空 → 关键词匹配', async () => {
      const llm = makeLlmSequence([
        { content: '这不是 JSON' }, // Issue 步返回非 JSON
        {
          content: JSON.stringify({
            summary: '结论',
            confidence: 0.5,
            riskLevel: 'medium',
            lawRefs: [],
          }),
        },
      ]);
      const svc = new IracReasonerService(
        llm as never,
        undefined,
        undefined,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '本案涉及违约',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      // Issue 步 LLM 解析失败 → 空 issues → fallbackIssues 关键词匹配"违约"
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.some((i) => i.issueType === 'contract_dispute')).toBe(true);
    });

    it('LLM 返回带前后说明的 JSON → 正则提取', async () => {
      const llm = makeLlmSequence([
        {
          content: `分析结果：${JSON.stringify({
            issues: [{ issueText: '争议', issueType: 'contract_dispute', relatedLaws: [] }],
          })}，请参考。`,
        },
        {
          content: JSON.stringify({
            summary: '结论',
            confidence: 0.5,
            riskLevel: 'medium',
            lawRefs: [],
          }),
        },
      ]);
      const svc = new IracReasonerService(
        llm as never,
        undefined,
        undefined,
        undefined,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '争议',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(result.issues.length).toBe(1);
    });
  });

  describe('v3.0 律师专业知识融合（expertise injection）', () => {
    /** 构造 mock 律师专业知识服务 */
    function makeExpertiseService() {
      return {
        buildInjectionContext: vi.fn(),
        recordUsage: vi.fn().mockResolvedValue(undefined),
        getById: vi.fn(),
        query: vi.fn(),
      };
    }

    function makeInjectedLlm() {
      return makeLlmSequence([
        {
          content: JSON.stringify({
            issues: [{ issueText: '劳动报酬争议', issueType: 'labor_dispute', relatedLaws: [] }],
          }),
        },
        {
          content: JSON.stringify({
            summary: '结论',
            confidence: 0.6,
            riskLevel: 'medium',
            lawRefs: [],
          }),
        },
      ]);
    }

    /** 四个步骤都命中专业知识 */
    function makeFullExpertiseService() {
      const svc = makeExpertiseService();
      svc.buildInjectionContext.mockImplementation(async (step: string) => ({
        injectedExpertise: [
          {
            expertiseId: `le_${step}`,
            title: `律师${step}经验`,
            expertiseType: 'case_analysis',
          },
        ],
        injectionPrompt: `【${step}】律师专业经验注入`,
      }));
      return svc;
    }

    /** 提供 RagService 召回法条，保证 Application 步骤可执行 */
    function makeRagWithLaw() {
      return makeRag([{ id: 'art-001', content: '法条内容', meta: { status: 'effective' } }]);
    }

    it('注入专业知识 → 四个步骤全部记录 + 返回 expertiseApplied/professionalJudgmentNote', async () => {
      const llm = makeInjectedLlm();
      const expertiseSvc = makeFullExpertiseService();
      const chainModel = makeChainModel();
      const svc = new IracReasonerService(
        llm as never,
        makeRagWithLaw(),
        makeLawApplicationDeterminer(),
        undefined,
        expertiseSvc as never,
        chainModel as never,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '劳动者主张工资差额',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      // 四步都被调用 buildInjectionContext
      expect(expertiseSvc.buildInjectionContext).toHaveBeenCalledTimes(4);
      const steps = expertiseSvc.buildInjectionContext.mock.calls.map((c) => c[0]);
      expect(steps).toEqual(['issue', 'rule', 'application', 'conclusion']);

      // expertiseApplied 覆盖四个步骤
      expect(result.expertiseApplied).toBeDefined();
      const appliedSteps = (result.expertiseApplied ?? []).map((e) => e.iracStep);
      expect(appliedSteps).toEqual(['issue', 'rule', 'application', 'conclusion']);
      expect(result.expertiseApplied?.[0]).toMatchObject({
        expertiseId: 'le_issue',
        influenceScore: 0.7,
        source: 'auto_matched',
      });

      // professionalJudgmentNote 生成
      expect(result.professionalJudgmentNote?.significantlyInfluenced).toBe(true);
      expect(result.professionalJudgmentNote?.stepDetails.length).toBe(4);

      // reasoning_chain 持久化携带 v3.0 字段
      expect(chainModel.create).toHaveBeenCalledTimes(1);
      const persisted = chainModel.create.mock.calls[0][0];
      expect(persisted.lawyerExpertiseApplied.length).toBe(4);
      expect(persisted.reasoningTrace.length).toBe(4);
      expect(persisted.professionalJudgmentNote).toBeDefined();
    });

    it('异步记录专业知识使用情况（recordUsage 被调用，不阻塞主流程）', async () => {
      const llm = makeInjectedLlm();
      const expertiseSvc = makeFullExpertiseService();
      const chainModel = makeChainModel();
      const svc = new IracReasonerService(
        llm as never,
        makeRagWithLaw(),
        makeLawApplicationDeterminer(),
        undefined,
        expertiseSvc as never,
        chainModel as never,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '劳动者主张工资差额',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(result.reasoningChainId).toBeDefined();
      // 等待异步 recordUsage 完成
      await vi.waitFor(() => {
        expect(expertiseSvc.recordUsage).toHaveBeenCalledTimes(4);
      });
      const firstCall = expertiseSvc.recordUsage.mock.calls[0];
      expect(firstCall[0]).toBe('le_issue');
      expect(firstCall[1]).toBe(result.reasoningChainId);
      expect(firstCall[2]).toBe('issue');
    });

    it('recordUsage 抛异常不阻塞主流程（静默失败）', async () => {
      const llm = makeInjectedLlm();
      const expertiseSvc = makeFullExpertiseService();
      expertiseSvc.recordUsage.mockRejectedValue(new Error('记录失败'));
      const chainModel = makeChainModel();
      const svc = new IracReasonerService(
        llm as never,
        makeRagWithLaw(),
        makeLawApplicationDeterminer(),
        undefined,
        expertiseSvc as never,
        chainModel as never,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '劳动者主张工资差额',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(result.expertiseApplied?.length).toBe(4);
      expect(result.warnings.some((w) => w.includes('记录'))).toBe(false);
    });

    it('专业知识注入失败 → 降级为无注入 + warning，不影响主流程', async () => {
      const llm = makeInjectedLlm();
      const expertiseSvc = makeExpertiseService();
      expertiseSvc.buildInjectionContext.mockRejectedValue(new Error('知识库不可用'));
      const svc = new IracReasonerService(
        llm as never,
        undefined,
        undefined,
        undefined,
        expertiseSvc as never,
        undefined,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '劳动者主张工资差额',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(result.expertiseApplied).toBeUndefined();
      expect(result.professionalJudgmentNote).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        '构建律师专业知识注入上下文失败',
        expect.anything(),
      );
    });

    it('律师专业知识服务未注入 → 不调用、无注入、reasoning_chain 无 v3.0 字段', async () => {
      const llm = makeInjectedLlm();
      const chainModel = makeChainModel();
      const svc = new IracReasonerService(
        llm as never,
        undefined,
        undefined,
        undefined,
        undefined,
        chainModel as never,
        logger as never,
      );

      const result = await svc.reason({
        caseDescription: '劳动者主张工资差额',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      expect(result.expertiseApplied).toBeUndefined();
      expect(result.professionalJudgmentNote).toBeUndefined();
      const persisted = chainModel.create.mock.calls[0][0];
      expect(persisted.lawyerExpertiseApplied).toEqual([]);
      expect(persisted.reasoningTrace).toEqual([]);
      expect(persisted.professionalJudgmentNote?.stepDetails).toEqual([]);
    });

    it('injectionPrompt 注入到 LLM system prompt（Issue 步）', async () => {
      const llm = makeInjectedLlm();
      const expertiseSvc = makeFullExpertiseService();
      const svc = new IracReasonerService(
        llm as never,
        makeRagWithLaw(),
        makeLawApplicationDeterminer(),
        undefined,
        expertiseSvc as never,
        undefined,
        logger as never,
      );

      await svc.reason({
        caseDescription: '劳动者主张工资差额',
        entities: makeEntities(),
        ctx: makeCtx(),
      });

      const issueCall = llm.generate.mock.calls[0];
      const systemPrompt = issueCall[0][0].content as string;
      expect(systemPrompt).toContain('【律师专业经验参考】');
      expect(systemPrompt).toContain('【issue】律师专业经验注入');
    });
  });
});
