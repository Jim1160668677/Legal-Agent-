/**
 * 律师审核 Schema（v2.3 阶段十，05 3.33 lawyer_review 集合）。
 *
 * 用途：LawyerReviewService 状态机持久化（pending→claimed→reviewing→submitted→reflowed），
 * 支持律师领取、标注、提交、回流全流程。
 *
 * 字段对齐 05 3.33 + 17 第二节：
 *   - reviewId：业务 ID（唯一）
 *   - msgId / userId：关联消息与用户
 *   - intent / riskLevel：抽样来源标记
 *   - state：状态机 5 态
 *   - sampledAt / claimedBy / claimedAt：抽样与领取信息
 *   - annotations：律师标注（submitted 后填充，含四维评分 + 文本纠错）
 *   - reflowTargets：回流目标列表（reflowed 后填充）
 *   - expireAt：TTL 365 天
 *
 * 索引：idx_reviewId（唯一）、idx_msgId（唯一）、idx_state_claimedBy（待审队列）、idx_userId_createdAt、TTL 365 天
 *
 * 设计依据：05 3.33 lawyer_review；17 §2 律师审核工作流；17 §2.4 标注字段。
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

// ===== 子文档类型 =====

/** 律师标注的四维评分（1-5 分） */
export interface LawyerReviewScores {
  /** 准确性：法条引用与法律结论正确性 */
  accuracy: number;
  /** 完整性：是否遗漏关键争议点/法条/救济途径 */
  completeness: number;
  /** 合规性：是否符合执业规范与免责要求 */
  compliance: number;
  /** 实用性：对用户实际问题的可操作性 */
  usefulness: number;
}

/** 引用纠错项 */
export interface CitationError {
  lawRef: string;
  errorType: string;
  correction: string;
}

/** 事实订正项 */
export interface FactCorrection {
  segment: string;
  correction: string;
}

/** 推理链缺陷项 */
export interface ReasoningFlaw {
  step: string;
  flaw: string;
  suggestion: string;
}

/** 律师标注（submitted 后填充） */
export interface LawyerReviewAnnotations {
  scores: LawyerReviewScores;
  textAnnotations?: {
    citationErrors?: CitationError[];
    factCorrections?: FactCorrection[];
    reasoningFlaws?: ReasoningFlaw[];
    generalComment?: string;
  };
  /** 风险标记：none / low / high（high 同步触发 compliance_alert） */
  riskFlag: 'none' | 'low' | 'high';
  /** 律师 userId */
  reviewedBy: string;
  reviewedAt: Date;
  /** 审核耗时 ms */
  duration: number;
}

/** 律师审核状态机 5 态 */
export type LawyerReviewState = 'pending' | 'claimed' | 'reviewing' | 'submitted' | 'reflowed';

/** 抽样来源（风险等级） */
export type LawyerReviewRiskLevel = 'high' | 'normal' | 'user_flagged';

@Schema({
  collection: 'lawyer_review',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
})
export class LawyerReview {
  /** 业务 ID（唯一，lr_<uuid>） */
  @Prop({ required: true, unique: true, index: true })
  reviewId!: string;

  @Prop({ required: true, unique: true, index: true })
  msgId!: string;

  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true })
  intent!: string;

  /** 抽样来源：high（高风险 100%）/ normal（5% 随机）/ user_flagged（用户标记 100%） */
  @Prop({ required: true })
  riskLevel!: string;

  /** 状态机：pending / claimed / reviewing / submitted / reflowed */
  @Prop({ required: true, default: 'pending' })
  state!: string;

  @Prop({ required: true, type: Date })
  sampledAt!: Date;

  /** 领取律师 userId */
  @Prop()
  claimedBy?: string;

  @Prop({ type: Date })
  claimedAt?: Date;

  /** 律师标注（submitted 后填充） */
  @Prop({ type: Object })
  annotations?: LawyerReviewAnnotations;

  /** 回流目标列表（reflowed 后填充，如 ['intent_eval_set', 'reasoning_chain', 'law_article', 'feedback']） */
  @Prop({ type: [String], default: [] })
  reflowTargets?: string[];

  /** TTL 365 天（05 3.33 expireAt: createdAt + 365 天） */
  @Prop({ type: Date, expires: 365 * 24 * 3600 })
  expireAt!: Date;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export type LawyerReviewDocument = HydratedDocument<LawyerReview>;
export const LawyerReviewSchema = SchemaFactory.createForClass(LawyerReview);

// 复合索引：待审队列查询（state + claimedBy）
LawyerReviewSchema.index({ state: 1, claimedBy: 1 }, { name: 'idx_state_claimedBy' });
LawyerReviewSchema.index({ userId: 1, createdAt: -1 }, { name: 'idx_userId_createdAt' });
