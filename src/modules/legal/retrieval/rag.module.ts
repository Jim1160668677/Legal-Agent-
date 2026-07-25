/**
 * RagModule —— 混合检索模块（A2-W3，A2 §4.2）。
 *
 * 组装三路召回依赖：
 *   - BM25_RETRIEVER_TOKEN：InMemoryBm25Retriever（law_article + case_precedent 模型注入）
 *   - EmbeddingModule：提供 EmbeddingService + VECTOR_STORE_TOKEN（向量路）
 *   - KnowledgeBaseModule：提供 KnowledgeBaseService（结构化路）
 *
 * RagService 三路并行召回 + RRF 融合，导出供 OrchestratorService 后续接入。
 *
 * 设计依据：A2 §4.2 三路召回；A1 §三 NestJS 工程结构。
 */
import { Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import { RagService } from './rag.service';
import { InMemoryBm25Retriever } from './in-memory-bm25.retriever';
import { LawUpdatePipelineService } from './law-update-pipeline.service';
import { EmbeddingModule } from '../embedding/embedding.module';
import { KnowledgeBaseModule } from '../knowledge/knowledge-base.module';
import { LoggerModule } from '../../platform/logger/logger.module';
import { BM25_RETRIEVER_TOKEN } from './retrieval.types';

/** BM25_RETRIEVER_TOKEN 的 Provider：默认 InMemoryBm25Retriever */
export const bm25RetrieverProvider: Provider = {
  provide: BM25_RETRIEVER_TOKEN,
  useClass: InMemoryBm25Retriever,
};

@Module({
  imports: [LoggerModule, EmbeddingModule, KnowledgeBaseModule],
  providers: [RagService, bm25RetrieverProvider, LawUpdatePipelineService],
  exports: [RagService, LawUpdatePipelineService],
})
export class RagModule {}
