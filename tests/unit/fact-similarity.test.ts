/**
 * FactSimilarityService 单元测试（v2.3-W5，16 §3）。
 *
 * 覆盖：
 *   - 默认权重融合（embedding 0.6 + attributes 0.4）
 *   - cosine 归一化（[-1,1] → [0,1]）
 *   - 加权 Jaccard 相似度（causeOfAction 0.4 + partyRoles 0.2 + disputeAmount 0.2 + timeline 0.2）
 *   - 文本过短降级（embedding 0.3 + attributes 0.7）
 *   - factB 无 structuredFields → 仅 causeOfAction（权重 1.0）
 *   - EmbeddingService 未注入 → 仅 attributes（权重 1.0）+ warnings
 *   - EmbeddingService 抛异常 → 降级 + warnings
 *   - 维度不匹配 → 降级 + warnings
 *   - 属性匹配（causeOfAction 完全/包含、partyRoles 交集、disputeAmount 区间、timeline 包含）
 *   - 边界：similarity ∈ [0, 1] clamp
 *
 * 设计依据：16 §3 案情事实相似度算法；16 §3.4 边界条件。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FactSimilarityService } from '../../src/modules/legal/reasoning/fact-similarity.service';
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

/** 构造 mock EmbeddingService，embedBatch 返回指定向量对 */
function makeEmbedding(embA: number[], embB: number[]) {
  return {
    embed: vi.fn().mockResolvedValue(embA),
    embedBatch: vi.fn().mockResolvedValue([embA, embB]),
  };
}

/** 构造实体列表 */
function makeEntities(): Entity[] {
  return [
    { type: 'case_cause', value: '租赁合同纠纷', span: [0, 6], confidence: 0.9, source: 'dict' },
    { type: 'person', value: '原告', span: [7, 9], confidence: 0.85, source: 'dict' },
    { type: 'amount', value: '5万元', span: [10, 13], confidence: 0.95, source: 'regex' },
    { type: 'date', value: '2023年5月10日', span: [14, 24], confidence: 0.9, source: 'regex' },
  ];
}

describe('v2.3-W5 FactSimilarityService（案情相似度算法）', () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  describe('默认权重融合（16 §3.2）', () => {
    it('embedding + attributes 全匹配 → similarity = 0.6 × cosSim + 0.4 × jaccardSim', async () => {
      // cosSim=1（向量相同）→ normalizedCos=1；jaccardSim=1（属性全匹配）
      const embedding = makeEmbedding([1, 0, 0], [1, 0, 0]);
      const svc = new FactSimilarityService(embedding as never, logger as never);

      const result = await svc.compute({
        textA: '本案为租赁合同纠纷，原告索赔5万元，发生在2023年5月10日。',
        entitiesA: makeEntities(),
        textB: '类似案情描述，长文本用于通过文本过短阈值。',
        attributesB: {
          causeOfAction: '租赁合同纠纷',
          partyRoles: ['原告'],
          disputeAmount: '5万元',
          timeline: '2023年5月10日',
        },
      });

      expect(result.embeddingWeight).toBe(0.6);
      expect(result.attributesWeight).toBe(0.4);
      expect(result.cosSim).toBeCloseTo(1, 5);
      expect(result.jaccardSim).toBeCloseTo(1, 5);
      expect(result.similarity).toBeCloseTo(1, 5);
    });

    it('cosine 归一化：cosSim=-1 → normalizedCos=0', async () => {
      // 向量相反：cosSim=-1 → normalizedCos=0
      const embedding = makeEmbedding([1, 0], [-1, 0]);
      const svc = new FactSimilarityService(embedding as never, logger as never);

      const result = await svc.compute({
        textA: '本案为租赁合同纠纷，原告索赔5万元，发生在2023年5月10日。',
        entitiesA: makeEntities(),
        textB: '类似案情描述，长文本用于通过文本过短阈值。',
        attributesB: {
          causeOfAction: '租赁合同纠纷',
          partyRoles: ['原告'],
          disputeAmount: '5万元',
          timeline: '2023年5月10日',
        },
      });

      expect(result.cosSim).toBeCloseTo(0, 5);
      // similarity = 0.6 × 0 + 0.4 × 1 = 0.4
      expect(result.similarity).toBeCloseTo(0.4, 5);
    });

    it('属性部分匹配：仅 causeOfAction 一致 → jaccardSim 受影响', async () => {
      const embedding = makeEmbedding([1, 0], [1, 0]);
      const svc = new FactSimilarityService(embedding as never, logger as never);

      const result = await svc.compute({
        textA: '本案为租赁合同纠纷，原告索赔5万元，发生在2023年5月10日。',
        entitiesA: makeEntities(),
        textB: '类似案情描述，长文本用于通过文本过短阈值。',
        attributesB: {
          causeOfAction: '租赁合同纠纷',
          // partyRoles/disputeAmount/timeline 缺失
        },
      });

      // 仅 causeOfAction 一致 → attributeUsed='causeOfAction_only' → jaccardSim=1
      expect(result.jaccardSim).toBeCloseTo(1, 5);
    });
  });

  describe('文本过短降级（16 §3.4 第 1 条）', () => {
    it('textA < 20 字 → embedding 权重降至 0.3，attributes 升至 0.7', async () => {
      const embedding = makeEmbedding([1, 0], [1, 0]);
      const svc = new FactSimilarityService(embedding as never, logger as never);

      const result = await svc.compute({
        textA: '租赁纠纷', // 4 字 < 20
        entitiesA: makeEntities(),
        textB: '类似案情描述，长文本用于通过文本过短阈值。',
        attributesB: { causeOfAction: '租赁合同纠纷' },
      });

      expect(result.embeddingWeight).toBe(0.3);
      expect(result.attributesWeight).toBe(0.7);
      expect(result.warnings.some((w) => w.includes('文本过短'))).toBe(true);
    });

    it('textB < 20 字 → 同样触发降级', async () => {
      const embedding = makeEmbedding([1, 0], [1, 0]);
      const svc = new FactSimilarityService(embedding as never, logger as never);

      const result = await svc.compute({
        textA: '本案为租赁合同纠纷，原告索赔5万元，发生在2023年5月10日。',
        entitiesA: makeEntities(),
        textB: '短文本',
        attributesB: { causeOfAction: '租赁合同纠纷' },
      });

      expect(result.embeddingWeight).toBe(0.3);
      expect(result.warnings.some((w) => w.includes('文本过短'))).toBe(true);
    });
  });

  describe('factB 无 structuredFields 降级（16 §3.4 第 2 条）', () => {
    it('attributesB 为 undefined → 仅 causeOfAction 匹配 + warning', async () => {
      const embedding = makeEmbedding([1, 0], [1, 0]);
      const svc = new FactSimilarityService(embedding as never, logger as never);

      const result = await svc.compute({
        textA: '本案为租赁合同纠纷，原告索赔5万元。',
        entitiesA: makeEntities(),
        textB: '类似案情描述，长文本用于通过文本过短阈值。',
        // attributesB 缺失
      });

      expect(result.warnings.some((w) => w.includes('无 structuredFields'))).toBe(true);
      // 有 causeOfAction → jaccardSim=0.5（中性值）
      expect(result.jaccardSim).toBeCloseTo(0.5, 5);
    });

    it('attributesB 缺失且 entitiesA 无 case_cause → jaccardSim=0', async () => {
      const embedding = makeEmbedding([1, 0], [1, 0]);
      const svc = new FactSimilarityService(embedding as never, logger as never);

      const result = await svc.compute({
        textA: '本案无明确案由',
        entitiesA: [], // 无实体
        textB: '类似案情描述，长文本用于通过文本过短阈值。',
        // attributesB 缺失
      });

      expect(result.jaccardSim).toBe(0);
    });
  });

  describe('EmbeddingService 不可用降级（16 §3.4 第 3 条）', () => {
    it('EmbeddingService 未注入 → 权重调整为 0/1.0 + warnings', async () => {
      const svc = new FactSimilarityService(undefined, logger as never);

      const result = await svc.compute({
        textA: '本案为租赁合同纠纷，原告索赔5万元。',
        entitiesA: makeEntities(),
        textB: '类似案情描述，长文本用于通过文本过短阈值。',
        attributesB: { causeOfAction: '租赁合同纠纷' },
      });

      expect(result.embeddingWeight).toBe(0);
      expect(result.attributesWeight).toBe(1.0);
      expect(result.warnings.some((w) => w.includes('EmbeddingService 未注入'))).toBe(true);
    });

    it('EmbeddingService 抛异常 → 降级 + warnings', async () => {
      const embedding = {
        embed: vi.fn().mockRejectedValue(new Error('网络异常')),
        embedBatch: vi.fn().mockRejectedValue(new Error('网络异常')),
      };
      const svc = new FactSimilarityService(embedding as never, logger as never);

      const result = await svc.compute({
        textA: '本案为租赁合同纠纷，原告索赔5万元。',
        entitiesA: makeEntities(),
        textB: '类似案情描述，长文本用于通过文本过短阈值。',
        attributesB: { causeOfAction: '租赁合同纠纷' },
      });

      expect(result.embeddingWeight).toBe(0);
      expect(result.attributesWeight).toBe(1.0);
      expect(result.warnings.some((w) => w.includes('embedding 计算失败'))).toBe(true);
    });

    it('embedding 返回维度不匹配 → 降级 + warnings', async () => {
      const embedding = {
        embed: vi.fn(),
        embedBatch: vi.fn().mockResolvedValue([
          [1, 0, 0],
          [1, 0],
        ]), // 维度不同
      };
      const svc = new FactSimilarityService(embedding as never, logger as never);

      const result = await svc.compute({
        textA: '本案为租赁合同纠纷，原告索赔5万元。',
        entitiesA: makeEntities(),
        textB: '类似案情描述，长文本用于通过文本过短阈值。',
        attributesB: { causeOfAction: '租赁合同纠纷' },
      });

      expect(result.embeddingWeight).toBe(0);
      expect(result.warnings.some((w) => w.includes('维度不匹配'))).toBe(true);
    });
  });

  describe('属性匹配（16 §3.2 第 2.d 步）', () => {
    it('causeOfAction 包含关系："房屋买卖合同纠纷" vs "买卖合同纠纷" 视为匹配', async () => {
      const svc = new FactSimilarityService(undefined, logger as never);

      const result = await svc.compute({
        textA: '本案为房屋买卖合同纠纷',
        entitiesA: [
          {
            type: 'case_cause',
            value: '房屋买卖合同纠纷',
            span: [0, 8],
            confidence: 0.9,
            source: 'dict',
          },
        ],
        textB: '类似案情描述，长文本用于通过文本过短阈值。',
        attributesB: { causeOfAction: '买卖合同纠纷' },
      });

      // causeOfAction 包含关系 → jaccardSim=1（仅 causeOfAction 共同）
      expect(result.jaccardSim).toBeCloseTo(1, 5);
    });

    it('disputeAmount 区间重叠：5万元 vs 6万元 → ±50% 区间重叠视为匹配', async () => {
      const embedding = makeEmbedding([1, 0], [1, 0]);
      const svc = new FactSimilarityService(embedding as never, logger as never);

      const result = await svc.compute({
        textA: '本案为租赁合同纠纷，原告索赔5万元，发生在2023年5月10日。',
        entitiesA: [
          {
            type: 'case_cause',
            value: '租赁合同纠纷',
            span: [0, 6],
            confidence: 0.9,
            source: 'dict',
          },
          { type: 'amount', value: '5万元', span: [10, 13], confidence: 0.95, source: 'regex' },
        ],
        textB: '类似案情描述，长文本用于通过文本过短阈值。',
        attributesB: {
          causeOfAction: '租赁合同纠纷',
          disputeAmount: '6万元', // 5万±50% = [2.5万, 7.5万] 含 6万
        },
      });

      // causeOfAction + disputeAmount 共同 + 匹配 → jaccardSim = (0.4+0.2)/(0.4+0.2) = 1
      expect(result.jaccardSim).toBeCloseTo(1, 5);
    });

    it('disputeAmount 解析失败 → 退化为字符串匹配（包含关系）', async () => {
      const embedding = makeEmbedding([1, 0], [1, 0]);
      const svc = new FactSimilarityService(embedding as never, logger as never);

      const result = await svc.compute({
        textA: '本案为租赁合同纠纷，原告索赔abc元。',
        entitiesA: [
          {
            type: 'case_cause',
            value: '租赁合同纠纷',
            span: [0, 6],
            confidence: 0.9,
            source: 'dict',
          },
          { type: 'amount', value: 'abc元', span: [10, 13], confidence: 0.95, source: 'regex' },
        ],
        textB: '类似案情描述，长文本用于通过文本过短阈值。',
        attributesB: {
          causeOfAction: '租赁合同纠纷',
          disputeAmount: 'xyz元', // parseAmount 失败 → matchValue("abc元","xyz元") → false
        },
      });

      // causeOfAction 匹配（0.4）+ disputeAmount 不匹配（0）→ jaccardSim = 0.4/0.6
      expect(result.jaccardSim).toBeCloseTo(0.4 / 0.6, 5);
    });

    it('partyRoles 数组交集："原告" vs ["原告","被告"] → 至少一个共同角色视为匹配', async () => {
      const embedding = makeEmbedding([1, 0], [1, 0]);
      const svc = new FactSimilarityService(embedding as never, logger as never);

      const result = await svc.compute({
        textA: '本案为租赁合同纠纷，原告索赔5万元。',
        entitiesA: [
          {
            type: 'case_cause',
            value: '租赁合同纠纷',
            span: [0, 6],
            confidence: 0.9,
            source: 'dict',
          },
          { type: 'person', value: '原告', span: [7, 9], confidence: 0.85, source: 'dict' },
        ],
        textB: '类似案情描述，长文本用于通过文本过短阈值。',
        attributesB: {
          causeOfAction: '租赁合同纠纷',
          partyRoles: ['原告', '被告'],
        },
      });

      // causeOfAction + partyRoles 共同 + 匹配 → jaccardSim = (0.4+0.2)/(0.4+0.2) = 1
      expect(result.jaccardSim).toBeCloseTo(1, 5);
    });

    it('仅 causeOfAction 共同 → attributeUsed=causeOfAction_only，jaccardSim=1', async () => {
      const embedding = makeEmbedding([1, 0], [1, 0]);
      const svc = new FactSimilarityService(embedding as never, logger as never);

      const result = await svc.compute({
        textA: '本案为借贷纠纷',
        entitiesA: [
          { type: 'case_cause', value: '借贷纠纷', span: [0, 4], confidence: 0.9, source: 'dict' },
        ],
        textB: '类似案情描述，长文本用于通过文本过短阈值。',
        attributesB: {
          causeOfAction: '借贷纠纷',
          partyRoles: ['原告'], // entitiesA 无 partyRoles → 不共同
        },
      });

      // commonKeys 仅 causeOfAction → 直接匹配，jaccardSim=1
      expect(result.jaccardSim).toBeCloseTo(1, 5);
    });

    it('无共同属性维度且两边 causeOfAction 不同 → jaccardSim=0 + warning', async () => {
      const embedding = makeEmbedding([1, 0], [1, 0]);
      const svc = new FactSimilarityService(embedding as never, logger as never);

      const result = await svc.compute({
        textA: '本案为借贷纠纷',
        entitiesA: [
          { type: 'case_cause', value: '借贷纠纷', span: [0, 4], confidence: 0.9, source: 'dict' },
        ],
        textB: '类似案情描述，长文本用于通过文本过短阈值。',
        attributesB: {
          // 无 causeOfAction，只有 partyRoles → commonKeys 为空
          partyRoles: ['原告'],
        },
      });

      expect(result.warnings.some((w) => w.includes('无共同属性维度'))).toBe(true);
      // 两边 causeOfAction 不同（attrsB 无）→ jaccardSim=0
      expect(result.jaccardSim).toBe(0);
    });
  });

  describe('extractAttributes 兜底（从文本提取金额）', () => {
    it('entities 无 amount 但文本含金额 → 从文本提取', async () => {
      const svc = new FactSimilarityService(undefined, logger as never);

      const result = await svc.compute({
        textA: '本案索赔金额为10万元',
        entitiesA: [
          { type: 'case_cause', value: '借贷纠纷', span: [0, 4], confidence: 0.9, source: 'dict' },
        ],
        textB: '类似案情描述，长文本用于通过文本过短阈值。',
        attributesB: {
          causeOfAction: '借贷纠纷',
          disputeAmount: '10万元',
        },
      });

      // causeOfAction + disputeAmount（从文本提取）匹配 → jaccardSim=1
      expect(result.jaccardSim).toBeCloseTo(1, 5);
    });
  });

  describe('边界保护', () => {
    it('similarity 被 clamp 到 [0, 1]', async () => {
      // 构造极端 cosSim 让乘积 > 1（不可能但验证 clamp）
      const embedding = makeEmbedding([1, 0], [1, 0]);
      const svc = new FactSimilarityService(embedding as never, logger as never);

      const result = await svc.compute({
        textA: '本案为租赁合同纠纷，原告索赔5万元。',
        entitiesA: makeEntities(),
        textB: '类似案情描述，长文本用于通过文本过短阈值。',
        attributesB: {
          causeOfAction: '租赁合同纠纷',
          partyRoles: ['原告'],
          disputeAmount: '5万元',
          timeline: '2023年5月10日',
        },
      });

      expect(result.similarity).toBeGreaterThanOrEqual(0);
      expect(result.similarity).toBeLessThanOrEqual(1);
    });

    it('仅 causeOfAction + 无 embedding → warnings 含精度提示', async () => {
      const svc = new FactSimilarityService(undefined, logger as never);

      const result = await svc.compute({
        textA: '本案为借贷纠纷',
        entitiesA: [
          { type: 'case_cause', value: '借贷纠纷', span: [0, 4], confidence: 0.9, source: 'dict' },
        ],
        textB: '类似案情描述，长文本用于通过文本过短阈值。',
        attributesB: {
          causeOfAction: '借贷纠纷',
        },
      });

      expect(result.warnings.some((w) => w.includes('精度较低'))).toBe(true);
    });
  });
});
