/**
 * ReasoningModule —— 法律推理域模块（v3.0 增强版）。
 *
 * v3.0 新增：
 *   - ReasoningVisualizationService：法律推理可视化
 *   - 集成 LawyerExpertiseKnowledgeBaseService（通过 KnowledgeBaseModule）
 *
 * 核心服务：
 *   1. IracReasonerService：IRAC 四步推理编排（v3.0 增强融合律师专业判断）
 *   2. FactSimilarityService：案情事实相似度算法
 *   3. LawApplicationDeterminerService：法条适用判定
 *   4. CaseComparatorService：案例对比
 *   5. ReasoningVisualizationService：推理过程可视化
 *
 * 设计依据：16 §2-§5；v3.0 律师专业判断深度整合需求。
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
import { KnowledgeBaseModule } from '../knowledge/knowledge-base.module';
import { IracReasonerService } from './irac-reasoner.service';
import { FactSimilarityService } from './fact-similarity.service';
import { LawApplicationDeterminerService } from './law-application-determiner.service';
import { CaseComparatorService } from './case-comparator.service';
import { ReasoningVisualizationService } from './reasoning-visualization.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ReasoningChain.name, schema: ReasoningChainSchema }]),
    LoggerModule,
    LlmModule,
    RagModule,
    CitationGraphModule,
    KnowledgeBaseModule, // v3.0 新增：律师专业知识库
  ],
  providers: [
    IracReasonerService,
    FactSimilarityService,
    LawApplicationDeterminerService,
    CaseComparatorService,
    ReasoningVisualizationService, // v3.0 新增
  ],
  exports: [
    IracReasonerService,
    FactSimilarityService,
    LawApplicationDeterminerService,
    CaseComparatorService,
    ReasoningVisualizationService, // v3.0 新增
  ],
})
export class ReasoningModule {}
