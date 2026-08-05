/**
 * 律师专业知识库 Schema（v3.0 新增）。
 *
 * 用途：存储资深律师的案例分析、法律论证方法、实务经验、风险判断规则等专业知识，
 *       供 IracReasonerService 在推理过程中融合律师专业判断使用。
 *
 * 知识类型（expertiseType）：
 *   - case_analysis：案例分析（包含争议焦点、裁判要旨、律师评析）
 *   - argumentation_method：法律论证方法（如"三段论""利益衡量""类推适用"等方法论）
 *   - practical_rule：实务经验规则（如"劳动争议仲裁时效1年，起算点从离职之日"）
 *   - risk_assessment：风险判断要点（如"合同审查中违约金比例上限通常为30%"）
 *   - defense_strategy：辩护策略（如"刑事辩护中自首认定的三个要件及辩护思路"）
 *
 * 应用场景（scenarioTags）：
 *   - contract_review：合同审查
 *   - risk_assessment：法律风险评估
 *   - case_analysis：案例分析
 *   - litigation_strategy：诉讼策略
 *   - legal_consultation：法律咨询
 *   - document_review：文书审查
 *
 * 索引：idx_expertiseId（唯一）、idx_type_scenario（类型+场景复合）、idx_issueType（按案由类型）
 *
 * 设计依据：用户需求 1-5（律师专业判断深度整合）；v3.0 AI 律师系统升级。
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

// ===== 子文档类型 =====

/** 律师专业知识引用来源 */
export interface ExpertiseSource {
  /** 来源类型：court_case / law_review / practice_note / training_material */
  type: string;
  /** 来源标题（如(2023)京01民初1234号判决书） */
  title: string;
  /** 来源链接或存档 ID */
  reference?: string;
}

/** 律师专业判断的应用条件 */
export interface ExpertiseCondition {
  /** 适用的争议点类型（如 contract_dispute / tort 等） */
  issueTypes: string[];
  /** 适用的事实特征关键词 */
  factKeywords?: string[];
  /** 适用的法律领域 */
  legalAreas?: string[];
}

/** 律师专业知识的论证结构 */
export interface ExpertiseArgument {
  /** 论证方法名称（如"利益衡量""比例原则""类推适用"） */
  method: string;
  /** 论证步骤 */
  steps: string[];
  /** 关键考量因素 */
  keyConsiderations?: string[];
}

/** 实际应用示例 */
export interface ExpertiseExample {
  /** 示例标题 */
  title: string;
  /** 示例事实简述 */
  facts: string;
  /** 律师分析过程 */
  analysis: string;
  /** 结论或建议 */
  conclusion: string;
}

/** 专业判断质量记录（被引用时记录） */
export interface ExpertiseUsageRecord {
  /** 引用时间 */
  usedAt: Date;
  /** 引用场景 ID（如 reasoningChainId） */
  contextId: string;
  /** 应用的推理步骤（issue/rule/application/conclusion） */
  iracStep: string;
  /** 应用效果评分（由律师事后评估，1-5） */
  effectivenessScore?: number;
}

/** 律师专业知识类型枚举 */
export type ExpertiseType =
  | 'case_analysis'
  | 'argumentation_method'
  | 'practical_rule'
  | 'risk_assessment'
  | 'defense_strategy';

/** 应用场景标签枚举 */
export type ExpertiseScenario =
  | 'contract_review'
  | 'risk_assessment'
  | 'case_analysis'
  | 'litigation_strategy'
  | 'legal_consultation'
  | 'document_review';

@Schema({
  collection: 'lawyer_expertise',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
})
export class LawyerExpertise {
  /** 业务 ID（唯一，le_<uuid>） */
  @Prop({ required: true, unique: true, index: true })
  expertiseId!: string;

  /** 知识类型 */
  @Prop({
    required: true,
    type: String,
    enum: ['case_analysis', 'argumentation_method', 'practical_rule', 'risk_assessment', 'defense_strategy'],
    index: true,
  })
  expertiseType!: string;

  /** 知识标题 */
  @Prop({ required: true })
  title!: string;

  /** 知识内容（Markdown 格式） */
  @Prop({ required: true, type: String })
  content!: string;

  /** 应用场景标签（可多选） */
  @Prop({ type: [String], default: [], index: true })
  scenarioTags!: string[];

  /** 适用条件 */
  @Prop({ type: Object })
  conditions?: ExpertiseCondition;

  /** 论证结构（argumentation_method / defense_strategy 类型必填） */
  @Prop({ type: Object })
  argument?: ExpertiseArgument;

  /** 应用示例 */
  @Prop({ type: [Object], default: [] })
  examples?: ExpertiseExample[];

  /** 引用来源 */
  @Prop({ type: [Object], default: [] })
  sources?: ExpertiseSource[];

  /** 关联法条 ID 列表 */
  @Prop({ type: [String], default: [] })
  relatedLawIds?: string[];

  /** 关联案例 ID 列表 */
  @Prop({ type: [String], default: [] })
  relatedCaseIds?: string[];

  /** 贡献律师 ID */
  @Prop({ required: true, index: true })
  contributedBy!: string;

  /** 贡献律师姓名（冗余存储，便于展示） */
  @Prop()
  contributorName?: string;

  /** 专业领域标签（如"合同法""劳动法""刑法"） */
  @Prop({ type: [String], default: [] })
  practiceAreas?: string[];

  /** 可信度评分（0-1，根据应用效果动态调整） */
  @Prop({ default: 0.8 })
  reliabilityScore?: number;

  /** 被引用次数 */
  @Prop({ default: 0 })
  usageCount?: number;

  /** 使用记录（最近 100 条，用于效果分析） */
  @Prop({ type: [Object], default: [] })
  usageHistory?: ExpertiseUsageRecord[];

  /** 审核状态：pending / approved / rejected */
  @Prop({ default: 'approved' })
  reviewStatus?: string;

  /** 审核备注 */
  @Prop()
  reviewNote?: string;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export type LawyerExpertiseDocument = HydratedDocument<LawyerExpertise>;
export const LawyerExpertiseSchema = SchemaFactory.createForClass(LawyerExpertise);

// 复合索引：按类型+场景查询
LawyerExpertiseSchema.index({ expertiseType: 1, scenarioTags: 1 }, { name: 'idx_type_scenario' });
LawyerExpertiseSchema.index({ practiceAreas: 1, expertiseType: 1 }, { name: 'idx_practice_type' });
// 全文检索辅助索引（标题+内容）
LawyerExpertiseSchema.index({ title: 'text', content: 'text' }, { name: 'idx_text_search' });
