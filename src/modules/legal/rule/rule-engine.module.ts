/**
 * RuleEngineModule —— 规则层模块（A4-W2 抽出，A1-W3 原服务）。
 *
 * 装配 RuleEngineService（法条精确匹配 + 关键词召回 + FAQ 快答，全内存 < 100ms）。
 * 依赖：AppLoggerService（可选，日志降级时用）。
 *
 * A4-W2 抽出动机：AgentsModule 需注入 RuleEngineService 给 LawLookupAgent / LegalQaAgent，
 * 原先 RuleEngineService 内联在 LegalModule providers 中无法被 AgentsModule 独立导入。
 *
 * 设计依据：A1 §三 NestJS 工程结构；A4 §五 5.3 横切注入。
 */
import { Module } from '@nestjs/common';
import { LoggerModule } from '../../platform/logger/logger.module';
import { RuleEngineService } from './rule-engine.service';

@Module({
  imports: [LoggerModule],
  providers: [RuleEngineService],
  exports: [RuleEngineService],
})
export class RuleEngineModule {}
