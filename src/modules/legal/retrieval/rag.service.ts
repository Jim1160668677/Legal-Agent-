/**
 * RagService —— 三路召回 + RRF 融合（A2-W3，A2 §4.2）。
 *
 * 三路召回：
 *   1. BM25：InMemoryBm25Retriever（词频文本相关性，law_article + case_precedent）
 *   2. 向量：EmbeddingService.embed(query) → VectorStore.search（语义相似度）
 *   3. 结构化：KnowledgeBaseService.queryByKeyword（流程/材料/术语/FAQ/模板）
 *
 * RRF 融合（Reciprocal Rank Fusion）：
 *   score(d) = Σ_path weight_path / (k + rank_path(d))
 *   k=60（标准默认），各路默认均等权重 1.0
 *   同一文档（id + collection 相同）多路命中时 RRF 分数累加
 *
 * 容错：各路独立，单路失败不影响其他路（记 warn 日志，该路返回空）。
 *
 * 设计依据：A2 §4.2 混合检索 + RRF 融合；A2-W3 交付物。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { EmbeddingService } from '../embedding/embedding.service';
import type { VectorStore } from '../embedding/vector-store';
import type { KnowledgeBaseService } from '../knowledge/knowledge-base.service';
import type { AppLoggerService } from '../../platform/logger/logger.service';
import { requestContext } from '../../../common/context/request-context';
import { VECTOR_STORE_TOKEN } from '../embedding/embedding.types';
import {
  BM25_RETRIEVER_TOKEN,
  DEFAULT_RRF_CONFIG,
  type Retriever,
  type RetrievalResult,
  type RetrievalQuery,
  type RrfConfig,
  type RetrievalPath,
  type RetrievalCollection,
} from './retrieval.types';

/** 默认每路召回数 */
const DEFAULT_TOP_K_PER_PATH = 10;
/** 默认最终返回数 */
const DEFAULT_FINAL_TOP_K = 10;

@Injectable()
export class RagService {
  private readonly rrfConfig: RrfConfig;

  constructor(
    @Inject(BM25_RETRIEVER_TOKEN) @Optional() private readonly bm25Retriever?: Retriever,
    @Optional() private readonly embeddingService?: EmbeddingService,
    @Inject(VECTOR_STORE_TOKEN) @Optional() private readonly vectorStore?: VectorStore,
    @Optional() private readonly knowledgeBase?: KnowledgeBaseService,
    @Optional() private readonly logger?: AppLoggerService,
    rrfConfig: RrfConfig = DEFAULT_RRF_CONFIG,
  ) {
    this.rrfConfig = rrfConfig;
  }

  /**
   * 三路召回 + RRF 融合。
   * @param query 检索查询
   * @returns 融合后按 rrfScore 降序的结果列表
   */
  async retrieve(query: RetrievalQuery): Promise<RetrievalResult[]> {
    const text = query.text?.trim();
    if (!text) return [];

    const topKPerPath = query.topKPerPath ?? DEFAULT_TOP_K_PER_PATH;
    const finalTopK = query.finalTopK ?? DEFAULT_FINAL_TOP_K;
    const filter = query.filter;
    const startedAt = Date.now();

    // 并行执行三路召回
    const [bm25Results, vectorResults, structuredResults] = await Promise.all([
      this.retrieveBm25(text, topKPerPath, filter),
      this.retrieveVector(text, topKPerPath, filter),
      this.retrieveStructured(text, topKPerPath),
    ]);

    // RRF 融合
    const fused = this.rrfFuse({
      bm25: bm25Results,
      vector: vectorResults,
      structured: structuredResults,
    });

    const result = fused.slice(0, finalTopK);

    this.logger?.info('RagService 检索完成', {
      func: 'rag_retrieve',
      traceId: requestContext.get()?.traceId,
      queryPreview: text.slice(0, 48),
      bm25Hits: bm25Results.length,
      vectorHits: vectorResults.length,
      structuredHits: structuredResults.length,
      fusedCount: fused.length,
      finalCount: result.length,
      durationMs: Date.now() - startedAt,
    });

    return result;
  }

  // ===== 三路召回 =====

  /** 第一路：BM25 文本相关性召回 */
  private async retrieveBm25(
    text: string,
    topK: number,
    filter?: Record<string, unknown>,
  ): Promise<RetrievalResult[]> {
    if (!this.bm25Retriever) return [];
    try {
      return await this.bm25Retriever.retrieve(text, { topK, filter });
    } catch (err) {
      this.logger?.warn('BM25 召回失败，跳过该路', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /** 第二路：向量语义召回 */
  private async retrieveVector(
    text: string,
    topK: number,
    filter?: Record<string, unknown>,
  ): Promise<RetrievalResult[]> {
    if (!this.embeddingService || !this.vectorStore) return [];
    try {
      const queryVec = await this.embeddingService.embed(text);
      const hits = await this.vectorStore.search(queryVec, { topK, filter });
      return hits.map((h) => ({
        id: h.meta.id,
        collection: h.meta.collection,
        title: (h.meta.title as string) ?? h.meta.id,
        content: (h.meta.content as string) ?? '',
        pathScore: h.score,
        paths: ['vector'],
        meta: h.meta,
      }));
    } catch (err) {
      this.logger?.warn('向量召回失败，跳过该路', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /** 第三路：结构化知识召回 */
  private async retrieveStructured(text: string, topK: number): Promise<RetrievalResult[]> {
    if (!this.knowledgeBase) return [];
    try {
      const kbResults = await this.knowledgeBase.queryByKeyword(text, { limit: topK });
      return kbResults.map((r) => ({
        id: `${r.type}:${r.title}`,
        collection: 'legal_knowledge' as RetrievalCollection,
        title: r.title,
        content: r.content,
        pathScore: r.score,
        paths: ['structured' as RetrievalPath],
        lawRefs: r.lawRefs,
        meta: { type: r.type, structured: r.structured },
      }));
    } catch (err) {
      this.logger?.warn('结构化召回失败，跳过该路', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  // ===== RRF 融合 =====

  /**
   * RRF 融合算法。
   * 同一文档（id + collection 相同）多路命中时合并 paths 并累加 rrfScore。
   */
  private rrfFuse(byPath: Record<RetrievalPath, RetrievalResult[]>): RetrievalResult[] {
    const { k, weights } = this.rrfConfig;
    /** 融合键：collection:id */
    const fusedMap = new Map<string, RetrievalResult>();

    const paths: RetrievalPath[] = ['bm25', 'vector', 'structured'];
    for (const path of paths) {
      const results = byPath[path];
      const weight = weights[path];
      for (let rank = 0; rank < results.length; rank++) {
        const result = results[rank];
        const key = `${result.collection}:${result.id}`;
        const existing = fusedMap.get(key);

        if (existing) {
          // 多路命中：累加 RRF 分数，合并 paths
          existing.rrfScore = (existing.rrfScore ?? 0) + weight / (k + rank + 1);
          existing.paths = [...new Set([...existing.paths, path])];
        } else {
          // 首次命中
          fusedMap.set(key, {
            ...result,
            rrfScore: weight / (k + rank + 1),
            paths: [path],
          });
        }
      }
    }

    // 按 RRF 分数降序
    return Array.from(fusedMap.values()).sort((a, b) => (b.rrfScore ?? 0) - (a.rrfScore ?? 0));
  }
}
