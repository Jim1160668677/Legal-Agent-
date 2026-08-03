/**
 * ReviewModule —— 律师审核评估闭环模块（v2.3 阶段十，17 §2-§6）。
 *
 * 装配五个核心服务：
 *   1. LawyerReviewService：审核工作流状态机 + 三档抽样策略
 *   2. AnswerTracer：AI 回答溯源元数据记录
 *   3. AnswerQualityScorer：双轨评分（自动实时 + 律师异步）
 *   4. ComplianceMonitor：合规风险三路评分闭环
 *   5. LawyerAnnotationService：律师标注回流（4 目标）
 *
 * 依赖：
 *   - MongooseModule：lawyer_review / answer_traceability / compliance_alert /
 *                     intent_eval_set / reasoning_chain / law_article / feedback
 *   - LoggerModule：AppLoggerService（可选）
 *   - AuditModule：AuditLogService（可选，审计事件）
 *   - ContentSafetyModule：ContentSafetyService（可选，合规扫描路径 1）
 *
 * 模块化动机：v2.3 阶段十 LawyerReviewAgent 需注入五服务，独立模块便于 AgentsModule 导入。
 *
 * 设计依据：17 §2-§6；05 3.32/3.33/3.34 集合。
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
import { LoggerModule } from '../../platform/logger/logger.module';
import { AuditModule } from '../../platform/audit/audit.module';
import { ContentSafetyModule } from '../../platform/content-safety/content-safety.module';
import { AuthModule } from '../../auth/auth.module';
import { LawyerReviewService } from './lawyer-review.service';
import { AnswerTracer } from './answer-tracer.service';
import { AnswerQualityScorer } from './answer-quality-scorer.service';
import { ComplianceMonitor } from './compliance-monitor.service';
import { LawyerAnnotationService } from './lawyer-annotation.service';
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
    ]),
    LoggerModule,
    AuditModule,
    ContentSafetyModule,
    AuthModule, // 暴露 AuthService/RolesGuard，供 LawyerReviewController 的 @Roles 注入
  ],
  controllers: [LawyerReviewController],
  providers: [
    LawyerReviewService,
    AnswerTracer,
    AnswerQualityScorer,
    ComplianceMonitor,
    LawyerAnnotationService,
  ],
  exports: [
    LawyerReviewService,
    AnswerTracer,
    AnswerQualityScorer,
    ComplianceMonitor,
    LawyerAnnotationService,
  ],
})
export class ReviewModule {}
