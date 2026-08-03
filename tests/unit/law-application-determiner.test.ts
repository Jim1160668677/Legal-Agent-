/**
 * LawApplicationDeterminerService 单元测试（v2.3-W5，16 §4）。
 *
 * 覆盖：
 *   - 构成要件抽取：rule.conditions 已结构化 / LLM 抽取 / 抽取失败 8019
 *   - 事实匹配：单要件 yes/no/partial
 *   - 聚合判定：全 matched→applicable / 含 partial→partial / 关键要件 unmatched→false
 *   - 降级：LLM 不可用 → 规则匹配 / LLM 整体判定失败 → partial
 *   - 边界：rule 无 conditions + LLM 不可用 / factEntities 缺失关键实体
 *   - JSON 解析容错（直接 JSON.parse / 正则提取 / 非法 JSON 降级）
 *
 * 设计依据：16 §4 法条适用判定算法；16 §4.4 边界条件。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LawApplicationDeterminerService } from '../../src/modules/legal/reasoning/law-application-determiner.service';
import type { Entity } from '../../src/modules/legal/nlu/nlu.types';
import { REASONING_ERROR_CODES } from '../../src/modules/legal/reasoning/reasoning.types';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
}

/** 构造 mock LlmService，generate 按序返回指定响应（多轮调用） */
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
        model: 'agnes-2.0-flash',
        finishReason: 'stop',
        usage: r.usage ?? { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
        raw: {},
      });
    }),
    stream: vi.fn(),
    validateLawRefs: vi.fn(),
  };
}

/** 构造 mock LlmService，generate 始终返回同一响应 */
function makeLlm(content: string) {
  return makeLlmSequence([{ content }]);
}

function makeRule(options: { articleId?: string; articleText?: string; conditions?: string[] }) {
  return {
    articleId: options.articleId ?? 'art-001',
    articleText: options.articleText ?? '借贷合同成立需有借款合同且已实际交付借款。',
    conditions: options.conditions,
  };
}

function makeKeyEntities(): Entity[] {
  return [
    { type: 'case_cause', value: '借贷纠纷', span: [0, 4], confidence: 0.9, source: 'dict' },
    { type: 'amount', value: '5万元', span: [10, 13], confidence: 0.95, source: 'regex' },
    { type: 'contract', value: '借款合同', span: [5, 9], confidence: 0.85, source: 'dict' },
    { type: 'date', value: '2023年5月10日', span: [14, 24], confidence: 0.9, source: 'regex' },
  ];
}

describe('v2.3-W5 LawApplicationDeterminerService（法条适用判定算法）', () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  describe('构成要件抽取（16 §4.2 第 1 步）', () => {
    it('rule.conditions 已结构化 → 直接使用（parseSource=structured）', async () => {
      const svc = new LawApplicationDeterminerService(undefined, logger as never);
      // 用实体中存在的精确值，便于 ruleBasedMatch 全匹配
      const rule = makeRule({ conditions: ['借款合同', '借贷纠纷'] });

      const result = await svc.determine({
        rule,
        factEntities: makeKeyEntities(),
        caseDescription: '原告借款5万元给被告',
      });

      // 关键词全在实体中 → 全 yes → applicable
      expect(result.factMatch).toBe('applicable');
      // warnings 不应包含"未结构化"提示
      expect(result.warnings.some((w) => w.includes('法条未结构化'))).toBe(false);
    });

    it('rule.conditions 未结构化 + LLM 抽取成功 → parseSource=llm + warning', async () => {
      const llm = makeLlmSequence([
        {
          // 第 1 次调用：抽取构成要件
          content: JSON.stringify({
            conditions: ['有借款合同', '已实际交付借款'],
            legalConsequences: ['返还借款'],
          }),
        },
        {
          // 第 2 次调用：判定要件 1
          content: JSON.stringify({ result: 'yes', reason: '有借款合同' }),
        },
        {
          // 第 3 次调用：判定要件 2
          content: JSON.stringify({ result: 'yes', reason: '已交付' }),
        },
      ]);
      const svc = new LawApplicationDeterminerService(llm as never, logger as never);

      const result = await svc.determine({
        rule: makeRule({ conditions: undefined }),
        factEntities: makeKeyEntities(),
        caseDescription: '原告借款5万元给被告',
      });

      expect(result.warnings.some((w) => w.includes('法条未结构化，已用 LLM 抽取'))).toBe(true);
      expect(result.factMatch).toBe('applicable');
    });

    it('LLM 抽取构成要件失败（返回空）→ 8019 + 降级 LLM 整体判定', async () => {
      const llm = makeLlmSequence([
        {
          // 第 1 次：抽取构成要件失败（空数组）
          content: JSON.stringify({ conditions: [], legalConsequences: [] }),
        },
        {
          // 第 2 次：整体判定降级
          content: JSON.stringify({
            factMatch: 'partial',
            matchedFacts: ['有借款合同'],
            unmatchedFacts: ['未交付'],
          }),
        },
      ]);
      const svc = new LawApplicationDeterminerService(llm as never, logger as never);

      const result = await svc.determine({
        rule: makeRule({ conditions: undefined }),
        factEntities: makeKeyEntities(),
        caseDescription: '原告借款5万元给被告',
      });

      expect(result.degradedCode).toBe(REASONING_ERROR_CODES.INSUFFICIENT_LAW_APPLY);
      expect(result.warnings.some((w) => w.includes('法条构成要件抽取失败'))).toBe(true);
      expect(result.factMatch).toBe('partial');
    });

    it('LLM 抽取构成要件抛异常 → 8019 + 降级 LLM 整体判定', async () => {
      const llm = {
        generate: vi.fn().mockRejectedValueOnce(new Error('LLM 不可用')),
        stream: vi.fn(),
        validateLawRefs: vi.fn(),
      };
      const svc = new LawApplicationDeterminerService(llm as never, logger as never);

      const result = await svc.determine({
        rule: makeRule({ conditions: undefined }),
        factEntities: makeKeyEntities(),
        caseDescription: '原告借款5万元给被告',
      });

      // 抽取失败 → fallbackOverallMatch，但 LLM 也不可用 → partial + warnings
      expect(result.degradedCode).toBe(REASONING_ERROR_CODES.INSUFFICIENT_LAW_APPLY);
      expect(result.factMatch).toBe('partial');
    });

    it('rule 无 conditions 且 LLM 不可用 → 8019 + partial', async () => {
      const svc = new LawApplicationDeterminerService(undefined, logger as never);

      const result = await svc.determine({
        rule: makeRule({ conditions: undefined }),
        factEntities: makeKeyEntities(),
        caseDescription: '原告借款5万元给被告',
      });

      expect(result.degradedCode).toBe(REASONING_ERROR_CODES.INSUFFICIENT_LAW_APPLY);
      expect(result.factMatch).toBe('partial');
      expect(result.warnings.some((w) => w.includes('LLM 不可用'))).toBe(true);
    });
  });

  describe('事实匹配（16 §4.2 第 2 步）', () => {
    it('全要件 yes → applicable', async () => {
      const llm = makeLlmSequence([
        { content: JSON.stringify({ result: 'yes', reason: 'r1' }) },
        { content: JSON.stringify({ result: 'yes', reason: 'r2' }) },
      ]);
      const svc = new LawApplicationDeterminerService(llm as never, logger as never);

      const result = await svc.determine({
        rule: makeRule({ conditions: ['有借款合同', '已实际交付借款'] }),
        factEntities: makeKeyEntities(),
        caseDescription: '原告借款5万元给被告',
      });

      expect(result.factMatch).toBe('applicable');
      expect(result.matchedFacts).toEqual(['有借款合同', '已实际交付借款']);
      expect(result.unmatchedFacts).toEqual([]);
    });

    it('全要件 no → false（unmatched 比例 ≥ 50%）', async () => {
      const llm = makeLlmSequence([
        { content: JSON.stringify({ result: 'no', reason: 'r1' }) },
        { content: JSON.stringify({ result: 'no', reason: 'r2' }) },
      ]);
      const svc = new LawApplicationDeterminerService(llm as never, logger as never);

      const result = await svc.determine({
        rule: makeRule({ conditions: ['有借款合同', '已实际交付借款'] }),
        factEntities: makeKeyEntities(),
      });

      expect(result.factMatch).toBe('false');
      expect(result.matchedFacts).toEqual([]);
      expect(result.unmatchedFacts).toEqual(['有借款合同', '已实际交付借款']);
    });

    it('含 partial 无 unmatched → partial', async () => {
      const llm = makeLpmPartial();
      const svc = new LawApplicationDeterminerService(llm as never, logger as never);

      const result = await svc.determine({
        rule: makeRule({ conditions: ['要件1', '要件2'] }),
        factEntities: makeKeyEntities(),
      });

      expect(result.factMatch).toBe('partial');
      // 两要件均 partial → matchedFacts 都加（部分）后缀
      expect(result.matchedFacts).toEqual(['要件1（部分）', '要件2（部分）']);
      expect(result.unmatchedFacts).toEqual([]);
    });

    it('部分 yes 部分 no → partial 或 false（按比例）', async () => {
      const llm = makeLlmSequence([
        { content: JSON.stringify({ result: 'yes', reason: 'r1' }) },
        { content: JSON.stringify({ result: 'no', reason: 'r2' }) },
        { content: JSON.stringify({ result: 'no', reason: 'r3' }) },
        { content: JSON.stringify({ result: 'no', reason: 'r4' }) },
      ]);
      const svc = new LawApplicationDeterminerService(llm as never, logger as never);

      // 1/4 matched, 3/4 unmatched → unmatchedRatio=0.75 >= 0.5, matchedRatio=0.25 < 0.5 → false
      const result = await svc.determine({
        rule: makeRule({ conditions: ['a', 'b', 'c', 'd'] }),
        factEntities: makeKeyEntities(),
      });

      expect(result.factMatch).toBe('false');
      expect(result.matchedFacts).toEqual(['a']);
      expect(result.unmatchedFacts).toEqual(['b', 'c', 'd']);
    });
  });

  describe('聚合判定（16 §4.2 第 3 步）', () => {
    it('1/2 matched + 1/2 unmatched → partial', async () => {
      const llm = makeLlmSequence([
        { content: JSON.stringify({ result: 'yes', reason: 'r1' }) },
        { content: JSON.stringify({ result: 'no', reason: 'r2' }) },
      ]);
      const svc = new LawApplicationDeterminerService(llm as never, logger as never);

      // matchedRatio=0.5 not < 0.5, unmatchedRatio=0.5 not >= 0.5 (boundary) → partial
      const result = await svc.determine({
        rule: makeRule({ conditions: ['a', 'b'] }),
        factEntities: makeKeyEntities(),
      });

      expect(result.factMatch).toBe('partial');
    });

    it('含 partial + 含 unmatched → partial', async () => {
      const llm = makeLlmSequence([
        { content: JSON.stringify({ result: 'partial', reason: 'r1' }) },
        { content: JSON.stringify({ result: 'no', reason: 'r2' }) },
        { content: JSON.stringify({ result: 'yes', reason: 'r3' }) },
      ]);
      const svc = new LawApplicationDeterminerService(llm as never, logger as never);

      const result = await svc.determine({
        rule: makeRule({ conditions: ['a', 'b', 'c'] }),
        factEntities: makeKeyEntities(),
      });

      expect(result.factMatch).toBe('partial');
      expect(result.matchedFacts).toContain('a（部分）');
      expect(result.matchedFacts).toContain('c');
      expect(result.unmatchedFacts).toEqual(['b']);
    });
  });

  describe('LLM 不可用降级（规则匹配）', () => {
    it('LLM 未注入 → 全要件走 ruleBasedMatch', async () => {
      const svc = new LawApplicationDeterminerService(undefined, logger as never);

      const result = await svc.determine({
        rule: makeRule({ conditions: ['借款合同'] }), // 关键词"借款合同"在实体中存在
        factEntities: makeKeyEntities(),
      });

      // "借款合同" 在 entities 中（contract 类型值="借款合同"）→ yes → applicable
      expect(result.factMatch).toBe('applicable');
      expect(result.matchedFacts).toEqual(['借款合同']);
    });

    it('ruleBasedMatch 关键词不在实体中 → no', async () => {
      const svc = new LawApplicationDeterminerService(undefined, logger as never);

      const result = await svc.determine({
        rule: makeRule({ conditions: ['特殊要件'] }),
        factEntities: makeKeyEntities(),
      });

      // "特殊要件" 不在实体中 → no
      expect(result.factMatch).toBe('false');
      expect(result.unmatchedFacts).toEqual(['特殊要件']);
    });

    it('LLM 单要件匹配抛异常 → 降级为 ruleBasedMatch', async () => {
      const llm = {
        generate: vi
          .fn()
          .mockRejectedValueOnce(new Error('网络异常'))
          .mockResolvedValueOnce({
            content: JSON.stringify({ result: 'yes', reason: 'r2' }),
            model: 'm',
            finishReason: 'stop',
            usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
            raw: {},
          }),
        stream: vi.fn(),
        validateLawRefs: vi.fn(),
      };
      const svc = new LawApplicationDeterminerService(llm as never, logger as never);

      const result = await svc.determine({
        rule: makeRule({ conditions: ['借款合同', '要件2'] }),
        factEntities: makeKeyEntities(),
      });

      // 第 1 要件 LLM 失败 → ruleBasedMatch（"借款合同"在实体中）→ yes
      // 第 2 要件 LLM 成功 → yes
      expect(result.factMatch).toBe('applicable');
    });
  });

  describe('实体缺失关键信息（16 §4.4 第 2 条）', () => {
    it('factEntities 缺失关键实体 → warning + 未匹配要件含"事实信息不足"', async () => {
      const llm = makeLlmSequence([{ content: JSON.stringify({ result: 'no', reason: 'r1' }) }]);
      const svc = new LawApplicationDeterminerService(llm as never, logger as never);

      const result = await svc.determine({
        rule: makeRule({ conditions: ['某要件'] }),
        factEntities: [], // 无任何实体
        caseDescription: '某案情',
      });

      expect(result.warnings.some((w) => w.includes('实体缺失关键信息'))).toBe(true);
      expect(result.unmatchedFacts.some((f) => f.includes('事实信息不足'))).toBe(true);
    });

    it('hasKeyEntities 仅 case_cause 也可通过', async () => {
      const svc = new LawApplicationDeterminerService(undefined, logger as never);

      const result = await svc.determine({
        rule: makeRule({ conditions: ['借贷纠纷'] }),
        factEntities: [
          { type: 'case_cause', value: '借贷纠纷', span: [0, 4], confidence: 0.9, source: 'dict' },
        ],
      });

      // "借贷纠纷" 关键词在实体中 → yes → applicable
      expect(result.factMatch).toBe('applicable');
    });
  });

  describe('LLM 整体判定（降级模式，16 §4.2 第 1.c 步）', () => {
    it('LLM 整体判定成功 → 返回 LLM 给出的 factMatch', async () => {
      const llm = makeLlmSequence([
        {
          // 第 1 次：抽取构成要件失败
          content: JSON.stringify({ conditions: [], legalConsequences: [] }),
        },
        {
          // 第 2 次：整体判定
          content: JSON.stringify({
            factMatch: 'applicable',
            matchedFacts: ['a', 'b'],
            unmatchedFacts: [],
          }),
        },
      ]);
      const svc = new LawApplicationDeterminerService(llm as never, logger as never);

      const result = await svc.determine({
        rule: makeRule({ conditions: undefined }),
        factEntities: makeKeyEntities(),
      });

      expect(result.factMatch).toBe('applicable');
      expect(result.degradedCode).toBe(REASONING_ERROR_CODES.INSUFFICIENT_LAW_APPLY);
      expect(result.matchedFacts).toEqual(['a', 'b']);
    });

    it('LLM 整体判定抛异常 → partial + warnings', async () => {
      const llm = {
        generate: vi
          .fn()
          .mockResolvedValueOnce({
            // 抽取构成要件失败
            content: JSON.stringify({ conditions: [], legalConsequences: [] }),
            model: 'm',
            finishReason: 'stop',
            usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
            raw: {},
          })
          .mockRejectedValueOnce(new Error('整体判定失败')),
        stream: vi.fn(),
        validateLawRefs: vi.fn(),
      };
      const svc = new LawApplicationDeterminerService(llm as never, logger as never);

      const result = await svc.determine({
        rule: makeRule({ conditions: undefined }),
        factEntities: makeKeyEntities(),
      });

      expect(result.factMatch).toBe('partial');
      expect(result.degradedCode).toBe(REASONING_ERROR_CODES.INSUFFICIENT_LAW_APPLY);
      expect(result.warnings.some((w) => w.includes('LLM 整体判定失败'))).toBe(true);
    });
  });

  describe('LLM JSON 解析容错', () => {
    it('LLM 返回非 JSON 文本 → matchCondition 降级 partial', async () => {
      const llm = makeLlm('这是非JSON文本');
      const svc = new LawApplicationDeterminerService(llm as never, logger as never);

      const result = await svc.determine({
        rule: makeRule({ conditions: ['某要件'] }),
        factEntities: makeKeyEntities(),
      });

      // parseMatchJson 失败 → 返回 'partial'
      expect(result.matchedFacts).toContain('某要件（部分）');
      expect(result.factMatch).toBe('partial');
    });

    it('LLM 返回带前后说明的 JSON → 正则提取', async () => {
      const llm = makeLlm(`解析结果：${JSON.stringify({ result: 'yes', reason: 'r' })}，请参考。`);
      const svc = new LawApplicationDeterminerService(llm as never, logger as never);

      const result = await svc.determine({
        rule: makeRule({ conditions: ['某要件'] }),
        factEntities: makeKeyEntities(),
      });

      expect(result.matchedFacts).toContain('某要件');
    });
  });
});

/** 构造 LLM：两要件均返回 partial */
function makeLpmPartial() {
  return makeLlmSequence([
    { content: JSON.stringify({ result: 'partial', reason: 'r1' }) },
    { content: JSON.stringify({ result: 'partial', reason: 'r2' }) },
  ]);
}
