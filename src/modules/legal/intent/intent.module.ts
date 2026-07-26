/**
 * IntentModule —— 意图识别模块（A4-W3 抽出，A1-W3 原服务）。
 *
 * 装配 IntentRouterService（8 意图分类 + 路由判定，基于关键词/模式/上下文打分）。
 * 依赖：
 *   - LoggerModule：AppLoggerService（可选）
 *   - LlmModule：LLM_SERVICE_TOKEN（可选，置信度 0.5-0.8 区间辅助）
 *
 * A4-W3 抽出动机：OrchestratorAgent（在 AgentsModule）需注入 IntentRouterService，
 * 原先 IntentRouterService 内联在 LegalModule providers 中无法被 AgentsModule 独立导入。
 *
 * 设计依据：A1 §三 NestJS 工程结构；07 §1.1-1.5 意图识别；A4 §六 OrchestratorAgent。
 */
import { Module } from '@nestjs/common';
import { LoggerModule } from '../../platform/logger/logger.module';
import { LlmModule } from '../llm/llm.module';
import { IntentRouterService } from './intent-router.service';

@Module({
  imports: [LoggerModule, LlmModule],
  providers: [IntentRouterService],
  exports: [IntentRouterService],
})
export class IntentModule {}
