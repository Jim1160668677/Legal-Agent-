/**
 * LegalModule —— 法律域业务模块汇总（A1-W3）。
 *
 * 集中导入 3 个法律域服务，便于 AppModule 一次挂载：
 *   IntentRouterService（意图识别 + 置信度路由）
 *   RuleEngineService（规则层法条/FAQ 精确匹配）
 *   MemoryManagerService（会话历史读写 + 相关记忆召回）
 *
 * 依赖：
 *   - DialogRecord / UserProfile Model（DatabaseModule 已 forFeature 注册并导出 MongooseModule）
 *   - AppLoggerService（LoggerModule 导出，经 PlatformModule 暴露）
 *   - LLM_SERVICE_TOKEN（可选，A1-W4 迁移 LlmService 为 Provider 后自动启用 LLM 辅助判定）
 *
 * A1-W4 扩展：
 *   - llmServiceProvider 迁移现有 LlmService 为 Provider（提供 LLM_SERVICE_TOKEN），
 *     激活 IntentRouter 0.5-0.8 LLM 辅助判定
 *   - OrchestratorService 三层降级链编排（rule→knowledge占位→llm→人工引导）
 *   - ChatController POST /v1/chat（SSE 流式 + JwtAuthGuard + 审计）
 *
 * 设计依据：A1 §三 NestJS 工程结构；A1-W4 迁移要点。
 */
import { Module } from '@nestjs/common';
import { LoggerModule } from '../platform/logger/logger.module';
import { AuditModule } from '../platform/audit/audit.module';
import { IntentRouterService } from './intent/intent-router.service';
import { RuleEngineService } from './rule/rule-engine.service';
import { MemoryManagerService } from './memory/memory-manager.service';
import { OrchestratorService } from './orchestrator/orchestrator.service';
import { ChatController } from './chat/chat.controller';
import { llmServiceProvider } from './llm/llm.provider';
import { KnowledgeBaseModule } from './knowledge/knowledge-base.module';

@Module({
  imports: [LoggerModule, AuditModule, KnowledgeBaseModule],
  controllers: [ChatController],
  providers: [
    llmServiceProvider,
    IntentRouterService,
    RuleEngineService,
    MemoryManagerService,
    OrchestratorService,
  ],
  exports: [IntentRouterService, RuleEngineService, MemoryManagerService, OrchestratorService],
})
export class LegalModule {}
