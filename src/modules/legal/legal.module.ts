/**
 * LegalModule —— 法律域业务模块汇总（v3.0 增强版）。
 *
 * v3.0 新增：
 *   - ReviewModule 导入（PrePublishReviewService + ExpertiseQualityScorer）
 *   - LegalExpertiseController 注册
 *
 * 模块演进：
 *   - A1-W3：IntentRouter / RuleEngine / MemoryManager
 *   - A1-W4：Orchestrator + ChatController + LlmModule
 *   - A2-W1+：KnowledgeBaseModule / EmbeddingModule / RagModule
 *   - A3-W2：DocumentModule
 *   - A3-W3+：DocumentModule 扩展 + JobModule
 *   - A4-W1：AgentsModule
 *   - A4-W2：RuleEngine / Memory / Intent 独立模块
 *   - A4-W3：OrchestratorAgent 加入编排
 *   - v2.3-W5：ReasoningModule 注册
 *   - v3.0：律师专业判断深度整合（ReviewModule + LegalExpertiseController）
 *
 * 设计依据：A1 §三；v3.0 律师专业判断深度整合需求。
 */
import { Module } from '@nestjs/common';
import { LoggerModule } from '../platform/logger/logger.module';
import { AuditModule } from '../platform/audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { IntentModule } from './intent/intent.module';
import { RuleEngineModule } from './rule/rule-engine.module';
import { MemoryModule } from './memory/memory.module';
import { OrchestratorService } from './orchestrator/orchestrator.service';
import { ChatController } from './chat/chat.controller';
import { LlmModule } from './llm/llm.module';
import { DocumentModule } from './document/document.module';
import { KnowledgeBaseModule } from './knowledge/knowledge-base.module';
import { CitationGraphModule } from './knowledge/citation-graph.module';
import { EmbeddingModule } from './embedding/embedding.module';
import { RagModule } from './retrieval/rag.module';
import { JobModule } from './job/job.module';
import { JobController } from './job/job.controller';
import { AgentsModule } from './agents/agents.module';
import { AgentsController } from './agents/agents.controller';
import { NluModule } from './nlu/nlu.module';
import { ReasoningModule } from './reasoning/reasoning.module';
import { VisionModule } from './vision/vision.module';
import { ReviewModule } from './review/review.module';
import { LegalExpertiseController } from './legal-expertise.controller';

@Module({
  imports: [
    LoggerModule,
    AuditModule,
    AuthModule, // RolesGuard/AuthService 供 LegalExpertiseController @UseGuards 注入
    LlmModule,
    IntentModule,
    RuleEngineModule,
    MemoryModule,
    DocumentModule,
    KnowledgeBaseModule,
    CitationGraphModule,
    EmbeddingModule,
    RagModule,
    JobModule,
    NluModule,
    ReasoningModule,
    AgentsModule,
    VisionModule,
    ReviewModule, // v3.0 新增：审核评估闭环
  ],
  controllers: [
    ChatController,
    JobController,
    AgentsController,
    LegalExpertiseController, // v3.0 新增
  ],
  providers: [OrchestratorService],
  exports: [
    OrchestratorService,
    IntentModule,
    RuleEngineModule,
    MemoryModule,
    AgentsModule,
    NluModule,
    ReasoningModule,
    ReviewModule, // v3.0 新增
  ],
})
export class LegalModule {}
