/**
 * 预发布审核 Schema（v3.0 新增）。
 *
 * 用途：支持 AI 生成的法律意见在交付用户前由律师进行实时审核、修改和补充，
 *       实现真正的人机协同工作流程。区别于事后抽样的 lawyer_review，
 *       pre_publish_review 是在 AI 回答生成后、用户获取前的即时审核环节。
 *
 * 工作流状态机：
 *   pending → claimed → reviewing → approved/rejected
 *      ↓         ↓          ↓
 *   timeout   timeout    escalated
 *
 * 触发条件：
 *   - case_reasoning 意图（法律推理类）：100% 进入预发布审核
 *   - document_generate 意图（文书生成类）：100% 进入预发布审核
 *   - 用户指定"需要律师审核"的请求：100% 进入
 *   - 其他高风险意图：可配置
 *
 * 索引：idx_reviewId（唯一）、idx_msgId（唯一）、idx_state（待处理队列）
 *
 * 设计依据：用户需求 3（人机协同工作流）；v3.0 AI 律师系统升级。
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

// ===== 子文档类型 =====

/** AI 生成的初步法律意见 */
export interface AiGeneratedOpinion {
  /** 摘要 */
  summary: string;
  /** 详细分析 */
  analysis: string;
  /** 引用法条 */
  lawRefs: string[];
  /** 置信度 0-1 */
  confidence: number;
  /** 风险等级 */
  riskLevel: string;
  /** 关联 reasoningChainId */
  reasoningChainId?: string;
}

/** 律师修改标注 */
export interface LawyerModification {
  /** 修改类型：approve / edit / supplement / reject */
  type: 'approve' | 'edit' | 'supplement' | 'reject';
  /** 修改的字段路径（如 conclusion.summary / rules[0].conditions） */
  fieldPath?: string;
  /** 原始内容 */
  originalContent?: string;
  /** 修改后内容 */
  modifiedContent?: string;
  /** 修改说明 */
  modificationNote?: string;
  /** 引用的律师专业知识 ID（lawyer_expertise） */
  appliedExpertiseIds?: string[];
}

/** 律师补充的专业意见 */
export interface LawyerSupplement {
  /** 补充类型：additional_analysis / risk_warning / alternative_argument / practical_advice */
  supplementType: string;
  /** 补充内容 */
  content: string;
  /** 引用的法律依据 */
  lawRefs?: string[];
  /** 引用的律师专业知识 ID */
  expertiseIds?: string[];
}

/** 最终交付给用户的法律意见 */
export interface FinalOpinion {
  /** 最终摘要（可能包含律师修改） */
  summary: string;
  /** 最终分析（AI + 律师修改/补充） */
  analysis: string;
  /** 律师添加的专业意见 */
  lawyerSupplements: LawyerSupplement[];
  /** 引用法条（含律师补充的） */
  lawRefs: string[];
  /** 最终置信度（律师可能调整） */
  confidence: number;
  /** 最终风险等级 */
  riskLevel: string;
  /** 律师署名（可选） */
  lawyerSignature?: string;
  /** 专业判断应用说明 */
  judgmentAppliedNote?: string;
}

/** 预发布审核状态机状态 */
export type PrePublishReviewState = 'pending' | 'claimed' | 'reviewing' | 'approved' | 'rejected' | 'escalated';

@Schema({
  collection: 'pre_publish_review',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
})
export class PrePublishReview {
  /** 业务 ID（唯一，ppr_<uuid>） */
  @Prop({ required: true, unique: true, index: true })
  reviewId!: string;

  /** 关联消息 ID（唯一） */
  @Prop({ required: true, unique: true, index: true })
  msgId!: string;

  /** 关联用户 ID */
  @Prop({ required: true, index: true })
  userId!: string;

  /** 触发意图 */
  @Prop({ required: true })
  intent!: string;

  /** 触发场景：auto / user_request / manual */
  @Prop({ default: 'auto' })
  triggerSource?: string;

  /** AI 生成的初步意见 */
  @Prop({ type: Object, required: true })
  aiOpinion!: AiGeneratedOpinion;

  /** 状态机 */
  @Prop({ required: true, default: 'pending' })
  state!: string;

  /** 领取律师 ID */
  @Prop()
  claimedBy?: string;

  @Prop({ type: Date })
  claimedAt?: Date;

  /** 律师修改记录 */
  @Prop({ type: [Object], default: [] })
  modifications?: LawyerModification[];

  /** 律师补充的专业意见 */
  @Prop({ type: [Object], default: [] })
  supplements?: LawyerSupplement[];

  /** 最终交付意见（approved 后填充） */
  @Prop({ type: Object })
  finalOpinion?: FinalOpinion;

  /** 律师审核备注 */
  @Prop()
  reviewNote?: string;

  /** 律师耗时 ms */
  @Prop({ type: Number })
  reviewDuration?: number;

  /** 升级标记（复杂案件需要资深律师） */
  @Prop({ default: false })
  escalated?: boolean;

  /** 升级原因 */
  @Prop()
  escalationReason?: string;

  /** 优先级（1-5，1最高） */
  @Prop({ default: 3 })
  priority?: number;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export type PrePublishReviewDocument = HydratedDocument<PrePublishReview>;
export const PrePublishReviewSchema = SchemaFactory.createForClass(PrePublishReview);

// 索引
PrePublishReviewSchema.index({ state: 1, priority: -1, createdAt: 1 }, { name: 'idx_state_priority_created' });
PrePublishReviewSchema.index({ claimedBy: 1, state: 1 }, { name: 'idx_claimed_state' });
