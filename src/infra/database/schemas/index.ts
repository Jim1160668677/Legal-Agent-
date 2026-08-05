/**
 * Schema 汇总导出（A1-W1 + A3-W3 扩展）。
 * 集合按业务域分文件：user / dialog / legal / system / document / job。
 */
export {
  UserProfile,
  UserProfileSchema,
  type UserProfileDocument,
  Feedback,
  FeedbackSchema,
  type FeedbackDocument,
} from './user.schema';

export {
  DialogRecord,
  DialogRecordSchema,
  type DialogRecordDocument,
  AuditLog,
  AuditLogSchema,
  type AuditLogDocument,
} from './dialog.schema';

export {
  LawArticle,
  LawArticleSchema,
  type LawArticleDocument,
  LegalKnowledge,
  LegalKnowledgeSchema,
  type LegalKnowledgeDocument,
  IntentEvalSet,
  IntentEvalSetSchema,
  type IntentEvalSetDocument,
  CasePrecedent,
  CasePrecedentSchema,
  type CasePrecedentDocument,
} from './legal.schema';

export {
  FeatureFlag,
  FeatureFlagSchema,
  type FeatureFlagDocument,
  LlmCache,
  LlmCacheSchema,
  type LlmCacheDocument,
} from './system.schema';

// A3-W3 新增：文书域（document_template + document_record）
export {
  DocumentTemplateRecord,
  DocumentTemplateRecordSchema,
  type DocumentTemplateRecordDocument,
  DocumentRecord,
  DocumentRecordSchema,
  type DocumentRecordDocument,
} from './document.schema';

// A3-W4 新增：异步任务（agent_job）
export {
  AgentJob,
  AgentJobSchema,
  type AgentJobDocument,
  type JobStatus,
  type JobCapability,
} from './job.schema';

// A4-W1 新增：Agent 域（agent_registry + agent_invocation_log）
export {
  AgentRegistryRecord,
  AgentRegistrySchema,
  type AgentRegistryDocument,
  type AgentRegistryStatus,
  type AgentExposure,
} from './agent-registry.schema';

export {
  AgentInvocationLog,
  AgentInvocationLogSchema,
  type AgentInvocationLogDocument,
  type InvocationResult,
} from './agent-invocation-log.schema';

// v2.3-W3 新增：法条引用图谱（law_citation_graph）
export {
  LawCitationGraph,
  LawCitationGraphSchema,
  type LawCitationGraphDocument,
} from './citation-graph.schema';

// v2.3-W4 新增：NLU 域（entity_extraction + clarification_session）
export {
  EntityExtraction,
  EntityExtractionSchema,
  type EntityExtractionDocument,
  type EntityType,
  type EntitySource,
  EntityEntry,
} from './entity-extraction.schema';

export {
  ClarificationSession,
  ClarificationSessionSchema,
  type ClarificationSessionDocument,
  type ClarificationState,
} from './clarification-session.schema';

// v2.3-W5 新增：推理域（reasoning_chain）
export {
  ReasoningChain,
  ReasoningChainSchema,
  type ReasoningChainDocument,
  type ReasoningIssue,
  type ReasoningRule,
  type ReasoningApplication,
  type ReasoningConclusion,
} from './reasoning-chain.schema';

// v2.3 阶段十新增：律师审核评估闭环（lawyer_review / answer_traceability / compliance_alert）
export {
  LawyerReview,
  LawyerReviewSchema,
  type LawyerReviewDocument,
  type LawyerReviewState,
  type LawyerReviewRiskLevel,
  type LawyerReviewScores,
  type LawyerReviewAnnotations,
  type CitationError,
  type FactCorrection,
  type ReasoningFlaw,
} from './lawyer-review.schema';

export {
  AnswerTraceability,
  AnswerTraceabilitySchema,
  type AnswerTraceabilityDocument,
  type CitedLaw,
  type CitedCase,
  type RagSource,
} from './answer-traceability.schema';

export {
  ComplianceAlert,
  ComplianceAlertSchema,
  type ComplianceAlertDocument,
  type ComplianceAlertState,
  type ComplianceRiskLevel,
  type ComplianceTrigger,
} from './compliance-alert.schema';

// v3.0 新增：律师专业知识库（lawyer_expertise）
export {
  LawyerExpertise,
  LawyerExpertiseSchema,
  type LawyerExpertiseDocument,
  type ExpertiseType,
  type ExpertiseScenario,
  type ExpertiseSource,
  type ExpertiseCondition,
  type ExpertiseArgument,
  type ExpertiseExample,
  type ExpertiseUsageRecord,
} from './lawyer-expertise.schema';

// v3.0 新增：预发布审核（pre_publish_review）
export {
  PrePublishReview,
  PrePublishReviewSchema,
  type PrePublishReviewDocument,
  type PrePublishReviewState,
  type AiGeneratedOpinion,
  type LawyerModification,
  type LawyerSupplement,
  type FinalOpinion,
} from './pre-publish-review.schema';

// v3.0 新增：推理链扩展类型
export {
  type ExpertiseAppliedItem,
  type ReasoningTraceNode,
} from './reasoning-chain.schema';
