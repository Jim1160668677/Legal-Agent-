/**
 * LegalModule —— 法律域业务模块汇总（A1-W3 + A3-W3 + A4-W2 扩展）。
 *
 * 集中导入法律域服务，便于 AppModule 一次挂载。
 *
 * 模块演进：
 *   - A1-W3：IntentRouter / RuleEngine / MemoryManager（原内联 providers）
 *   - A1-W4：Orchestrator + ChatController + LlmModule
 *   - A2-W1+：KnowledgeBaseModule / EmbeddingModule / RagModule
 *   - A3-W2：DocumentModule（DocumentGenerator）
 *   - A3-W3+：DocumentModule 扩展（DocumentRecord + DocumentController + ExportService）+ JobModule
 *   - A4-W1：AgentsModule（AgentRegistry + 横切依赖）
 *   - A4-W2：RuleEngine / Memory 抽出独立模块（RuleEngineModule / MemoryModule），
 *            供 AgentsModule 注入给 LawLookupAgent / LegalQaAgent / MemoryAgent；
 *            7 核心 Agent 在 AgentsModule 注册（onModuleInit 统一 registry.register）
 *
 * JobController 在本模块声明（避免在 DocumentModule + LegalModule 双导入 JobModule 时
 * controller 路由被重复注册）。
 *
 * 设计依据：A1 §三 NestJS 工程结构；A3 §十二；A4 §五 5.3 横切注入。
 */
import { Module } from '@nestjs/common';
import { LoggerModule } from '../platform/logger/logger.module';
import { AuditModule } from '../platform/audit/audit.module';
import { IntentRouterService } from './intent/intent-router.service';
import { RuleEngineModule } from './rule/rule-engine.module';
import { MemoryModule } from './memory/memory.module';
import { OrchestratorService } from './orchestrator/orchestrator.service';
import { ChatController } from './chat/chat.controller';
import { LlmModule } from './llm/llm.module';
import { DocumentModule } from './document/document.module';
import { KnowledgeBaseModule } from './knowledge/knowledge-base.module';
import { EmbeddingModule } from './embedding/embedding.module';
import { RagModule } from './retrieval/rag.module';
import { JobModule } from './job/job.module';
import { JobController } from './job/job.controller';
import { AgentsModule } from './agents/agents.module';

@Module({
  imports: [
    LoggerModule,
    AuditModule,
    LlmModule,
    RuleEngineModule,
    MemoryModule,
    DocumentModule,
    KnowledgeBaseModule,
    EmbeddingModule,
    RagModule,
    JobModule,
    // A4-W1 新增：Agent 域（AgentRegistry + 横切依赖）
    // A4-W2 扩展：7 核心 Agent 在此模块内注册
    AgentsModule,
  ],
  controllers: [ChatController, JobController],
  providers: [IntentRouterService, OrchestratorService],
  exports: [IntentRouterService, OrchestratorService, RuleEngineModule, MemoryModule, AgentsModule],
})
export class LegalModule {}
