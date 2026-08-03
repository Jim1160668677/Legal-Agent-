/**
 * ReasoningModule —— 法律推理域模块（v2.3-W5，16 §2-§5）。
 *
 * 装配四个核心服务：
 *   1. IracReasonerService：IRAC 四步推理编排（Issue/Rule/Application/Conclusion）
 *   2. FactSimilarityService：案情事实相似度算法（embedding + attributes 加权融合）
 *   3. LawApplicationDeterminerService：法条适用判定（构成要件匹配）
 *   4. CaseComparatorService：案例对比（相似度 + 差异点抽取）
 *
 * 依赖：
 *   - MongooseModule：ReasoningChain schema（推理链持久化）
 *   - LoggerModule：AppLoggerService（可选）
 *   - LlmModule：LLM_SERVICE_TOKEN（可选，Issue/Conclusion LLM 推理用）
 *   - RagModule：RagService（可选，Rule 步法条召回 + CaseComparator 案例召回）
 *   - KnowledgeBaseModule：CitationGraphBuilderService（可选，Rule 步扩展召回）
 *
 * 模块化动机：v2.3-W5 ReasoningAgent 需注入推理四服务，独立模块便于 AgentsModule 导入。
 *
 * 设计依据：16 §2-§5；05 3.28 reasoning_chain；07 §9。
 */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ReasoningChain,
  ReasoningChainSchema,
} from '../../../infra/database/schemas/reasoning-chain.schema';
import { LoggerModule } from '../../platform/logger/logger.module';
import { LlmModule } from '../llm/llm.module';
import { RagModule } from '../retrieval/rag.module';
import { CitationGraphModule } from '../knowledge/citation-graph.module';
import { IracReasonerService } from './irac-reasoner.service';
import { FactSimilarityService } from './fact-similarity.service';
import { LawApplicationDeterminerService } from './law-application-determiner.service';
import { CaseComparatorService } from './case-comparator.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ReasoningChain.name, schema: ReasoningChainSchema }]),
    LoggerModule,
    LlmModule,
    RagModule,
    CitationGraphModule,
  ],
  providers: [
    IracReasonerService,
    FactSimilarityService,
    LawApplicationDeterminerService,
    CaseComparatorService,
  ],
  exports: [
    IracReasonerService,
    FactSimilarityService,
    LawApplicationDeterminerService,
    CaseComparatorService,
  ],
})
export class ReasoningModule {}
