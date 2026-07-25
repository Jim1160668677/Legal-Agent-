/**
 * LegalModule —— 法律域业务模块汇总（A1-W3 + A3-W3 扩展）。
 *
 * 集中导入法律域服务，便于 AppModule 一次挂载。
 *
 * A1-W3：IntentRouter / RuleEngine / MemoryManager
 * A1-W4：Orchestrator + ChatController + LlmModule
 * A2-W1+：KnowledgeBaseModule / EmbeddingModule / RagModule
 * A3-W2：DocumentModule（DocumentGenerator）
 * A3-W3+：DocumentModule 扩展（DocumentRecord + DocumentController + ExportService）+ JobModule
 *
 * JobController 在本模块声明（避免在 DocumentModule + LegalModule 双导入 JobModule 时
 * controller 路由被重复注册）。
 *
 * 设计依据：A1 §三 NestJS 工程结构；A3 §十二。
 */
import { Module } from '@nestjs/common';
import { LoggerModule } from '../platform/logger/logger.module';
import { AuditModule } from '../platform/audit/audit.module';
import { IntentRouterService } from './intent/intent-router.service';
import { RuleEngineService } from './rule/rule-engine.service';
import { MemoryManagerService } from './memory/memory-manager.service';
import { OrchestratorService } from './orchestrator/orchestrator.service';
import { ChatController } from './chat/chat.controller';
import { LlmModule } from './llm/llm.module';
import { DocumentModule } from './document/document.module';
import { KnowledgeBaseModule } from './knowledge/knowledge-base.module';
import { EmbeddingModule } from './embedding/embedding.module';
import { RagModule } from './retrieval/rag.module';
import { JobModule } from './job/job.module';
import { JobController } from './job/job.controller';

@Module({
  imports: [
    LoggerModule,
    AuditModule,
    LlmModule,
    DocumentModule,
    KnowledgeBaseModule,
    EmbeddingModule,
    RagModule,
    JobModule,
  ],
  controllers: [ChatController, JobController],
  providers: [IntentRouterService, RuleEngineService, MemoryManagerService, OrchestratorService],
  exports: [IntentRouterService, RuleEngineService, MemoryManagerService, OrchestratorService],
})
export class LegalModule {}
