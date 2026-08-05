/**
 * ExpertiseQualityScorer —— 律师专业判断质量评估器（v3.0 新增）。
 *
 * 评估维度：
 *   1. 专业性（Professionalism）：引用的专业知识是否相关、权威
 *   2. 逻辑性（LogicalSoundness）：专业判断的推理链是否完整、合理
 *   3. 实用性（Practicality）：专业建议是否具有实际应用价值
 *   4. 适当性（Appropriateness）：专业判断是否适用于当前场景
 *   5. 透明度（Transparency）：专业判断的应用过程是否可追溯
 *
 * 评分算法：
 *   expertiseScore = w1×专业性 + w2×逻辑性 + w3×实用性 + w4×适当性 + w5×透明度
 *
 * 质量等级：
 *   A（优秀）：≥ 4.5 专业判断深度整合
 *   B（良好）：3.5 - 4.5 有效融合专业知识
 *   C（合格）：2.5 - 3.5 基础专业参考
 *   D（不合格）：< 2.5 专业知识缺失或不当
 *
 * 设计依据：用户需求 5（专业判断质量评估体系）。
 */

import { Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ReasoningChain,
  type ReasoningChainDocument,
  type ExpertiseAppliedItem,
} from '../../../infra/database/schemas/reasoning-chain.schema';
import { PrePublishReview, type PrePublishReviewDocument } from '../../../infra/database/schemas/pre-publish-review.schema';
import { LawyerExpertiseKnowledgeBaseService } from '../knowledge/lawyer-expertise-knowledge-base.service';
import { AppLoggerService } from '../../platform/logger/logger.service';

// ===== 类型定义 =====

/** 专业判断评估输入 */
export interface ExpertiseQualityInput {
  reasoningChainId?: string;
  expertiseApplied?: ExpertiseAppliedItem[];
  professionalJudgmentNote?: {
    summary: string;
    stepDetails?: Array<{
      step: string;
      expertiseIds: string[];
      influenceDescription: string;
    }>;
    significantlyInfluenced: boolean;
  };
  reviewResult?: {
    modificationsCount: number;
    supplementsCount: number;
    reviewDuration: number;
  };
  context?: {
    intent: string;
    scenario: string;
    userSatisfaction?: number;
  };
}

/** 单维度评分 */
export interface DimensionScore {
  name: string;
  score: number;
  weight: number;
  justification: string;
}

/** 评估结果 */
export interface ExpertiseQualityResult {
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D';
  dimensions: DimensionScore[];
  strengths: string[];
  improvements: string[];
  recommendations: string[];
  evaluatedAt: Date;
}

/** 评分权重配置 */
const DIMENSION_WEIGHTS = {
  professionalism: 0.25,
  logicalSoundness: 0.25,
  practicality: 0.20,
  appropriateness: 0.15,
  transparency: 0.15,
} as const;

/** 等级阈值 */
const GRADE_THRESHOLDS = {
  A: 4.5,
  B: 3.5,
  C: 2.5,
};

@Injectable()
export class ExpertiseQualityScorer {
  constructor(
    @Optional()
    @InjectModel(ReasoningChain.name)
    private readonly chainModel?: Model<ReasoningChainDocument>,
    @Optional()
    @InjectModel(PrePublishReview.name)
    private readonly reviewModel?: Model<PrePublishReviewDocument>,
    @Optional() private readonly lawyerExpertiseService?: LawyerExpertiseKnowledgeBaseService,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  // ===== 主评估入口 =====

  /**
   * 评估专业判断质量
   */
  async evaluate(input: ExpertiseQualityInput): Promise<ExpertiseQualityResult> {
    const { expertiseApplied = [], professionalJudgmentNote, reviewResult, context } = input;

    this.logger?.info('开始评估专业判断质量', {
      expertiseCount: expertiseApplied.length,
      hasReviewResult: !!reviewResult,
    });

    // 获取专业知识详情（如果有 ID）
    const expertiseDetails = await this.fetchExpertiseDetails(expertiseApplied);

    // 各维度评分
    const professionalism = this.evaluateProfessionalism(expertiseApplied, expertiseDetails);
    const logicalSoundness = this.evaluateLogicalSoundness(expertiseApplied, professionalJudgmentNote);
    const practicality = this.evaluatePracticality(expertiseApplied, reviewResult, context);
    const appropriateness = this.evaluateAppropriateness(expertiseApplied, context);
    const transparency = this.evaluateTransparency(expertiseApplied, professionalJudgmentNote);

    // 加权总分
    const overallScore =
      professionalism.score * DIMENSION_WEIGHTS.professionalism +
      logicalSoundness.score * DIMENSION_WEIGHTS.logicalSoundness +
      practicality.score * DIMENSION_WEIGHTS.practicality +
      appropriateness.score * DIMENSION_WEIGHTS.appropriateness +
      transparency.score * DIMENSION_WEIGHTS.transparency;

    const roundedScore = Math.round(overallScore * 100) / 100;
    const grade = this.determineGrade(roundedScore);

    // 生成改进建议
    const { strengths, improvements, recommendations } = this.generateFeedback(
      professionalism,
      logicalSoundness,
      practicality,
      appropriateness,
      transparency,
      expertiseApplied,
      grade,
    );

    return {
      overallScore: roundedScore,
      grade,
      dimensions: [professionalism, logicalSoundness, practicality, appropriateness, transparency],
      strengths,
      improvements,
      recommendations,
      evaluatedAt: new Date(),
    };
  }

  /**
   * 根据推理链 ID 评估
   */
  async evaluateByReasoningChain(reasoningChainId: string): Promise<ExpertiseQualityResult | null> {
    if (!this.chainModel) throw new Error('ReasoningChain Model 未注入');

    const chain = await this.chainModel.findOne({ chainId: reasoningChainId });
    if (!chain) return null;

    // 获取关联的审核结果
    const review = await this.reviewModel?.findOne({ msgId: chain.msgId });

    return this.evaluate({
      reasoningChainId,
      expertiseApplied: chain.lawyerExpertiseApplied ?? [],
      professionalJudgmentNote: chain.professionalJudgmentNote,
      reviewResult: review
        ? {
            modificationsCount: review.modifications?.length ?? 0,
            supplementsCount: review.supplements?.length ?? 0,
            reviewDuration: review.reviewDuration ?? 0,
          }
        : undefined,
      context: {
        intent: 'legal_reasoning',
        scenario: 'general',
      },
    });
  }

  // ===== 各维度评估方法 =====

  /**
   * 专业性评估：引用的专业知识是否权威、相关
   */
  private evaluateProfessionalism(
    expertiseApplied: ExpertiseAppliedItem[],
    expertiseDetails: Array<{ reliabilityScore?: number; usageCount?: number; verified: boolean }>,
  ): DimensionScore {
    if (expertiseApplied.length === 0) {
      return {
        name: '专业性',
        score: 1.0,
        weight: DIMENSION_WEIGHTS.professionalism,
        justification: '未应用任何律师专业知识，需要增强专业判断整合。',
      };
    }

    // 计算平均可靠性分数
    const reliabilityScores = expertiseDetails.map((d) => d.reliabilityScore ?? 0.7);
    const avgReliability =
      reliabilityScores.reduce((a, b) => a + b, 0) / reliabilityScores.length;

    // 计算覆盖率（覆盖了多少 IRAC 步骤）
    const coveredSteps = new Set(expertiseApplied.map((e) => e.iracStep));
    const coverageRatio = coveredSteps.size / 4; // 4 个 IRAC 步骤

    // 综合评分
    const score = (avgReliability * 0.6 + coverageRatio * 0.4) * 5;

    return {
      name: '专业性',
      score: Math.min(Math.round(score * 100) / 100, 5.0),
      weight: DIMENSION_WEIGHTS.professionalism,
      justification: `应用了 ${expertiseApplied.length} 条专业知识，覆盖 ${coveredSteps.size}/4 个推理步骤，平均可靠性 ${Math.round(avgReliability * 100)}%。`,
    };
  }

  /**
   * 逻辑性评估：专业判断的推理链是否完整
   */
  private evaluateLogicalSoundness(
    expertiseApplied: ExpertiseAppliedItem[],
    judgmentNote?: {
      stepDetails?: Array<{ step: string; expertiseIds: string[]; influenceDescription: string }>;
      significantlyInfluenced: boolean;
    },
  ): DimensionScore {
    if (expertiseApplied.length === 0) {
      return {
        name: '逻辑性',
        score: 1.0,
        weight: DIMENSION_WEIGHTS.logicalSoundness,
        justification: '无专业知识参与，推理逻辑完全依赖 AI。',
      };
    }

    // 检查是否有步骤详情
    if (!judgmentNote?.stepDetails || judgmentNote.stepDetails.length === 0) {
      return {
        name: '逻辑性',
        score: 2.0,
        weight: DIMENSION_WEIGHTS.logicalSoundness,
        justification: '专业判断缺乏步骤详情，推理链条不够清晰。',
      };
    }

    // 评估步骤详情的完整性
    const details = judgmentNote.stepDetails;
    const hasDescriptions = details.filter((d) => d.influenceDescription?.length > 0).length;
    const descriptionRatio = hasDescriptions / details.length;

    // 评分
    const baseScore = 3.0;
    const detailBonus = descriptionRatio * 1.5;
    const influenceBonus = judgmentNote.significantlyInfluenced ? 0.5 : 0;
    const score = Math.min(baseScore + detailBonus + influenceBonus, 5.0);

    return {
      name: '逻辑性',
      score: Math.round(score * 100) / 100,
      weight: DIMENSION_WEIGHTS.logicalSoundness,
      justification: `推理链包含 ${details.length} 个步骤说明，${Math.round(descriptionRatio * 100)}% 的步骤有详细影响描述。`,
    };
  }

  /**
   * 实用性评估：专业建议是否具有实际应用价值
   */
  private evaluatePracticality(
    expertiseApplied: ExpertiseAppliedItem[],
    reviewResult?: { modificationsCount: number; supplementsCount: number; reviewDuration: number },
    context?: { scenario: string },
  ): DimensionScore {
    const scenarioNote = context?.scenario ? `当前场景：${context.scenario}。` : '';

    // 如果有审核结果，评估律师修改的实用性
    if (reviewResult) {
      const totalEdits = reviewResult.modificationsCount + reviewResult.supplementsCount;
      if (totalEdits > 0) {
        // 律师进行了修改，说明专业知识有用
        const editScore = Math.min(3.0 + totalEdits * 0.2, 5.0);
        return {
          name: '实用性',
          score: editScore,
          weight: DIMENSION_WEIGHTS.practicality,
          justification: `${scenarioNote}律师进行了 ${totalEdits} 处修改/补充，说明专业知识在实际应用中具有价值。`,
        };
      }

      // 律师审核通过且无修改
      return {
        name: '实用性',
        score: 3.5,
        weight: DIMENSION_WEIGHTS.practicality,
        justification: `${scenarioNote}律师审核通过，AI 结合专业知识生成的内容无需修改，实用性良好。`,
      };
    }

    // 无审核结果，基于专业知识数量评估
    if (expertiseApplied.length >= 3) {
      return {
        name: '实用性',
        score: 3.8,
        weight: DIMENSION_WEIGHTS.practicality,
        justification: `${scenarioNote}应用了 ${expertiseApplied.length} 条专业知识，理论上应具有较好的实用性。`,
      };
    }

    return {
      name: '实用性',
      score: 2.5,
      weight: DIMENSION_WEIGHTS.practicality,
      justification: `${scenarioNote}应用的专业知识较少，实用性有待提升。`,
    };
  }

  /**
   * 适当性评估：专业判断是否适用于当前场景
   */
  private evaluateAppropriateness(
    expertiseApplied: ExpertiseAppliedItem[],
    context?: { intent: string; scenario: string },
  ): DimensionScore {
    if (expertiseApplied.length === 0 || !context) {
      return {
        name: '适当性',
        score: 3.0,
        weight: DIMENSION_WEIGHTS.appropriateness,
        justification: '无场景匹配数据，给予基础分。',
      };
    }

    // 检查专业知识类型是否与场景匹配
    const relevantTypes = this.getRelevantTypesForScenario(context.scenario);
    const matchingCount = expertiseApplied.filter((e) => relevantTypes.includes(e.expertiseType)).length;
    const matchRatio = matchingCount / expertiseApplied.length;

    const score = 2.0 + matchRatio * 3.0;

    return {
      name: '适当性',
      score: Math.round(score * 100) / 100,
      weight: DIMENSION_WEIGHTS.appropriateness,
      justification: `${Math.round(matchRatio * 100)}% 的专业知识与当前场景 "${context.scenario}" 匹配。`,
    };
  }

  /**
   * 透明度评估：专业判断过程是否可追溯
   */
  private evaluateTransparency(
    expertiseApplied: ExpertiseAppliedItem[],
    judgmentNote?: {
      summary: string;
      stepDetails?: Array<{ step: string; expertiseIds: string[]; influenceDescription: string }>;
    },
  ): DimensionScore {
    if (!judgmentNote) {
      return {
        name: '透明度',
        score: 1.0,
        weight: DIMENSION_WEIGHTS.transparency,
        justification: '无专业判断记录，无法追溯。',
      };
    }

    let score = 3.0;
    const justifications: string[] = [];

    // 有摘要
    if (judgmentNote.summary) {
      score += 0.5;
      justifications.push('包含判断摘要');
    }

    // 有步骤详情
    if (judgmentNote.stepDetails && judgmentNote.stepDetails.length > 0) {
      score += 0.5;
      justifications.push(`包含 ${judgmentNote.stepDetails.length} 个步骤详情`);
    }

    // 有 ID 引用
    const totalExpertiseIds = (judgmentNote.stepDetails ?? []).reduce(
      (sum, d) => sum + d.expertiseIds.length,
      0,
    );
    if (totalExpertiseIds > 0) {
      score += 0.5;
      justifications.push(`引用 ${totalExpertiseIds} 条专业知识 ID`);
    }

    // 每个条目都有应用说明
    const hasNotes = expertiseApplied.filter((e) => e.applicationNote?.length > 0).length;
    const noteRatio = expertiseApplied.length > 0 ? hasNotes / expertiseApplied.length : 0;
    score += noteRatio * 0.5;

    return {
      name: '透明度',
      score: Math.min(Math.round(score * 100) / 100, 5.0),
      weight: DIMENSION_WEIGHTS.transparency,
      justification: justifications.length > 0 ? justifications.join('，') : '基础透明度。',
    };
  }

  // ===== 辅助方法 =====

  /**
   * 获取场景相关的专业知识类型
   */
  private getRelevantTypesForScenario(scenario: string): string[] {
    const scenarioTypeMap: Record<string, string[]> = {
      contract_review: ['practical_rule', 'risk_assessment', 'case_analysis'],
      legal_risk_assessment: ['risk_assessment', 'case_analysis', 'defense_strategy'],
      case_analysis: ['case_analysis', 'argumentation_method', 'defense_strategy'],
      litigation: ['defense_strategy', 'argumentation_method', 'case_analysis'],
      negotiation: ['practical_rule', 'argumentation_method'],
      general: ['case_analysis', 'argumentation_method', 'practical_rule'],
    };

    return scenarioTypeMap[scenario] ?? scenarioTypeMap.general;
  }

  /**
   * 获取专业知识详情
   */
  private async fetchExpertiseDetails(
    expertiseApplied: ExpertiseAppliedItem[],
  ): Promise<Array<{ reliabilityScore?: number; usageCount?: number; verified: boolean }>> {
    const results: Array<{ reliabilityScore?: number; usageCount?: number; verified: boolean }> = [];

    if (!this.lawyerExpertiseService || expertiseApplied.length === 0) {
      return expertiseApplied.map(() => ({ verified: false }));
    }

    for (const item of expertiseApplied) {
      try {
        const detail = await this.lawyerExpertiseService.getByExpertiseId(item.expertiseId);
        results.push({
          reliabilityScore: detail?.reliabilityScore,
          usageCount: detail?.usageCount,
          verified: !!detail,
        });
      } catch {
        results.push({ verified: false });
      }
    }

    return results;
  }

  /**
   * 确定等级
   */
  private determineGrade(score: number): 'A' | 'B' | 'C' | 'D' {
    if (score >= GRADE_THRESHOLDS.A) return 'A';
    if (score >= GRADE_THRESHOLDS.B) return 'B';
    if (score >= GRADE_THRESHOLDS.C) return 'C';
    return 'D';
  }

  /**
   * 生成反馈
   */
  private generateFeedback(
    professionalism: DimensionScore,
    logicalSoundness: DimensionScore,
    practicality: DimensionScore,
    appropriateness: DimensionScore,
    transparency: DimensionScore,
    expertiseApplied: ExpertiseAppliedItem[],
    grade: 'A' | 'B' | 'C' | 'D',
  ): {
    strengths: string[];
    improvements: string[];
    recommendations: string[];
  } {
    const strengths: string[] = [];
    const improvements: string[] = [];
    const recommendations: string[] = [];

    const dimensions = [professionalism, logicalSoundness, practicality, appropriateness, transparency];

    // 识别优势（≥ 4.0）
    for (const dim of dimensions) {
      if (dim.score >= 4.0) {
        strengths.push(`${dim.name}表现优秀（${dim.score}/5.0）`);
      }
    }

    // 识别待改进（< 3.0）
    for (const dim of dimensions) {
      if (dim.score < 3.0) {
        improvements.push(`${dim.name}需要加强（${dim.score}/5.0）`);
      }
    }

    // 生成建议
    if (expertiseApplied.length === 0) {
      recommendations.push('建议在法律推理的每个步骤中都融合律师专业知识');
      recommendations.push('建立针对不同场景的专业知识匹配机制');
    } else if (grade === 'D') {
      recommendations.push('当前专业判断质量不合格，建议重新审查专业知识的选择和应用');
      recommendations.push('考虑引入资深律师进行人工审核和调整');
    } else if (grade === 'C') {
      recommendations.push('专业判断基础合格，可以进一步提升专业知识的覆盖范围和深度');
      recommendations.push('收集更多律师反馈以优化专业知识融合算法');
    } else if (grade === 'B') {
      recommendations.push('专业判断融合良好，可通过增加更多场景相关的专业知识进一步提升');
      recommendations.push('优化专业知识的应用说明，提高透明度');
    } else {
      recommendations.push('专业判断质量优秀，建议持续监控和更新专业知识库');
      recommendations.push('考虑将成功案例作为标准范例纳入培训体系');
    }

    return { strengths, improvements, recommendations };
  }
}
