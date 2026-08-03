/**
 * ReviewModule 类型定义与常量（v2.3 阶段十，17 §2-§6）。
 *
 * 涵盖：
 *   - 律师审核工作流：LawyerReviewState / LawyerReviewRiskLevel / ReviewSamplingInput
 *   - 律师标注：LawyerReviewAnnotations / LawyerReviewScores / CitationError 等
 *   - 质量评分：AutoScoreInput / AutoScoreResult / QualityGrade / LawyerScoreInput
 *   - 溯源：TraceRecordInput / TraceRecord / TraceQuery
 *   - 合规监控：ComplianceScanInput / ComplianceScanResult / ComplianceLevel / ComplianceTrigger
 *   - 标注回流：ReflowInput / ReflowTarget / ReflowResult
 *   - 常量：REVIEW_SAMPLING_RATES / REVIEW_TIMEOUTS / QUALITY_GRADE_THRESHOLDS / COMPLIANCE_THRESHOLDS
 *
 * 设计依据：17 §2-§6；05 3.32/3.33/3.34；03 §12.7 ComplianceMonitor。
 */
import type { IntentType } from '../../../types/intent';

// ===== 律师审核状态机（17 §2.2）=====

export type LawyerReviewState = 'pending' | 'claimed' | 'reviewing' | 'submitted' | 'reflowed';

/** 抽样来源（风险等级） */
export type LawyerReviewRiskLevel = 'high' | 'normal' | 'user_flagged';

/** 律师标注的风险标记 */
export type LawyerRiskFlag = 'none' | 'low' | 'high';

// ===== 律师标注字段（17 §2.4）=====

export interface LawyerReviewScores {
  /** 准确性 1-5 */
  accuracy: number;
  /** 完整性 1-5 */
  completeness: number;
  /** 合规性 1-5 */
  compliance: number;
  /** 实用性 1-5 */
  usefulness: number;
}

export interface CitationError {
  lawRef: string;
  errorType: string;
  correction: string;
}

export interface FactCorrection {
  segment: string;
  correction: string;
}

export interface ReasoningFlaw {
  step: string;
  flaw: string;
  suggestion: string;
}

export interface LawyerReviewTextAnnotations {
  citationErrors?: CitationError[];
  factCorrections?: FactCorrection[];
  reasoningFlaws?: ReasoningFlaw[];
  generalComment?: string;
}

export interface LawyerReviewAnnotations {
  scores: LawyerReviewScores;
  textAnnotations?: LawyerReviewTextAnnotations;
  riskFlag: LawyerRiskFlag;
  reviewedBy: string;
  reviewedAt: Date;
  /** 审核耗时 ms */
  duration: number;
}

// ===== 抽样策略（17 §2.3）=====

export interface ReviewSamplingInput {
  /** 消息 ID */
  msgId: string;
  /** 用户 ID */
  userId: string;
  /** 触发意图 */
  intent: IntentType;
  /** 用户是否主动标记反馈 */
  userFlagged?: boolean;
}

export interface ReviewSamplingResult {
  /** 是否入审 */
  sampled: boolean;
  /** 抽样来源（high / normal / user_flagged） */
  riskLevel?: LawyerReviewRiskLevel;
  /** 创建的 reviewId（sampled=true 时填充） */
  reviewId?: string;
}

/** 抽样率配置（17 §2.3） */
export const REVIEW_SAMPLING_RATES = {
  /** 高风险（case_reasoning / document_generate）：100% 入审 */
  high: 1.0,
  /** 用户标记反馈：100% 入审 */
  userFlagged: 1.0,
  /** 普通意图：5% 随机抽样 */
  normal: 0.05,
} as const;

/** 高风险意图集合（17 §2.3） */
export const HIGH_RISK_INTENTS: IntentType[] = ['case_reasoning', 'document_generate'];

// ===== 状态机超时（17 §2.2）=====

export const REVIEW_TIMEOUTS = {
  /** pending 超 72h 未领取 → 自动降级重新入队 */
  pendingRequeueMs: 72 * 3600 * 1000,
  /** claimed / reviewing 超 48h 未提交 → 释放回 pending */
  claimedReleaseMs: 48 * 3600 * 1000,
} as const;

// ===== 回答质量评分（17 §3）=====

export interface AutoScoreInput {
  /** AI 回答文本 */
  answer: string;
  /** 溯源元数据 */
  trace: {
    citedLaws: Array<{ ref: string; verified: boolean }>;
    reasoningChainId?: string;
  };
  /** 是否包含免责声明 */
  hasDisclaimer?: boolean;
}

export interface AutoScoreResult {
  /** 综合自动评分 0-5 */
  autoScore: number;
  /** 各分量 */
  citationSuccessRate: number;
  reasoningCompleteness: number;
  disclaimerCoverage: number;
}

export interface LawyerScoreInput {
  /** 律师四维评分 */
  scores: LawyerReviewScores;
}

export interface LawyerScoreResult {
  /** 律师评分（四维平均）0-5 */
  lawyerScore: number;
  /** 质量等级 */
  grade: QualityGrade;
}

/** 质量等级（17 §3.4） */
export type QualityGrade = 'excellent' | 'medium' | 'poor';

/** 质量等级阈值（17 §3.4） */
export const QUALITY_GRADE_THRESHOLDS = {
  /** 优：≥ 4.0 */
  excellent: 4.0,
  /** 差：< 2.5 */
  poor: 2.5,
} as const;

/** 触发回流的质量分阈值（17 §3.4 + §6.1） */
export const REFLOW_SCORE_THRESHOLD = 2.5;

// ===== AI 回答溯源（17 §4）=====

export interface TraceRecordInput {
  msgId: string;
  userId: string;
  intent: IntentType;
  citedLaws: Array<{ ref: string; verified: boolean }>;
  citedCases?: Array<{ caseId: string; caseTitle?: string }>;
  promptVersion?: string;
  modelVersion?: string;
  reasoningChainId?: string;
  ragSources?: Array<{ docId: string; score: number; collection: string }>;
  /** AI 回答文本（用于计算 autoScore） */
  answer: string;
}

export interface TraceRecord {
  msgId: string;
  userId: string;
  intent: IntentType;
  citedLaws: Array<{ ref: string; verified: boolean }>;
  citedCases: Array<{ caseId: string; caseTitle?: string }>;
  promptVersion?: string;
  modelVersion?: string;
  reasoningChainId?: string;
  ragSources: Array<{ docId: string; score: number; collection: string }>;
  autoScore: number;
  lawyerReviewId?: string;
  createdAt: Date;
}

// ===== 合规风险评分（17 §5）=====

export interface ComplianceScanInput {
  msgId: string;
  userId: string;
  /** AI 回答文本（ContentSafety 校验） */
  answer: string;
  /** 法条引用失败率（trace.citedLaws 中 verified=false 比例） */
  citationFailureRate?: number;
  /** 律师标记 riskFlag（律师审核提交后触发） */
  lawyerRiskFlag?: LawyerRiskFlag;
  /** 内容安全检查结果（如已由 ContentSafetyService.checkOutput 计算） */
  contentSafetyResult?: { safe: boolean; reason?: string; category?: string };
}

export interface ComplianceScanResult {
  /** 风险等级：pass / warn / block */
  level: ComplianceLevel;
  /** 触发路径列表 */
  triggers: Array<{
    path: 'content_safety' | 'lawyer_flag' | 'citation_failure';
    detail: string;
  }>;
  /** 是否拦截（block 时为 true，返回 8013） */
  blocked: boolean;
  /** 创建的 alertId（block 时填充） */
  alertId?: string;
}

export type ComplianceLevel = 'pass' | 'warn' | 'block';

/** 合规阈值（17 §5.2） */
export const COMPLIANCE_THRESHOLDS = {
  /** 法条引用失败率 ≥ 30% → warn */
  warnCitationFailure: 0.3,
  /** 法条引用失败率 > 60% → block */
  blockCitationFailure: 0.6,
} as const;

/** 合规错误码（17 §5.3 + 06 错误码 8013） */
export const COMPLIANCE_ERROR_CODE = 8013;

// ===== 律师标注回流（17 §6）=====

export type ReflowTarget = 'intent_eval_set' | 'reasoning_chain' | 'law_article' | 'feedback';

export interface ReflowInput {
  /** 律师审核 ID */
  reviewId: string;
  /** 关联消息 ID */
  msgId: string;
  /** 关联用户 ID */
  userId: string;
  /** 触发意图 */
  intent: IntentType;
  /** 律师标注 */
  annotations: LawyerReviewAnnotations;
}

export interface ReflowTargetResult {
  /** 回流目标 */
  target: ReflowTarget;
  /** 是否成功 */
  success: boolean;
  /** 回流记录 ID（如 intentEvalSetId / reasoningChainId / articleId / feedbackId） */
  targetId?: string;
  /** 失败原因 */
  error?: string;
  /** 是否跳过（无相关标注） */
  skipped?: boolean;
}

export interface ReflowResult {
  /** 各目标的回流结果 */
  results: ReflowTargetResult[];
  /** 成功回流的目标数 */
  successCount: number;
  /** 跳过的目标数 */
  skippedCount: number;
  /** 失败的目标数 */
  failedCount: number;
  /** 总体是否成功（无 failed 即视为成功） */
  ok: boolean;
}

/** 回流去重键策略（17 §6.4） */
export function buildReflowDedupKey(target: ReflowTarget, input: ReflowInput): string {
  switch (target) {
    case 'intent_eval_set':
      // 按 msgId + intent 去重
      return `${input.msgId}:${input.intent}`;
    case 'reasoning_chain':
      // 按 reasoningChainId + step 去重（此处用 reviewId + msgId 简化）
      return `rc:${input.reviewId}:${input.msgId}`;
    case 'law_article':
      // 按 articleId 去重（多次订正追加到 amendmentHistory）
      return `law:${input.reviewId}`;
    case 'feedback':
      // 按 msgId 去重
      return `fb:${input.msgId}`;
  }
}
