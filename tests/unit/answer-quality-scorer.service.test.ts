/**
 * AnswerQualityScorer 单元测试（v2.3 阶段十，17 §3）。
 *
 * 覆盖：
 *   - 自动评分算法（17 §3.2）：
 *     · citationSuccessRate = verified / total
 *     · reasoningCompleteness = 有推理链 1.0 / 无 0.6
 *     · disclaimerCoverage = 含免责声明 1.0 / 无 0.0
 *     · autoScore = 5 × (0.5×cite + 0.3×reasoning + 0.2×disclaimer)
 *   - 律师评分聚合（17 §3.3）：四维平均
 *   - 质量等级阈值（17 §3.4）：优 ≥4.0 / 中 2.5-4.0 / 差 <2.5
 *   - 综合评分：有律师评分用律师评分，无则用 autoScore
 *   - 触发回流：< 2.5 triggerReflow=true
 *   - answer_scored 审计写入
 *
 * 设计依据：17 §3 回答质量评分；05 3.34 autoScore。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnswerQualityScorer } from '../../src/modules/legal/review/answer-quality-scorer.service';
import type { AutoScoreInput, LawyerScoreInput } from '../../src/modules/legal/review/review.types';

function makeAudit() {
  return { write: vi.fn(), writeSync: vi.fn() };
}

describe('AnswerQualityScorer（回答质量双轨评分，17 §3）', () => {
  let scorer: AnswerQualityScorer;
  let audit: ReturnType<typeof makeAudit>;

  beforeEach(() => {
    audit = makeAudit();
    scorer = new AnswerQualityScorer(audit as never);
  });

  // ===== 自动评分算法（17 §3.2）=====

  describe('computeAutoScore 自动评分', () => {
    it('全部成功 + 有推理链 + 有免责声明 → 满分 5.0', () => {
      const input: AutoScoreInput = {
        answer: '根据民法典，本案免责声明：仅供参考',
        trace: {
          citedLaws: [
            { ref: '民法典第143条', verified: true },
            { ref: '民法典第577条', verified: true },
          ],
          reasoningChainId: 'rc-001',
        },
        hasDisclaimer: true,
      };
      const result = scorer.computeAutoScore(input);
      expect(result.citationSuccessRate).toBe(1);
      expect(result.reasoningCompleteness).toBe(1);
      expect(result.disclaimerCoverage).toBe(1);
      // 5 × (0.5×1 + 0.3×1 + 0.2×1) = 5 × 1.0 = 5
      expect(result.autoScore).toBe(5);
    });

    it('法条引用失败率 50% + 无推理链 + 无免责 → 低分', () => {
      const input: AutoScoreInput = {
        answer: '本案分析',
        trace: {
          citedLaws: [
            { ref: '法条1', verified: true },
            { ref: '法条2', verified: false },
          ],
          // 无 reasoningChainId
        },
        // 无 hasDisclaimer，answer 不含免责关键词
      };
      const result = scorer.computeAutoScore(input);
      expect(result.citationSuccessRate).toBe(0.5);
      expect(result.reasoningCompleteness).toBe(0.6);
      expect(result.disclaimerCoverage).toBe(0);
      // 5 × (0.5×0.5 + 0.3×0.6 + 0.2×0) = 5 × (0.25 + 0.18) = 5 × 0.43 = 2.15
      expect(result.autoScore).toBeCloseTo(2.15, 2);
    });

    it('无法条引用时 citationSuccessRate=0', () => {
      const input: AutoScoreInput = {
        answer: '回答',
        trace: { citedLaws: [] },
        hasDisclaimer: true,
      };
      const result = scorer.computeAutoScore(input);
      expect(result.citationSuccessRate).toBe(0);
      // 5 × (0.5×0 + 0.3×0.6 + 0.2×1) = 5 × (0.18 + 0.2) = 5 × 0.38 = 1.9
      expect(result.autoScore).toBeCloseTo(1.9, 2);
    });

    it('免责声明关键词检测：含"咨询专业律师" → disclaimerCoverage=1', () => {
      const input: AutoScoreInput = {
        answer: '建议咨询专业律师获取具体意见',
        trace: {
          citedLaws: [{ ref: '法条1', verified: true }],
          reasoningChainId: 'rc-001',
        },
      };
      const result = scorer.computeAutoScore(input);
      expect(result.disclaimerCoverage).toBe(1);
    });

    it('hasDisclaimer 显式 false → disclaimerCoverage=0', () => {
      const input: AutoScoreInput = {
        answer: '本案分析',
        trace: { citedLaws: [{ ref: '法条1', verified: true }] },
        hasDisclaimer: false,
      };
      const result = scorer.computeAutoScore(input);
      expect(result.disclaimerCoverage).toBe(0);
    });
  });

  // ===== 律师评分聚合（17 §3.3）=====

  describe('computeLawyerScore 律师评分', () => {
    it('四维平均：4+4+5+4=17/4=4.25', () => {
      const input: LawyerScoreInput = {
        scores: { accuracy: 4, completeness: 4, compliance: 5, usefulness: 4 },
      };
      const result = scorer.computeLawyerScore(input);
      expect(result.lawyerScore).toBe(4.25);
      expect(result.grade).toBe('excellent');
    });

    it('四维平均 3+3+3+3=12/4=3.0 → 中', () => {
      const result = scorer.computeLawyerScore({
        scores: { accuracy: 3, completeness: 3, compliance: 3, usefulness: 3 },
      });
      expect(result.lawyerScore).toBe(3);
      expect(result.grade).toBe('medium');
    });

    it('四维平均 1+2+1+2=6/4=1.5 → 差', () => {
      const result = scorer.computeLawyerScore({
        scores: { accuracy: 1, completeness: 2, compliance: 1, usefulness: 2 },
      });
      expect(result.lawyerScore).toBe(1.5);
      expect(result.grade).toBe('poor');
    });
  });

  // ===== 综合评分（17 §3.4）=====

  describe('computeOverallScore 综合评分', () => {
    it('有律师评分 → 用律师评分', () => {
      const result = scorer.computeOverallScore(4.5, 3.0);
      expect(result.score).toBe(3.0);
      expect(result.grade).toBe('medium');
      expect(result.triggerReflow).toBe(false);
    });

    it('无律师评分 → 用 autoScore', () => {
      const result = scorer.computeOverallScore(2.0);
      expect(result.score).toBe(2.0);
      expect(result.grade).toBe('poor');
      expect(result.triggerReflow).toBe(true);
    });

    it('评分 < 2.5 触发回流', () => {
      const result = scorer.computeOverallScore(2.0, 2.4);
      expect(result.triggerReflow).toBe(true);
    });

    it('评分 = 2.5 不触发回流（边界）', () => {
      const result = scorer.computeOverallScore(2.5);
      expect(result.triggerReflow).toBe(false);
      expect(result.grade).toBe('medium');
    });

    it('评分 = 4.0 优（边界）', () => {
      const result = scorer.computeOverallScore(4.0);
      expect(result.grade).toBe('excellent');
    });
  });

  // ===== 审计 =====

  describe('writeScoredAudit', () => {
    it('写 answer_scored 审计事件', () => {
      scorer.writeScoredAudit('msg-001', 4.5, 3.0);
      expect(audit.write).toHaveBeenCalledWith('answer_scored', {
        msgId: 'msg-001',
        autoScore: 4.5,
        lawyerScore: 3.0,
      });
    });
  });
});
