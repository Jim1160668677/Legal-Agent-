/**
 * AI 回答溯源 Schema（v2.3 阶段十，05 3.34 answer_traceability 集合）。
 *
 * 用途：AnswerTracer 持久化每条 AI 回答的全链路溯源元数据，
 * 支持事后审计、律师复核、误判归因与合规核查。
 *
 * 字段对齐 05 3.34 + 17 第四节：
 *   - msgId：对话消息 ID（主键，唯一）
 *   - userId / intent：关联用户与意图
 *   - citedLaws[]：引用法条（含 verified 状态）
 *   - citedCases[]：引用案例
 *   - promptVersion / modelVersion：Prompt 与模型版本（溯源）
 *   - reasoningChainId：推理链 ID（case_reasoning 意图）
 *   - ragSources[]：RAG 召回来源
 *   - autoScore：自动评分（AnswerQualityScorer 实时计算）
 *   - lawyerReviewId：关联律师审核 ID（入审后填充）
 *   - expireAt：TTL 180 天
 *
 * 索引：idx_msgId（唯一）、idx_userId_createdAt、TTL 180 天
 *
 * 设计依据：05 3.34 answer_traceability；17 §4 AI 回答溯源；17 §4.2 溯源字段。
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

// ===== 子文档类型 =====

/** 引用法条（含校验状态） */
export interface CitedLaw {
  /** 法条引用（如"民法典第143条"） */
  ref: string;
  /** 是否已核实（LawRef.verified） */
  verified: boolean;
}

/** 引用案例 */
export interface CitedCase {
  caseId: string;
  caseTitle?: string;
}

/** RAG 召回来源 */
export interface RagSource {
  docId: string;
  score: number;
  collection: string;
}

@Schema({
  collection: 'answer_traceability',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
})
export class AnswerTraceability {
  /** 对话消息 ID（主键，唯一） */
  @Prop({ required: true, unique: true, index: true })
  msgId!: string;

  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true })
  intent!: string;

  /** 引用法条列表（含 verified 状态） */
  @Prop({ type: Array, default: [] })
  citedLaws!: CitedLaw[];

  /** 引用案例列表 */
  @Prop({ type: Array, default: [] })
  citedCases!: CitedCase[];

  /** Prompt 版本（如 irac-v1.0-2026q3） */
  @Prop()
  promptVersion?: string;

  /** 模型版本（如 qwen-max-2026q2） */
  @Prop()
  modelVersion?: string;

  /** 推理链 ID（case_reasoning 意图，引用 reasoning_chain 集合） */
  @Prop()
  reasoningChainId?: string;

  /** RAG 召回来源列表 */
  @Prop({ type: Array, default: [] })
  ragSources!: RagSource[];

  /** 自动评分（0-5，AnswerQualityScorer 实时计算） */
  @Prop({ required: true, default: 0 })
  autoScore!: number;

  /** 关联律师审核 ID（入审后填充） */
  @Prop()
  lawyerReviewId?: string;

  /** TTL 180 天（05 3.34 expireAt: createdAt + 180 天） */
  @Prop({ type: Date, expires: 180 * 24 * 3600 })
  expireAt!: Date;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export type AnswerTraceabilityDocument = HydratedDocument<AnswerTraceability>;
export const AnswerTraceabilitySchema = SchemaFactory.createForClass(AnswerTraceability);

AnswerTraceabilitySchema.index({ userId: 1, createdAt: -1 }, { name: 'idx_userId_createdAt' });
