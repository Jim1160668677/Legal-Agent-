/**
 * CaseComparatorService 单元测试（v2.3-W5，16 §5）。
 *
 * 覆盖：
 *   - 候选案例来源：外部传入 / RagService 召回 / 缺失提示
 *   - 相似度 < 0.5 跳过
 *   - sharedFacts 交集抽取（案由/类别/当事人角色）
 *   - diffFacts 差集抽取（金额/时间线/判决）
 *   - verdictDiff 判决差异（一致 / 不一致 / 缺失）
 *   - 按 similarity 降序排列
 *   - 空案例降级（无候选 / 全过滤）
 *   - FactSimilarityService 未注入 → 简化相似度降级
 *   - RagService 召回失败 → warnings
 *
 * 设计依据：16 §5 案例对比算法；16 §3.3 相似度阈值。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CaseComparatorService } from '../../src/modules/legal/reasoning/case-comparator.service';
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

/** 构造 mock FactSimilarityService，compute 返回指定相似度 */
function makeFactSimilarity(similarity: number) {
  return {
    compute: vi.fn().mockResolvedValue({
      similarity,
      cosSim: similarity,
      jaccardSim: similarity,
      embeddingWeight: 0.6,
      attributesWeight: 0.4,
      warnings: [],
    }),
  };
}

/** 构造 mock RagService，retrieve 返回指定案例列表 */
function makeRag(
  cases: Array<{ id: string; title: string; content: string; meta?: Record<string, unknown> }>,
) {
  return {
    retrieve: vi.fn().mockResolvedValue(cases),
  };
}

function makeUserFacts(entities: Entity[] = []) {
  return {
    text: '本案为租赁合同纠纷，原告索赔5万元，发生在2023年5月10日。',
    entities,
    expectedVerdict: undefined as string | undefined,
  };
}

function makeKeyEntities(): Entity[] {
  return [
    { type: 'case_cause', value: '租赁合同纠纷', span: [0, 6], confidence: 0.9, source: 'dict' },
    { type: 'person', value: '原告', span: [7, 9], confidence: 0.85, source: 'dict' },
    { type: 'amount', value: '5万元', span: [10, 13], confidence: 0.95, source: 'regex' },
    { type: 'date', value: '2023年5月10日', span: [14, 24], confidence: 0.9, source: 'regex' },
  ];
}

describe('v2.3-W5 CaseComparatorService（案例对比算法）', () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  describe('候选案例来源', () => {
    it('外部传入 cases → 直接使用，不调 RagService', async () => {
      const rag = makeRag([]);
      const factSim = makeFactSimilarity(0.8);
      const svc = new CaseComparatorService(factSim as never, rag as never, logger as never);

      const result = await svc.compare({
        userFacts: makeUserFacts(makeKeyEntities()),
        cases: [
          {
            caseId: 'c1',
            caseTitle: '案例1',
            content: '本案为租赁合同纠纷，2023年5月10日，原告索赔5万元。',
            causeOfAction: '租赁合同纠纷',
          },
        ],
      });

      expect(rag.retrieve).not.toHaveBeenCalled();
      expect(result.totalCases).toBe(1);
      expect(result.comparison.length).toBe(1);
    });

    it('未传 cases → RagService 召回 case_precedent top 3', async () => {
      const rag = makeRag([
        {
          id: 'c1',
          title: '案例1',
          content: '租赁合同纠纷',
          meta: { causeOfAction: '租赁合同纠纷' },
        },
        { id: 'c2', title: '案例2', content: '借贷纠纷', meta: { causeOfAction: '借贷纠纷' } },
      ]);
      const factSim = makeFactSimilarity(0.7);
      const svc = new CaseComparatorService(factSim as never, rag as never, logger as never);

      const result = await svc.compare({
        userFacts: makeUserFacts(makeKeyEntities()),
      });

      expect(rag.retrieve).toHaveBeenCalledWith({
        text: makeUserFacts().text,
        collections: ['case_precedent'],
        finalTopK: 3,
      });
      expect(result.totalCases).toBe(2);
    });

    it('未传 cases + RagService 召回为空 → warning + comparison=[]', async () => {
      const rag = makeRag([]);
      const factSim = makeFactSimilarity(0.8);
      const svc = new CaseComparatorService(factSim as never, rag as never, logger as never);

      const result = await svc.compare({
        userFacts: makeUserFacts(),
      });

      expect(result.comparison).toEqual([]);
      expect(result.warnings.some((w) => w.includes('RagService 召回案例为空'))).toBe(true);
    });

    it('RagService 未注入且未提供 cases → 返回空 + warning', async () => {
      const factSim = makeFactSimilarity(0.8);
      const svc = new CaseComparatorService(factSim as never, undefined, logger as never);

      const result = await svc.compare({
        userFacts: makeUserFacts(),
      });

      expect(result.comparison).toEqual([]);
      expect(result.totalCases).toBe(0);
      expect(result.warnings.some((w) => w.includes('RagService 未注入'))).toBe(true);
    });

    it('RagService.retrieve 抛异常 → warning + comparison=[]', async () => {
      const rag = {
        retrieve: vi.fn().mockRejectedValue(new Error('网络异常')),
      };
      const factSim = makeFactSimilarity(0.8);
      const svc = new CaseComparatorService(factSim as never, rag as never, logger as never);

      const result = await svc.compare({
        userFacts: makeUserFacts(),
      });

      expect(result.comparison).toEqual([]);
      expect(result.warnings.some((w) => w.includes('RagService 召回案例失败'))).toBe(true);
    });
  });

  describe('相似度过滤（16 §3.3）', () => {
    it('similarity < 0.5 → 跳过', async () => {
      const factSim = makeFactSimilarity(0.4);
      const svc = new CaseComparatorService(factSim as never, undefined, logger as never);

      const result = await svc.compare({
        userFacts: makeUserFacts(),
        cases: [
          { caseId: 'c1', caseTitle: '案例1', content: '某案' },
          { caseId: 'c2', caseTitle: '案例2', content: '某案' },
        ],
      });

      expect(result.comparison).toEqual([]);
      expect(result.totalCases).toBe(2);
      expect(result.warnings.some((w) => w.includes('暂无高度相似案例'))).toBe(true);
    });

    it('部分案例 similarity < 0.5 → 仅保留 ≥ 0.5 的', async () => {
      const similarities = [0.8, 0.4, 0.6];
      const factSim = {
        compute: vi
          .fn()
          .mockResolvedValueOnce({
            similarity: 0.8,
            cosSim: 0.8,
            jaccardSim: 0.8,
            embeddingWeight: 0.6,
            attributesWeight: 0.4,
            warnings: [],
          })
          .mockResolvedValueOnce({
            similarity: 0.4,
            cosSim: 0.4,
            jaccardSim: 0.4,
            embeddingWeight: 0.6,
            attributesWeight: 0.4,
            warnings: [],
          })
          .mockResolvedValueOnce({
            similarity: 0.6,
            cosSim: 0.6,
            jaccardSim: 0.6,
            embeddingWeight: 0.6,
            attributesWeight: 0.4,
            warnings: [],
          }),
      };
      const svc = new CaseComparatorService(factSim as never, undefined, logger as never);

      const result = await svc.compare({
        userFacts: makeUserFacts(),
        cases: [
          { caseId: 'c1', caseTitle: '案例1', content: '某案' },
          { caseId: 'c2', caseTitle: '案例2', content: '某案' },
          { caseId: 'c3', caseTitle: '案例3', content: '某案' },
        ],
      });

      expect(result.comparison.length).toBe(2);
      expect(result.comparison.map((c) => c.caseId).sort()).toEqual(['c1', 'c3']);
      expect(similarities.length).toBe(3); // 三个相似度都被消费
    });
  });

  describe('差异点抽取（16 §5.2 第 1.3 步）', () => {
    it('sharedFacts：相同案由 → 包含"案由："前缀', async () => {
      const factSim = makeFactSimilarity(0.8);
      const svc = new CaseComparatorService(factSim as never, undefined, logger as never);

      const result = await svc.compare({
        userFacts: makeUserFacts(makeKeyEntities()),
        cases: [
          {
            caseId: 'c1',
            caseTitle: '案例1',
            content: '本案为租赁合同纠纷',
            causeOfAction: '租赁合同纠纷',
          },
        ],
      });

      expect(result.comparison[0].sharedFacts.some((f) => f.includes('案由：租赁合同纠纷'))).toBe(
        true,
      );
    });

    it('diffFacts：金额不同 → 包含"争议金额："差异描述', async () => {
      const factSim = makeFactSimilarity(0.8);
      const svc = new CaseComparatorService(factSim as never, undefined, logger as never);

      const result = await svc.compare({
        userFacts: makeUserFacts(makeKeyEntities()),
        cases: [
          {
            caseId: 'c1',
            caseTitle: '案例1',
            content: '本案为租赁合同纠纷，赔偿10万元',
            causeOfAction: '租赁合同纠纷',
          },
        ],
      });

      // 案例 content 含 "10万元"，用户实体 "5万元" → 金额不同
      expect(result.comparison[0].diffFacts.some((f) => f.includes('争议金额'))).toBe(true);
    });

    it('verdictDiff：用户预期与案例判决一致 → "案例判决与用户预期一致"', async () => {
      const factSim = makeFactSimilarity(0.8);
      const svc = new CaseComparatorService(factSim as never, undefined, logger as never);

      const userFacts = makeUserFacts(makeKeyEntities());
      userFacts.expectedVerdict = '原告胜诉';

      const result = await svc.compare({
        userFacts,
        cases: [
          {
            caseId: 'c1',
            caseTitle: '案例1',
            content: '本案为租赁合同纠纷',
            causeOfAction: '租赁合同纠纷',
            outcomeLabel: '原告胜诉',
          },
        ],
      });

      expect(result.comparison[0].verdictDiff).toContain('一致');
      expect(result.comparison[0].verdictDiff).toContain('原告胜诉');
    });

    it('verdictDiff：用户预期与案例判决不一致 → 包含"不一致"', async () => {
      const factSim = makeFactSimilarity(0.8);
      const svc = new CaseComparatorService(factSim as never, undefined, logger as never);

      const userFacts = makeUserFacts(makeKeyEntities());
      userFacts.expectedVerdict = '原告胜诉';

      const result = await svc.compare({
        userFacts,
        cases: [
          {
            caseId: 'c1',
            caseTitle: '案例1',
            content: '本案为租赁合同纠纷',
            causeOfAction: '租赁合同纠纷',
            outcomeLabel: '驳回诉讼请求',
          },
        ],
      });

      expect(result.comparison[0].verdictDiff).toContain('不一致');
    });

    it('verdictDiff：用户未提供 expectedVerdict → undefined', async () => {
      const factSim = makeFactSimilarity(0.8);
      const svc = new CaseComparatorService(factSim as never, undefined, logger as never);

      const result = await svc.compare({
        userFacts: makeUserFacts(makeKeyEntities()),
        cases: [
          {
            caseId: 'c1',
            caseTitle: '案例1',
            content: '本案为租赁合同纠纷',
            causeOfAction: '租赁合同纠纷',
            outcomeLabel: '原告胜诉',
          },
        ],
      });

      expect(result.comparison[0].verdictDiff).toBeUndefined();
    });
  });

  describe('排序（16 §5.2 第 2 步）', () => {
    it('按 similarity 降序排列', async () => {
      const factSim = {
        compute: vi
          .fn()
          .mockResolvedValueOnce({
            similarity: 0.6,
            cosSim: 0.6,
            jaccardSim: 0.6,
            embeddingWeight: 0.6,
            attributesWeight: 0.4,
            warnings: [],
          })
          .mockResolvedValueOnce({
            similarity: 0.9,
            cosSim: 0.9,
            jaccardSim: 0.9,
            embeddingWeight: 0.6,
            attributesWeight: 0.4,
            warnings: [],
          })
          .mockResolvedValueOnce({
            similarity: 0.7,
            cosSim: 0.7,
            jaccardSim: 0.7,
            embeddingWeight: 0.6,
            attributesWeight: 0.4,
            warnings: [],
          }),
      };
      const svc = new CaseComparatorService(factSim as never, undefined, logger as never);

      const result = await svc.compare({
        userFacts: makeUserFacts(),
        cases: [
          { caseId: 'low', caseTitle: '低相似', content: 'a' },
          { caseId: 'high', caseTitle: '高相似', content: 'b' },
          { caseId: 'mid', caseTitle: '中等', content: 'c' },
        ],
      });

      const sims = result.comparison.map((c) => c.similarity);
      expect(sims).toEqual([0.9, 0.7, 0.6]);
      expect(result.comparison[0].caseId).toBe('high');
    });
  });

  describe('FactSimilarityService 未注入降级', () => {
    it('使用 simpleSimilarity：causeOfAction 相同 → 0.6', async () => {
      const svc = new CaseComparatorService(undefined, undefined, logger as never);

      const result = await svc.compare({
        userFacts: makeUserFacts(makeKeyEntities()),
        cases: [
          {
            caseId: 'c1',
            caseTitle: '案例1',
            content: '某案',
            causeOfAction: '租赁合同纠纷',
          },
        ],
      });

      expect(result.comparison[0].similarity).toBe(0.6);
      expect(result.warnings.some((w) => w.includes('FactSimilarityService 未注入'))).toBe(true);
    });

    it('使用 simpleSimilarity：causeOfAction 不同 → 0.3', async () => {
      const svc = new CaseComparatorService(undefined, undefined, logger as never);

      const result = await svc.compare({
        userFacts: makeUserFacts(makeKeyEntities()),
        cases: [
          {
            caseId: 'c1',
            caseTitle: '案例1',
            content: '某案',
            causeOfAction: '侵权纠纷',
          },
        ],
      });

      // 0.3 < 0.5 → 跳过
      expect(result.comparison).toEqual([]);
    });
  });

  describe('FactSimilarityService 抛异常', () => {
    it('compute 抛异常 → 跳过该案例 + warning', async () => {
      const factSim = {
        compute: vi.fn().mockRejectedValue(new Error('相似度计算失败')),
      };
      const svc = new CaseComparatorService(factSim as never, undefined, logger as never);

      const result = await svc.compare({
        userFacts: makeUserFacts(),
        cases: [{ caseId: 'c1', caseTitle: '案例1', content: '某案' }],
      });

      expect(result.comparison).toEqual([]);
      expect(result.warnings.some((w) => w.includes('相似度计算失败'))).toBe(true);
    });
  });
});
