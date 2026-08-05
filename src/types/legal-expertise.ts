/**
 * legal-expertise.types.ts —— 律师专业知识公共 SDK 类型定义（v3.0 新增）。
 *
 * 用途：
 *   - 为前端和外部 SDK 提供类型安全的接口定义
 *   - 确保多端（Web、移动、桌面）一致的类型使用
 *   - 与后端 Schema 保持同步
 *
 * 设计依据：v3.0 律师专业判断深度整合需求。
 */

// ===== 律师专业知识 =====

/** 专业知识类型 */
export type ExpertiseType =
  | 'case_analysis'
  | 'argumentation_method'
  | 'practical_rule'
  | 'risk_assessment'
  | 'defense_strategy';

/** 专业知识应用场景 */
export type ExpertiseScenario =
  | 'contract_review'
  | 'legal_risk_assessment'
  | 'case_analysis'
  | 'litigation'
  | 'negotiation'
  | 'general';

/** 专业知识条目 */
export interface LawyerExpertiseItem {
  expertiseId: string;
  expertiseType: ExpertiseType;
  title: string;
  content: string;
  scenarioTags: ExpertiseScenario[];
  conditions?: ExpertiseCondition;
  argument?: ExpertiseArgument;
  examples?: ExpertiseExample[];
  sources?: ExpertiseSource[];
  relatedLawIds?: string[];
  relatedCaseIds?: string[];
  contributedBy: string;
  contributorName?: string;
  practiceAreas?: string[];
  reliabilityScore: number;
  usageCount: number;
  reviewStatus: 'pending' | 'approved' | 'rejected';
  createdAt?: string;
  updatedAt?: string;
}

/** 专业知识条件 */
export interface ExpertiseCondition {
  factPattern: string;
  legalStandard: string;
  applicableContext?: string;
}

/** 专业论证结构 */
export interface ExpertiseArgument {
  premise: string;
  reasoning: string;
  conclusion: string;
  counterArguments?: string[];
}

/** 专业知识示例 */
export interface ExpertiseExample {
  caseId?: string;
  caseName?: string;
  factSummary: string;
  applicationProcess: string;
  outcome?: string;
}

/** 专业知识来源 */
export interface ExpertiseSource {
  sourceType: 'case' | 'statute' | 'article' | 'practice';
  sourceId?: string;
  sourceTitle: string;
  sourceUrl?: string;
}

// ===== 预发布审核 =====

/** AI 生成的初步法律意见 */
export interface AiGeneratedOpinion {
  summary: string;
  analysis: string;
  lawRefs: string[];
  confidence: number;
  riskLevel: 'low' | 'medium' | 'high';
  reasoningChainId?: string;
}

/** 律师修改标注 */
export interface LawyerModification {
  type: 'approve' | 'edit' | 'supplement' | 'reject';
  fieldPath?: string;
  originalContent?: string;
  modifiedContent?: string;
  modificationNote?: string;
  appliedExpertiseIds?: string[];
}

/** 律师补充意见 */
export interface LawyerSupplement {
  supplementType: 'additional_analysis' | 'risk_warning' | 'alternative_argument' | 'practical_advice';
  content: string;
  lawRefs?: string[];
  expertiseIds?: string[];
}

/** 最终交付意见 */
export interface FinalOpinion {
  summary: string;
  analysis: string;
  lawyerSupplements: LawyerSupplement[];
  lawRefs: string[];
  confidence: number;
  riskLevel: string;
  lawyerSignature?: string;
  judgmentAppliedNote?: string;
}

/** 审核状态 */
export type PrePublishReviewState = 'pending' | 'claimed' | 'reviewing' | 'approved' | 'rejected' | 'escalated';

/** 预发布审核任务 */
export interface PrePublishReviewTask {
  reviewId: string;
  msgId: string;
  userId: string;
  intent: string;
  triggerSource: 'auto' | 'user_request' | 'manual';
  aiOpinion: AiGeneratedOpinion;
  state: PrePublishReviewState;
  claimedBy?: string;
  claimedAt?: string;
  modifications?: LawyerModification[];
  supplements?: LawyerSupplement[];
  finalOpinion?: FinalOpinion;
  reviewNote?: string;
  reviewDuration?: number;
  escalated: boolean;
  escalationReason?: string;
  priority: number;
  createdAt?: string;
  updatedAt?: string;
}

// ===== 专业判断应用追踪 =====

/** 应用的专业知识条目 */
export interface ExpertiseAppliedItem {
  expertiseId: string;
  expertiseTitle: string;
  expertiseType: ExpertiseType;
  iracStep: 'issue' | 'rule' | 'application' | 'conclusion';
  applicationNote: string;
  influenceScore: number;
  source: 'auto_matched' | 'manual_selected' | 'recommended';
}

/** 推理追踪节点 */
export interface ReasoningTraceNode {
  nodeId: string;
  nodeType:
    | 'expertise_injected'
    | 'rule_recalled'
    | 'fact_matched'
    | 'conclusion_generated'
    | 'manual_intervention';
  title: string;
  content?: string;
  expertiseIds?: string[];
  order: number;
}

/** 专业判断应用说明 */
export interface ProfessionalJudgmentNote {
  summary: string;
  stepDetails: Array<{
    step: string;
    expertiseIds: string[];
    influenceDescription: string;
  }>;
  significantlyInfluenced: boolean;
}

// ===== 可视化 =====

/** 可视化类型 */
export type VisualizationType =
  | 'irac_flowchart'
  | 'expertise_influence'
  | 'law_reference_map'
  | 'risk_assessment_heatmap';

/** 可视化节点 */
export interface VisualizationNode {
  id: string;
  type: string;
  label: string;
  description?: string;
  position?: { x: number; y: number };
  metadata?: Record<string, unknown>;
}

/** 可视化连线 */
export interface VisualizationEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  label?: string;
  weight?: number;
}

/** 可视化图 */
export interface VisualizationGraph {
  type: VisualizationType;
  title: string;
  nodes: VisualizationNode[];
  edges: VisualizationEdge[];
  metadata: {
    reasoningChainId: string;
    generatedAt: string;
    expertiseAppliedCount: number;
    stepsCount: number;
  };
}

/** 专业判断解释 */
export interface ProfessionalJudgmentExplanation {
  summary: string;
  stepByStepBreakdown: Array<{
    step: string;
    expertiseApplied: Array<{
      expertiseId: string;
      title: string;
      type: string;
      applicationNote: string;
    }>;
    influenceOnStep: string;
  }>;
  overallAssessment: string;
}

// ===== 质量评估 =====

/** 评估维度 */
export type EvaluationDimension =
  | 'professionalism'
  | 'logical_soundness'
  | 'practicality'
  | 'appropriateness'
  | 'transparency';

/** 维度评分 */
export interface DimensionScore {
  name: EvaluationDimension;
  score: number;
  weight: number;
  justification: string;
}

/** 评估等级 */
export type QualityGrade = 'A' | 'B' | 'C' | 'D';

/** 评估结果 */
export interface ExpertiseQualityResult {
  overallScore: number;
  grade: QualityGrade;
  dimensions: DimensionScore[];
  strengths: string[];
  improvements: string[];
  recommendations: string[];
  evaluatedAt: string;
}

// ===== API 请求/响应 =====

/** 创建审核请求 */
export interface CreateReviewRequest {
  msgId: string;
  userId: string;
  intent: string;
  aiOpinion: AiGeneratedOpinion;
  triggerSource?: 'auto' | 'user_request' | 'manual';
  priority?: number;
}

/** 领取审核请求 */
export interface ClaimReviewRequest {
  reviewId: string;
  lawyerId: string;
}

/** 提交审核修改请求 */
export interface SubmitModificationRequest {
  reviewId: string;
  lawyerId: string;
  modifications: LawyerModification[];
  supplements: LawyerSupplement[];
  finalOpinion?: Partial<FinalOpinion>;
  reviewNote?: string;
}

/** 审核响应 */
export interface ReviewResponse {
  reviewId: string;
  finalOpinion: FinalOpinion;
  reviewDuration: number;
  modificationsCount: number;
  supplementsCount: number;
  status: 'approved' | 'rejected';
}

/** 错误响应 */
export interface ErrorResponse {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
