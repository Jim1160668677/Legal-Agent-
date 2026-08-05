/**
 * IRAC 推理链 Schema（v3.0 增强版）。
 *
 * 用途：IracReasonerService 持久化推理链，支持事后审计、律师复核、误判归因，
 *       以及律师专业判断融合追踪。
 *
 * v3.0 增强：
 *   - 新增 lawyerExpertiseApplied 字段，记录每个 IRAC 步骤中引用的律师专业知识
 *   - 新增 professionalJudgmentNote 字段，说明律师专业判断如何影响推理结果
 *   - 新增 reasoningTrace 字段，支持推理过程可视化展示
 *
 * 字段对齐：
 *   - chainId：业务 ID（唯一，rc_<uuid>）
 *   - msgId / userId：关联消息与用户
 *   - issues[]：争议点列表（Issue）
 *   - rules[]：法条规则列表（Rule）
 *   - applications[]：事实映射列表（Application）
 *   - conclusion：综合结论（Conclusion）
 *   - lawyerExpertiseApplied：各步骤引用的律师专业知识
 *   - professionalJudgmentNote：专业判断应用说明
 *   - modelVersion / promptVersion：模型与 Prompt 版本（溯源）
 *   - lawyerCorrected：律师修正标记（回流时为 true）
 *   - expireAt：TTL 180 天
 *
 * 索引：idx_chainId（唯一）、idx_msgId（查消息推理链）、idx_userId_createdAt、TTL 180 天
 *
 * 设计依据：05 3.28 reasoning_chain；16 §6 推理链持久化；17 第六节 律师标注回流；
 *           v3.0 律师专业判断深度整合需求。
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
  /** 时效状态：effective / repealed / amended */
  status?: string;
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

/** 律师专业知识应用记录（v3.0 新增） */
export interface ExpertiseAppliedItem {
  /** 引用的律师专业知识 ID */
  expertiseId: string;
  /** 知识标题（冗余，便于展示） */
  expertiseTitle: string;
  /** 知识类型 */
  expertiseType: string;
  /** 在哪个 IRAC 步骤引用 */
  iracStep: 'issue' | 'rule' | 'application' | 'conclusion';
  /** 应用方式说明（如"补充了遗漏的争议点""提供了法条适用的经验规则"） */
  applicationNote: string;
  /** 对推理结果的影响程度（0-1） */
  influenceScore: number;
  /** 引用来源（如"系统自动匹配""律师手动添加"） */
  source: 'auto_matched' | 'lawyer_added' | 'user_requested';
}

/** 推理追踪节点（v3.0 新增，用于可视化） */
export interface ReasoningTraceNode {
  /** 节点 ID */
  nodeId: string;
  /** 节点类型：issue / rule / application / conclusion / expertise_injected */
  nodeType: string;
  /** 节点标题 */
  title: string;
  /** 节点内容摘要 */
  content: string;
  /** 关联的法条 ID */
  lawRefs?: string[];
  /** 关联的律师专业知识 ID */
  expertiseIds?: string[];
  /** 前置节点 ID */
  parentNodeId?: string;
  /** 执行顺序 */
  order: number;
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

  /** 律师专业知识应用记录（v3.0 新增） */
  @Prop({ type: [Object], default: [] })
  lawyerExpertiseApplied?: ExpertiseAppliedItem[];

  /** 专业判断应用说明（v3.0 新增）：描述律师专业判断如何影响推理结果 */
  @Prop({ type: Object })
  professionalJudgmentNote?: {
    /** 总体说明 */
    summary: string;
    /** 各步骤影响详情 */
    stepDetails?: Array<{
      step: string;
      expertiseIds: string[];
      influenceDescription: string;
    }>;
    /** 是否显著影响最终结论 */
    significantlyInfluenced: boolean;
  };

  /** 推理追踪节点（v3.0 新增，用于可视化展示推理过程） */
  @Prop({ type: [Object], default: [] })
  reasoningTrace?: ReasoningTraceNode[];

  /** 是否经过预发布审核（v3.0 新增） */
  @Prop({ default: false })
  prePublishReviewed?: boolean;

  /** 关联的预发布审核 ID（v3.0 新增） */
  @Prop()
  prePublishReviewId?: string;

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
