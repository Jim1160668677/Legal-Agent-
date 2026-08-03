/**
 * AnswerQualityScorer —— 回答质量双轨评分（v2.3 阶段十，17 §3）。
 *
 * 双轨评分（17 §3.1）：
 *   1. 自动评分（实时）：AI 回答产出时同步计算，写入 answer_traceability.autoScore
 *   2. 律师评分（异步）：律师审核提交后聚合，写入 lawyer_review.scores
 *
 * 自动评分算法（17 §3.2）：
 *   citationSuccessRate = citedLaws.filter(verified).length / max(citedLaws.length, 1)
 *   reasoningCompleteness = reasoningChainId ? 1.0 : 0.6
 *   disclaimerCoverage = hasDisclaimer(answer) ? 1.0 : 0.0
 *   autoScore = 5 × (0.5 × citationSuccessRate + 0.3 × reasoningCompleteness + 0.2 × disclaimerCoverage)
 *
 * 律师评分聚合（17 §3.3）：
 *   lawyerScore = (accuracy + completeness + compliance + usefulness) / 4
 *
 * 质量等级阈值（17 §3.4）：
 *   优：≥ 4.0 → 标记 answer_scored 审计，纳入正向样本库
 *   中：2.5 - 4.0 → 常规归档
 *   差：< 2.5 → 触发 LawyerAnnotationService 回流 + 同步 compliance_alert（若 riskFlag=high）
 *
 * 设计依据：17 §3 回答质量评分；05 3.34 answer_traceability.autoScore。
 */
import { Injectable, Optional } from '@nestjs/common';
import { AuditLogService } from '../../platform/audit/audit-log.service';
import type {
  AutoScoreInput,
  AutoScoreResult,
  LawyerScoreInput,
  LawyerScoreResult,
  QualityGrade,
} from './review.types';
import { QUALITY_GRADE_THRESHOLDS, REFLOW_SCORE_THRESHOLD } from './review.types';

/** 免责声明关键词（用于 disclaimerCoverage 判定） */
const DISCLAIMER_KEYWORDS = ['免责', '声明', '不构成法律意见', '仅供参考', '咨询专业律师'];

/** 自动评分权重（17 §3.2） */
const AUTO_SCORE_WEIGHTS = {
  citationSuccessRate: 0.5,
  reasoningCompleteness: 0.3,
  disclaimerCoverage: 0.2,
} as const;

@Injectable()
export class AnswerQualityScorer {
  constructor(@Optional() private readonly audit?: AuditLogService) {}

  /**
   * 自动评分（实时，17 §3.2）。
   * 在 AI 回答产出时由编排器调用，结果写入 answer_traceability.autoScore。
   */
  computeAutoScore(input: AutoScoreInput): AutoScoreResult {
    // 1. 法条引用成功率
    const citedLaws = input.trace.citedLaws ?? [];
    const verifiedCount = citedLaws.filter((l) => l.verified).length;
    const citationSuccessRate = citedLaws.length > 0 ? verifiedCount / citedLaws.length : 0;

    // 2. 推理链完整度（有推理链满分，否则 0.6）
    const reasoningCompleteness = input.trace.reasoningChainId ? 1.0 : 0.6;

    // 3. 免责覆盖（回答含免责声明满分）
    const disclaimerCoverage = this.hasDisclaimer(input.answer, input.hasDisclaimer) ? 1.0 : 0.0;

    // 4. 加权聚合
    const autoScore =
      5 *
      (AUTO_SCORE_WEIGHTS.citationSuccessRate * citationSuccessRate +
        AUTO_SCORE_WEIGHTS.reasoningCompleteness * reasoningCompleteness +
        AUTO_SCORE_WEIGHTS.disclaimerCoverage * disclaimerCoverage);

    // 保留两位小数
    const rounded = Math.round(autoScore * 100) / 100;

    return {
      autoScore: rounded,
      citationSuccessRate: Math.round(citationSuccessRate * 100) / 100,
      reasoningCompleteness,
      disclaimerCoverage,
    };
  }

  /**
   * 律师评分聚合（异步，17 §3.3）。
   * 律师审核提交后调用，四维平均 + 质量等级判定。
   */
  computeLawyerScore(input: LawyerScoreInput): LawyerScoreResult {
    const { accuracy, completeness, compliance, usefulness } = input.scores;
    const lawyerScore = (accuracy + completeness + compliance + usefulness) / 4;
    const rounded = Math.round(lawyerScore * 100) / 100;
    const grade = this.determineGrade(rounded);

    return {
      lawyerScore: rounded,
      grade,
    };
  }

  /**
   * 综合评分（17 §3.4）：
   *   - 有律师评分 → 用律师评分
   *   - 无律师评分 → 用 autoScore
   * 返回综合分 + 等级 + 是否触发回流（< 2.5）。
   */
  computeOverallScore(
    autoScore: number,
    lawyerScore?: number,
  ): { score: number; grade: QualityGrade; triggerReflow: boolean } {
    const score = lawyerScore !== undefined ? lawyerScore : autoScore;
    const grade = this.determineGrade(score);
    const triggerReflow = score < REFLOW_SCORE_THRESHOLD;
    return { score, grade, triggerReflow };
  }

  /**
   * 写 answer_scored 审计（17 §9）。
   * 在评分计算完成后由调用方触发。
   */
  writeScoredAudit(msgId: string, autoScore: number, lawyerScore?: number): void {
    this.audit?.write('answer_scored', {
      msgId,
      autoScore,
      lawyerScore,
    });
  }

  // ===== 内部辅助 =====

  /** 免责声明判定（17 §3.2 disclaimerCoverage） */
  private hasDisclaimer(answer: string, explicitFlag?: boolean): boolean {
    if (explicitFlag !== undefined) return explicitFlag;
    if (!answer || answer.length === 0) return false;
    return DISCLAIMER_KEYWORDS.some((kw) => answer.includes(kw));
  }

  /** 质量等级判定（17 §3.4） */
  private determineGrade(score: number): QualityGrade {
    if (score >= QUALITY_GRADE_THRESHOLDS.excellent) return 'excellent';
    if (score < QUALITY_GRADE_THRESHOLDS.poor) return 'poor';
    return 'medium';
  }
}
