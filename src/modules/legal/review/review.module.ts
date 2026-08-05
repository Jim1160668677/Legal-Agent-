/**
 * ReviewModule —— 律师审核评估闭环模块（v3.0 增强版）。
 *
 * v3.0 新增：
 *   - PrePublishReviewService：实时人机协同预发布审核
 *   - ExpertiseQualityScorer：律师专业判断质量评估
 *
 * 核心服务：
 *   1. LawyerReviewService：审核工作流状态机 + 三档抽样策略
 *   2. AnswerTracer：AI 回答溯源元数据记录
 *   3. AnswerQualityScorer：双轨评分（自动实时 + 律师异步）
 *   4. ComplianceMonitor：合规风险三路评分闭环
 *   5. LawyerAnnotationService：律师标注回流
 *   6. PrePublishReviewService：实时人机协同（v3.0 新增）
 *   7. ExpertiseQualityScorer：专业判断质量评估（v3.0 新增）
 *
 * 设计依据：17 §2-§6；v3.0 律师专业判断深度整合需求。
 */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  LawyerReview,
  LawyerReviewSchema,
} from '../../../infra/database/schemas/lawyer-review.schema';
import {
  AnswerTraceability,
  AnswerTraceabilitySchema,
} from '../../../infra/database/schemas/answer-traceability.schema';
import {
  ComplianceAlert,
  ComplianceAlertSchema,
} from '../../../infra/database/schemas/compliance-alert.schema';
import {
  IntentEvalSet,
  IntentEvalSetSchema,
  LawArticle,
  LawArticleSchema,
} from '../../../infra/database/schemas/legal.schema';
import {
  ReasoningChain,
  ReasoningChainSchema,
} from '../../../infra/database/schemas/reasoning-chain.schema';
import { Feedback, FeedbackSchema } from '../../../infra/database/schemas/user.schema';
import {
  PrePublishReview,
  PrePublishReviewSchema,
} from '../../../infra/database/schemas/pre-publish-review.schema';
import { LoggerModule } from '../../platform/logger/logger.module';
import { AuditModule } from '../../platform/audit/audit.module';
import { ContentSafetyModule } from '../../platform/content-safety/content-safety.module';
import { AuthModule } from '../../auth/auth.module';
import { KnowledgeBaseModule } from '../knowledge/knowledge-base.module';
import { LawyerReviewService } from './lawyer-review.service';
import { AnswerTracer } from './answer-tracer.service';
import { AnswerQualityScorer } from './answer-quality-scorer.service';
import { ComplianceMonitor } from './compliance-monitor.service';
import { LawyerAnnotationService } from './lawyer-annotation.service';
import { PrePublishReviewService } from './pre-publish-review.service';
import { ExpertiseQualityScorer } from './expertise-quality-scorer.service';
import { LawyerReviewController } from './lawyer-review.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LawyerReview.name, schema: LawyerReviewSchema },
      { name: AnswerTraceability.name, schema: AnswerTraceabilitySchema },
      { name: ComplianceAlert.name, schema: ComplianceAlertSchema },
      { name: IntentEvalSet.name, schema: IntentEvalSetSchema },
      { name: ReasoningChain.name, schema: ReasoningChainSchema },
      { name: LawArticle.name, schema: LawArticleSchema },
      { name: Feedback.name, schema: FeedbackSchema },
      { name: PrePublishReview.name, schema: PrePublishReviewSchema }, // v3.0 新增
    ]),
    LoggerModule,
    AuditModule,
    ContentSafetyModule,
    AuthModule,
    KnowledgeBaseModule, // v3.0 新增：律师专业知识库
  ],
  controllers: [LawyerReviewController],
  providers: [
    LawyerReviewService,
    AnswerTracer,
    AnswerQualityScorer,
    ComplianceMonitor,
    LawyerAnnotationService,
    PrePublishReviewService, // v3.0 新增
    ExpertiseQualityScorer, // v3.0 新增
  ],
  exports: [
    LawyerReviewService,
    AnswerTracer,
    AnswerQualityScorer,
    ComplianceMonitor,
    LawyerAnnotationService,
    PrePublishReviewService, // v3.0 新增
    ExpertiseQualityScorer, // v3.0 新增
  ],
})
export class ReviewModule {}
