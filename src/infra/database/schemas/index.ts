/**
 * Schema 汇总导出（A1-W1）。
 * 9 个集合按业务域分 4 文件：user / dialog / legal / system。
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
