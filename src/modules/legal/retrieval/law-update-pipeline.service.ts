/**
 * LawUpdatePipelineService —— 法条更新管道雏形（A2-W4）。
 *
 * 职责：法条/案例数据更新时，同步刷新依赖缓存与索引，保证检索一致性。
 *   1. 批量失效 LLM 缓存（CacheService.invalidateByLawArticle，按 affectedLawArticles）
 *   2. 重建 BM25 内存索引（InMemoryBm25Retriever.loadFromDb，全量重载）
 *   3. 向量索引更新（可选：EmbeddingService + VectorStore，需注入且有数据）
 *
 * 触发方式（MVP）：
 *   - 手动调用 onLawArticlesUpdated / onCasePrecedentsUpdated
 *   - 后续可扩展为 MongoDB Change Stream 监听或定时全量重建
 *
 * 容错：各步骤独立 try/catch，单步失败不阻塞后续步骤，记 error 日志。
 *
 * 设计依据：A2-W4 交付物；A1 CacheService.invalidateByLawArticle。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { CacheService } from '../../platform/cache/cache.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { VectorStore } from '../embedding/vector-store';
import { AppLoggerService } from '../../platform/logger/logger.service';
import { VECTOR_STORE_TOKEN } from '../embedding/embedding.types';
import { InMemoryBm25Retriever } from './in-memory-bm25.retriever';

/** 更新管道执行结果 */
export interface PipelineResult {
  /** 失效的 LLM 缓存条数 */
  cacheInvalidated: number;
  /** BM25 索引是否重建成功 */
  bm25Reindexed: boolean;
  /** 向量索引更新条数（0 表示未执行） */
  vectorUpdated: number;
  /** 各步骤错误（非阻塞） */
  errors: string[];
  durationMs: number;
}

@Injectable()
export class LawUpdatePipelineService {
  constructor(
    @Optional() private readonly cache?: CacheService,
    @Optional() private readonly bm25Retriever?: InMemoryBm25Retriever,
    @Optional() private readonly embeddingService?: EmbeddingService,
    @Inject(VECTOR_STORE_TOKEN) @Optional() private readonly vectorStore?: VectorStore,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  /**
   * 法条更新管道：失效缓存 → 重建 BM25 → 更新向量。
   * @param articleIds 受影响的法条 ID 列表（contentHash 或 _id）
   */
  async onLawArticlesUpdated(articleIds: string[]): Promise<PipelineResult> {
    const startedAt = Date.now();
    const errors: string[] = [];
    let cacheInvalidated = 0;
    let bm25Reindexed = false;
    let vectorUpdated = 0;

    // 1. 批量失效 LLM 缓存
    if (this.cache && articleIds.length > 0) {
      try {
        cacheInvalidated = await this.cache.invalidateByLawArticle(articleIds);
        this.logger?.info('LawUpdatePipeline: LLM 缓存失效完成', {
          articleIds: articleIds.length,
          invalidated: cacheInvalidated,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`cache_invalidate: ${msg}`);
        this.logger?.error('LawUpdatePipeline: 缓存失效失败', { error: msg });
      }
    }

    // 2. 重建 BM25 索引（全量重载）
    if (!this.bm25Retriever) {
      errors.push('bm25_retriever_not_injected');
      this.logger?.warn('LawUpdatePipeline: BM25Retriever 未注入，跳过索引重建');
    } else {
      try {
        await this.bm25Retriever.loadFromDb();
        bm25Reindexed = true;
        this.logger?.info('LawUpdatePipeline: BM25 索引重建完成', {
          docCount: this.bm25Retriever.size(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`bm25_reindex: ${msg}`);
        this.logger?.error('LawUpdatePipeline: BM25 重建失败', { error: msg });
      }
    }

    // 3. 向量索引更新（可选，需 embedding + vectorStore）
    if (this.embeddingService && this.vectorStore) {
      try {
        vectorUpdated = await this.updateVectorIndex(articleIds);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`vector_update: ${msg}`);
        this.logger?.error('LawUpdatePipeline: 向量更新失败', { error: msg });
      }
    }

    const result: PipelineResult = {
      cacheInvalidated,
      bm25Reindexed,
      vectorUpdated,
      errors,
      durationMs: Date.now() - startedAt,
    };

    this.logger?.info('LawUpdatePipeline: 法条更新管道完成', {
      ...result,
      articleIds: articleIds.length,
    });

    return result;
  }

  /**
   * 案例更新管道：重建 BM25 索引（案例不关联 LLM 缓存）。
   * @param caseIds 受影响的案例 ID 列表
   */
  async onCasePrecedentsUpdated(caseIds: string[]): Promise<PipelineResult> {
    const startedAt = Date.now();
    const errors: string[] = [];
    let bm25Reindexed = false;

    this.logger?.info('LawUpdatePipeline: 案例更新触发索引重建', {
      caseIds: caseIds.length,
    });

    if (!this.bm25Retriever) {
      errors.push('bm25_retriever_not_injected');
      this.logger?.warn('LawUpdatePipeline: BM25Retriever 未注入，跳过索引重建');
    } else {
      try {
        await this.bm25Retriever.loadFromDb();
        bm25Reindexed = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`bm25_reindex: ${msg}`);
        this.logger?.error('LawUpdatePipeline: 案例更新后 BM25 重建失败', { error: msg });
      }
    }

    return {
      cacheInvalidated: 0,
      bm25Reindexed,
      vectorUpdated: 0,
      errors,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * 向量索引更新（占位实现）：
   * MVP 阶段仅记录日志，实际向量化需加载法条全文 → embed → upsert。
   * A3 阶段接入完整管道（含批量 embed + upsert + 增量更新）。
   */
  private async updateVectorIndex(articleIds: string[]): Promise<number> {
    this.logger?.debug('LawUpdatePipeline: 向量索引更新（占位，A3 实现）', {
      articleIds: articleIds.length,
    });
    return 0;
  }
}
