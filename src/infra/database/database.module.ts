/**
 * MongoDB 数据库模块（A1-W1）。
 *
 * MongooseModule.forRootAsync 从 ConfigService 注入连接字符串。
 * MongooseModule.forFeature 注册 9 个集合 schema。
 * 设计依据：A1 §五。
 */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  UserProfile,
  UserProfileSchema,
  Feedback,
  FeedbackSchema,
  DialogRecord,
  DialogRecordSchema,
  AuditLog,
  AuditLogSchema,
  LawArticle,
  LawArticleSchema,
  LegalKnowledge,
  LegalKnowledgeSchema,
  IntentEvalSet,
  IntentEvalSetSchema,
  CasePrecedent,
  CasePrecedentSchema,
  FeatureFlag,
  FeatureFlagSchema,
  LlmCache,
  LlmCacheSchema,
  DocumentTemplateRecord,
  DocumentTemplateRecordSchema,
  DocumentRecord,
  DocumentRecordSchema,
  AgentJob,
  AgentJobSchema,
  AgentRegistryRecord,
  AgentRegistrySchema,
  AgentInvocationLog,
  AgentInvocationLogSchema,
} from './schemas';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('app.mongo.uri'),
        // 连接池调优（A1 §十四风险对策）
        serverSelectionTimeoutMS: 5000,
      }),
    }),
    MongooseModule.forFeature([
      { name: UserProfile.name, schema: UserProfileSchema },
      { name: Feedback.name, schema: FeedbackSchema },
      { name: DialogRecord.name, schema: DialogRecordSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: LawArticle.name, schema: LawArticleSchema },
      { name: LegalKnowledge.name, schema: LegalKnowledgeSchema },
      { name: IntentEvalSet.name, schema: IntentEvalSetSchema },
      { name: CasePrecedent.name, schema: CasePrecedentSchema },
      { name: FeatureFlag.name, schema: FeatureFlagSchema },
      { name: LlmCache.name, schema: LlmCacheSchema },
      // A3-W3 新增：文书域
      { name: DocumentTemplateRecord.name, schema: DocumentTemplateRecordSchema },
      { name: DocumentRecord.name, schema: DocumentRecordSchema },
      // A3-W4 新增：异步任务
      { name: AgentJob.name, schema: AgentJobSchema },
      // A4-W1 新增：Agent 域（agent_registry + agent_invocation_log）
      { name: AgentRegistryRecord.name, schema: AgentRegistrySchema },
      { name: AgentInvocationLog.name, schema: AgentInvocationLogSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class DatabaseModule {}
