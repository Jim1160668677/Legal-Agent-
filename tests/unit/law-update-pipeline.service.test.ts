/**
 * LawUpdatePipelineService 单元测试（A2-W4）。
 *
 * 覆盖：
 *   - 正常场景：法条更新 → 缓存失效 + BM25 重建
 *   - 边界场景：无缓存注入 / 空文章列表 / 案例更新（仅 BM25）
 *   - 异常场景：缓存失效失败不阻塞 BM25 / BM25 失败不阻塞缓存
 *
 * 实现注：手动 new LawUpdatePipelineService(mocks) 绕过 DI。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LawUpdatePipelineService } from '../../src/modules/legal/retrieval/law-update-pipeline.service';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    log: vi.fn(),
  };
}

function makeCache(invalidatedCount = 5) {
  return {
    invalidateByLawArticle: vi.fn().mockResolvedValue(invalidatedCount),
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    getLlmCache: vi.fn(),
    setLlmCache: vi.fn(),
  };
}

function makeBm25Retriever(docCount = 31) {
  return {
    loadFromDb: vi.fn().mockResolvedValue(undefined),
    size: vi.fn().mockReturnValue(docCount),
    retrieve: vi.fn(),
    addDocument: vi.fn(),
  };
}

describe('LawUpdatePipelineService', () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  describe('正常场景：法条更新管道', () => {
    it('缓存失效 + BM25 重建均成功', async () => {
      const cache = makeCache(7);
      const bm25 = makeBm25Retriever(35);
      const svc = new LawUpdatePipelineService(
        cache as never,
        bm25 as never,
        undefined,
        undefined,
        logger,
      );

      const result = await svc.onLawArticlesUpdated(['doc-1', 'doc-2']);

      expect(result.cacheInvalidated).toBe(7);
      expect(result.bm25Reindexed).toBe(true);
      expect(result.vectorUpdated).toBe(0);
      expect(result.errors).toEqual([]);
      expect(cache.invalidateByLawArticle).toHaveBeenCalledWith(['doc-1', 'doc-2']);
      expect(bm25.loadFromDb).toHaveBeenCalledOnce();
    });

    it('返回正确的 durationMs', async () => {
      const svc = new LawUpdatePipelineService(
        makeCache() as never,
        makeBm25Retriever() as never,
        undefined,
        undefined,
        logger,
      );
      const result = await svc.onLawArticlesUpdated(['doc-1']);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('边界场景', () => {
    it('无缓存注入时跳过缓存失效，仍重建 BM25', async () => {
      const bm25 = makeBm25Retriever();
      const svc = new LawUpdatePipelineService(
        undefined,
        bm25 as never,
        undefined,
        undefined,
        logger,
      );

      const result = await svc.onLawArticlesUpdated(['doc-1']);

      expect(result.cacheInvalidated).toBe(0);
      expect(result.bm25Reindexed).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('空文章列表不调缓存失效，仍重建 BM25', async () => {
      const cache = makeCache();
      const bm25 = makeBm25Retriever();
      const svc = new LawUpdatePipelineService(
        cache as never,
        bm25 as never,
        undefined,
        undefined,
        logger,
      );

      const result = await svc.onLawArticlesUpdated([]);

      expect(result.cacheInvalidated).toBe(0);
      expect(cache.invalidateByLawArticle).not.toHaveBeenCalled();
      expect(result.bm25Reindexed).toBe(true);
    });

    it('案例更新仅重建 BM25（不失效缓存）', async () => {
      const cache = makeCache();
      const bm25 = makeBm25Retriever();
      const svc = new LawUpdatePipelineService(
        cache as never,
        bm25 as never,
        undefined,
        undefined,
        logger,
      );

      const result = await svc.onCasePrecedentsUpdated(['case-1', 'case-2']);

      expect(result.cacheInvalidated).toBe(0);
      expect(result.bm25Reindexed).toBe(true);
      expect(cache.invalidateByLawArticle).not.toHaveBeenCalled();
      expect(bm25.loadFromDb).toHaveBeenCalledOnce();
    });
  });

  describe('异常场景：单步失败不阻塞其他步骤', () => {
    it('缓存失效失败 → BM25 仍重建', async () => {
      const cache = makeCache();
      cache.invalidateByLawArticle.mockRejectedValueOnce(new Error('redis down'));
      const bm25 = makeBm25Retriever();
      const svc = new LawUpdatePipelineService(
        cache as never,
        bm25 as never,
        undefined,
        undefined,
        logger,
      );

      const result = await svc.onLawArticlesUpdated(['doc-1']);

      expect(result.cacheInvalidated).toBe(0);
      expect(result.bm25Reindexed).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('cache_invalidate');
      expect(logger.error).toHaveBeenCalledWith(
        'LawUpdatePipeline: 缓存失效失败',
        expect.objectContaining({ error: 'redis down' }),
      );
    });

    it('BM25 重建失败 → 缓存仍失效', async () => {
      const cache = makeCache(3);
      const bm25 = makeBm25Retriever();
      bm25.loadFromDb.mockRejectedValueOnce(new Error('mongo down'));
      const svc = new LawUpdatePipelineService(
        cache as never,
        bm25 as never,
        undefined,
        undefined,
        logger,
      );

      const result = await svc.onLawArticlesUpdated(['doc-1']);

      expect(result.cacheInvalidated).toBe(3);
      expect(result.bm25Reindexed).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('bm25_reindex');
    });

    it('全部步骤失败 → errors 含两条', async () => {
      const cache = makeCache();
      cache.invalidateByLawArticle.mockRejectedValueOnce(new Error('redis down'));
      const bm25 = makeBm25Retriever();
      bm25.loadFromDb.mockRejectedValueOnce(new Error('mongo down'));
      const svc = new LawUpdatePipelineService(
        cache as never,
        bm25 as never,
        undefined,
        undefined,
        logger,
      );

      const result = await svc.onLawArticlesUpdated(['doc-1']);

      expect(result.cacheInvalidated).toBe(0);
      expect(result.bm25Reindexed).toBe(false);
      expect(result.errors).toHaveLength(2);
    });
  });
});
