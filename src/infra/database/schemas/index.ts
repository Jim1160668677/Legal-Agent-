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
