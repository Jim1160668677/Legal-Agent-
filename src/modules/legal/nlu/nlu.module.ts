/**
 * NluModule —— 自然语言理解域模块（v2.3-W4，07 §八）。
 *
 * 装配三个核心服务：
 *   1. EntityExtractorService：四层实体抽取（regex→dict→LLM NER→coref）
 *   2. ClarificationManagerService：多轮主动澄清状态机（asking/answered/timeout/give_up）
 *   3. CompoundIntentSplitterService：复合意图拆分 + 拓扑排序
 *
 * 依赖：
 *   - MongooseModule：EntityExtraction + ClarificationSession schema
 *   - LoggerModule：AppLoggerService（可选）
 *   - LlmModule：LLM_SERVICE_TOKEN（可选，L3 LLM NER 用）
 *   - IntentModule：IntentRouterService（可选，复合意图拆分子句意图识别用）
 *
 * 模块化动机：v2.3-W4 NluAgent 需注入三个服务，独立模块便于 AgentsModule 导入。
 *
 * 设计依据：07 §8.1-8.3；05 3.24/3.25。
 */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  EntityExtraction,
  EntityExtractionSchema,
  ClarificationSession,
  ClarificationSessionSchema,
} from '../../../infra/database/schemas';
import { LoggerModule } from '../../platform/logger/logger.module';
import { LlmModule } from '../llm/llm.module';
import { IntentModule } from '../intent/intent.module';
import { EntityExtractorService } from './entity-extractor.service';
import { ClarificationManagerService } from './clarification-manager.service';
import { CompoundIntentSplitterService } from './compound-intent-splitter.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EntityExtraction.name, schema: EntityExtractionSchema },
      { name: ClarificationSession.name, schema: ClarificationSessionSchema },
    ]),
    LoggerModule,
    LlmModule,
    IntentModule,
  ],
  providers: [EntityExtractorService, ClarificationManagerService, CompoundIntentSplitterService],
  exports: [EntityExtractorService, ClarificationManagerService, CompoundIntentSplitterService],
})
export class NluModule {}
