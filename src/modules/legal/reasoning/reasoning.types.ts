/**
 * ReasoningModule 类型定义与常量（v2.3-W5，16 §2-§5）。
 *
 * 涵盖：
 *   - IRAC 推理：Issue / Rule / Application / Conclusion / IracReasonInput / IracReasonResult
 *   - 法条适用判定：FactMatch / ConditionMatch / ParsedArticle / LawApplicationInput / LawApplicationResult
 *   - 案情相似度：FactAttributes / FactSimilarityInput / FactSimilarityResult
 *   - 案例对比：CaseComparison / CaseCompareInput / CaseCompareResult
 *   - 常量：ISSUE_TYPES / ISSUE_KEYWORD_MAP / RISK_LEVELS / SIMILARITY_THRESHOLDS
 *           IRAC_PROMPT_VERSION / IRAC_DISCLAIMER_SUFFIX / REASONING_ERROR_CODES
 *
 * 设计依据：16 §2-§5；07 §9。
 */

// ===== Issue 类型枚举（16 §2.1）=====

export type IssueType =
  | 'contract_dispute'
  | 'tort'
  | 'property'
  | 'family'
  | 'labor'
  | 'criminal'
  | 'administrative'
  | 'other';

/** 支持的 IssueType 枚举值列表 */
export const ISSUE_TYPES: IssueType[] = [
  'contract_dispute',
  'tort',
  'property',
  'family',
  'labor',
  'criminal',
  'administrative',
  'other',
];

/** 关键词 → IssueType 映射（用于 LLM 失败时降级识别） */
export const ISSUE_KEYWORD_MAP: Record<string, IssueType> = {
  合同: 'contract_dispute',
  违约: 'contract_dispute',
  租赁: 'contract_dispute',
  侵权: 'tort',
  损害: 'tort',
  赔偿: 'tort',
  物权: 'property',
  所有权: 'property',
  婚姻: 'family',
  离婚: 'family',
  抚养: 'family',
  劳动: 'labor',
  工伤: 'labor',
  工资: 'labor',
  刑事: 'criminal',
  犯罪: 'criminal',
  行政: 'administrative',
  处罚: 'administrative',
};

// ===== 风险等级（16 §2.4）=====

export type RiskLevel = 'low' | 'medium' | 'high';

/** 支持的 RiskLevel 枚举值列表 */
export const RISK_LEVELS: RiskLevel[] = ['low', 'medium', 'high'];

// ===== IRAC 推理结构（16 §2.1-2.4）=====

/** Issue：争议点 */
export interface Issue {
  issueText: string;
  issueType: IssueType;
  relatedLaws: string[];
}

/** Rule：法条规则 */
export interface Rule {
  articleId: string;
  articleText: string;
  /** 构成要件（条件） */
  conditions: string[];
  /** 法律后果 */
  legalConsequences: string[];
  /** 时效状态 */
  status?: 'effective' | 'repealed' | 'amended';
}

/** Application：事实映射 */
export interface Application {
  ruleId: string;
  factMatch: FactMatch;
  matchedFacts: string[];
  unmatchedFacts: string[];
}

/** Conclusion：综合结论 */
export interface Conclusion {
  summary: string;
  /** 置信度 0-1 */
  confidence: number;
  riskLevel: RiskLevel;
  disclaimer: string;
  lawRefs: string[];
}

/** IRAC 推理入参 */
export interface IracReasonInput {
  caseDescription: string;
  question?: string;
  entities?: Entity[];
  /** 编排器并行召回的上下文 */
  retrievedContext?: string;
  ctx: {
    userId: string;
    msgId: string;
    traceId?: string;
    expectedVerdict?: string;
  };
}

/** IRAC 推理结果 */
export interface IracReasonResult {
  issues: Issue[];
  rules: Rule[];
  applications: Application[];
  conclusion: Conclusion;
  reasoningChainId?: string;
  /** 降级标记：none / llm_unavailable / application_skipped */
  degraded: 'none' | 'llm_unavailable' | 'application_skipped';
  warnings: string[];
  modelVersion?: string;
  promptVersion: string;
  tokensIn: number;
  tokensOut: number;
  /** v3.0 新增：应用的律师专业知识 */
  expertiseApplied?: Array<{
    expertiseId: string;
    expertiseTitle: string;
    expertiseType: string;
    iracStep: string;
    applicationNote: string;
    influenceScore: number;
    source: string;
  }>;
  /** v3.0 新增：专业判断应用说明 */
  professionalJudgmentNote?: {
    summary: string;
    stepDetails: Array<{
      step: string;
      expertiseIds: string[];
      influenceDescription: string;
    }>;
    significantlyInfluenced: boolean;
  };
}

// ===== 法条适用判定（16 §4）=====

/** 法条适用判定结果：适用 / 部分适用 / 不适用 */
export type FactMatch = 'applicable' | 'partial' | 'false';

/** 单要件匹配结果 */
export type ConditionMatch = 'yes' | 'no' | 'partial';

/** 已解析的法条结构（含构成要件与法律后果） */
export interface ParsedArticle {
  /** 法条 ID（extractConditions 阶段可缺省） */
  articleId?: string;
  /** 法条文本（extractConditions 阶段可缺省） */
  articleText?: string;
  conditions: string[];
  legalConsequences: string[];
  /** 解析来源：structured（结构化字段）/ llm（LLM 抽取）/ fallback（兜底）/ failed（抽取失败） */
  parseSource?: 'structured' | 'llm' | 'fallback' | 'failed';
}

/** 法条适用判定入参 */
export interface LawApplicationInput {
  rule: Rule | ParsedArticle;
  factEntities: Entity[];
  caseDescription?: string;
  /** v3.0 新增：律师专业知识注入提示 */
  expertiseContext?: string;
}

/** 法条适用判定结果 */
export interface LawApplicationResult {
  factMatch: FactMatch;
  matchedFacts: string[];
  unmatchedFacts: string[];
  /** 降级错误码（8019：构成要件抽取失败，降级为 LLM 整体判定） */
  degradedCode?: number;
  warnings: string[];
}

// ===== 案情相似度（16 §3）=====

/** 案情属性（用于加权 Jaccard 相似度计算） */
export interface FactAttributes {
  /** 案由（权重 0.4） */
  causeOfAction?: string;
  /** 当事人角色（权重 0.2） */
  partyRoles?: string[];
  /** 争议金额（权重 0.2） */
  disputeAmount?: string;
  /** 时间线（权重 0.2） */
  timeline?: string;
}

/** 案情相似度计算入参 */
export interface FactSimilarityInput {
  textA: string;
  entitiesA?: Entity[];
  textB: string;
  /** 案例 B 已有的结构化属性 */
  attributesB?: FactAttributes;
}

/** 案情相似度计算结果 */
export interface FactSimilarityResult {
  /** 综合相似度 ∈ [0, 1] */
  similarity: number;
  /** 归一化后的余弦相似度 ∈ [0, 1]（原始 [-1,1] 经 (cos+1)/2 归一化） */
  cosSim?: number;
  /** 加权 Jaccard 属性相似度 ∈ [0, 1] */
  jaccardSim?: number;
  /** 实际使用的 embedding 权重 */
  embeddingWeight?: number;
  /** 实际使用的 attributes 权重 */
  attributesWeight?: number;
  warnings: string[];
}

// ===== 案例对比（16 §5）=====

/** 案例对比单项 */
export interface CaseComparison {
  caseId: string;
  /** 案例标题（可选，展示用） */
  caseTitle?: string;
  /** 与用户案情的相似度 */
  similarity: number;
  /** 共同事实（交集） */
  sharedFacts: string[];
  /** 差异事实（差集） */
  diffFacts: string[];
  /** 判决差异描述（如"案例判决与用户预期一致：原告胜诉"），无预期时为 undefined */
  verdictDiff?: string;
  /** 案例判决结果标签（展示用） */
  outcomeLabel?: string;
}

/** 案例对比入参 */
export interface CaseCompareInput {
  userFacts: {
    text: string;
    entities?: Entity[];
    expectedVerdict?: string;
  };
  /** 候选案例（缺失时由 RagService 召回 top 3） */
  cases?: Array<{
    caseId: string;
    caseTitle?: string;
    content: string;
    causeOfAction?: string;
    category?: string;
    outcomeLabel?: string;
    keywords?: string[];
  }>;
}

/** 案例对比结果 */
export interface CaseCompareResult {
  comparison: CaseComparison[];
  totalCases: number;
  warnings: string[];
}

// ===== 相似度阈值（16 §3.3）=====

export const SIMILARITY_THRESHOLDS = {
  /** 案情相似度阈值：低于此值视为不相似，跳过对比 */
  caseSimilarity: 0.5,
  /** 弱相似度阈值（同 caseSimilarity，案例对比过滤用） */
  WEAK: 0.5,
  /** 高置信度阈值（16 §2.4） */
  highConfidence: 0.8,
  /** 中置信度阈值 */
  mediumConfidence: 0.5,
} as const;

// ===== Prompt 版本与免责声明（16 §2.4 + 07 §五）=====

/** IRAC 推理 Prompt 版本（用于溯源 answer_traceability.promptVersion） */
export const IRAC_PROMPT_VERSION = 'irac-v1.0-2026q3';

/** IRAC 推理强制免责声明后缀 */
export const IRAC_DISCLAIMER_SUFFIX =
  '本推理结论基于 AI 对法条与案情的分析，仅供参考，不构成法律意见。具体案件请咨询执业律师。';

// ===== 推理错误码（16 §4.3）=====

export const REASONING_ERROR_CODES = {
  /** 8019：法条适用判定要件不足（构成要件抽取失败，降级为 LLM 整体判定） */
  INSUFFICIENT_CONDITIONS: 8019,
  /** 8019 别名：法条适用判定要件不足（旧命名，向后兼容） */
  INSUFFICIENT_LAW_APPLY: 8019,
  /** 8020：IRAC 推理失败（LLM 全失败，降级为仅返回召回结果） */
  IRAC_LLM_UNAVAILABLE: 8020,
  /** 8021：案情相似度计算失败（EmbeddingService 异常，降级为仅属性匹配） */
  SIMILARITY_DEGRADED: 8021,
} as const;

// ===== 复用类型（避免循环依赖，从 nlu.types 重新导出 Entity）=====

import type { Entity } from '../nlu/nlu.types';
export type { Entity };
