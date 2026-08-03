/**
 * IRAC 推理链 Schema（v2.3-W5，05 3.28 reasoning_chain 集合）。
 *
 * 用途：IracReasonerService 持久化推理链，支持事后审计、律师复核、误判归因。
 *
 * 字段对齐 05 3.28：
 *   - chainId：业务 ID（唯一，rc_<uuid>）
 *   - msgId / userId：关联消息与用户
 *   - issues[]：争议点列表（Issue）
 *   - rules[]：法条规则列表（Rule）
 *   - applications[]：事实映射列表（Application）
 *   - conclusion：综合结论（Conclusion）
 *   - modelVersion / promptVersion：模型与 Prompt 版本（溯源）
 *   - lawyerCorrected：律师修正标记（回流时为 true）
 *   - expireAt：TTL 180 天
 *
 * 索引：idx_chainId（唯一）、idx_msgId（查消息推理链）、idx_userId_createdAt、TTL 180 天
 *
 * 设计依据：05 3.28 reasoning_chain；16 §6 推理链持久化；17 第六节 律师标注回流。
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

// ===== 子文档类型（与 reasoning.types.ts 同构，独立声明避免循环依赖）=====

/** 争议点（Schema 子文档） */
export interface ReasoningIssue {
  issueText: string;
  issueType: string;
  relatedLaws: string[];
}

/** 法条规则（Schema 子文档） */
export interface ReasoningRule {
  articleId: string;
  articleText: string;
  conditions: string[];
  legalConsequences: string[];
}

/** 事实映射（Schema 子文档） */
export interface ReasoningApplication {
  ruleId: string;
  /** applicable / partial / false */
  factMatch: string;
  matchedFacts: string[];
  unmatchedFacts: string[];
}

/** 综合结论（Schema 子文档） */
export interface ReasoningConclusion {
  summary: string;
  /** 置信度 0-1 */
  confidence: number;
  /** low / medium / high */
  riskLevel: string;
  disclaimer: string;
  lawRefs: string[];
}

@Schema({
  collection: 'reasoning_chain',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
})
export class ReasoningChain {
  /** 业务 ID（唯一，rc_<uuid>） */
  @Prop({ required: true, unique: true, index: true })
  chainId!: string;

  @Prop({ required: true, index: true })
  msgId!: string;

  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ type: Array, default: [] })
  issues!: ReasoningIssue[];

  @Prop({ type: Array, default: [] })
  rules!: ReasoningRule[];

  @Prop({ type: Array, default: [] })
  applications!: ReasoningApplication[];

  @Prop({ type: Object, required: true })
  conclusion!: ReasoningConclusion;

  /** 模型版本（如 qwen-max-2026q2），溯源用 */
  @Prop()
  modelVersion?: string;

  /** Prompt 版本（如 irac-v1.0-2026q3），溯源用 */
  @Prop({ required: true })
  promptVersion!: string;

  /** 律师修正标记（LawyerAnnotationService 回流时置 true，17 §6.2） */
  @Prop({ default: false })
  lawyerCorrected?: boolean;

  /** TTL 180 天（05 3.28 expireAt: createdAt + 180 天） */
  @Prop({ type: Date, expires: 180 * 24 * 3600 })
  expireAt!: Date;

  @Prop()
  createdAt?: Date;

  /** 声明以便 lean() 类型包含（timestamps 选项字段须显式声明） */
  @Prop()
  updatedAt?: Date;
}

export type ReasoningChainDocument = HydratedDocument<ReasoningChain>;
export const ReasoningChainSchema = SchemaFactory.createForClass(ReasoningChain);
