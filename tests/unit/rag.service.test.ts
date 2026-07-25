/**
 * RagService 单元测试（A2-W3）。
 *
 * 覆盖：
 *   - 正常场景：三路召回 + RRF 融合 / 多路命中 RRF 累加
 *   - 边界场景：空查询 / 单路命中 / 无依赖注入 / finalTopK 截断
 *   - 异常场景：单路失败不影响其他路
 *
 * 实现注：手动 new RagService(...) 绕过 DI，mock 四个依赖（bm25/embedding/vector/kb）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RagService } from '../../src/modules/legal/retrieval/rag.service';
import type { RetrievalResult, Retriever } from '../../src/modules/legal/retrieval/retrieval.types';
import { requestContext } from '../../src/common/context/request-context';

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

/** 构造 mock BM25 Retriever */
function makeBm25Retriever(results: RetrievalResult[] = []): Retriever {
  return {
    name: 'mock-bm25',
    retrieve: vi.fn().mockResolvedValue(results),
  };
}

/** 构造 mock EmbeddingService */
function makeEmbeddingService(vec: number[] = [1, 0, 0]) {
  return {
    embed: vi.fn().mockResolvedValue(vec),
    embedBatch: vi.fn(),
    dimension: 3,
  };
}

/** 构造 mock VectorStore */
function makeVectorStore(
  results: Array<{ id: string; score: number; meta: Record<string, unknown> }> = [],
) {
  return {
    name: 'mock-vector',
    search: vi.fn().mockResolvedValue(results),
    upsert: vi.fn(),
    delete: vi.fn(),
    size: vi.fn().mockReturnValue(0),
  };
}

/** 构造 mock KnowledgeBaseService */
function makeKnowledgeBase(
  results: Array<{
    type: string;
    title: string;
    content: string;
    score: number;
    lawRefs?: unknown[];
  }> = [],
) {
  return {
    queryByKeyword: vi.fn().mockResolvedValue(results),
    queryByType: vi.fn(),
    getById: vi.fn(),
  };
}

/** 在 requestContext 内运行检索 */
async function retrieve(svc: RagService, text: string, opts?: { finalTopK?: number }) {
  return new Promise<RetrievalResult[]>((resolve) => {
    requestContext.run({ traceId: 'trace-test', userId: 'u1', startedAt: 0 }, async () => {
      const results = await svc.retrieve({ text, ...opts });
      resolve(results);
    });
  });
}

describe('RagService', () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  describe('正常场景：三路召回 + RRF 融合', () => {
    it('三路均返回结果，按 RRF 分数降序融合', async () => {
      const bm25Results: RetrievalResult[] = [
        {
          id: 'doc-a',
          collection: 'law_article',
          title: '法条A',
          content: '内容A',
          pathScore: 5,
          paths: ['bm25'],
        },
        {
          id: 'doc-b',
          collection: 'law_article',
          title: '法条B',
          content: '内容B',
          pathScore: 3,
          paths: ['bm25'],
        },
      ];
      const vectorResults = [
        {
          id: 'doc-a',
          score: 0.9,
          meta: { id: 'doc-a', collection: 'law_article', title: '法条A', content: '内容A' },
        },
        {
          id: 'doc-c',
          score: 0.8,
          meta: { id: 'doc-c', collection: 'case_precedent', title: '案例C', content: '内容C' },
        },
      ];
      const kbResults = [{ type: 'faq', title: '常见问题', content: '解答', score: 1.0 }];

      const svc = new RagService(
        makeBm25Retriever(bm25Results),
        makeEmbeddingService() as never,
        makeVectorStore(vectorResults) as never,
        makeKnowledgeBase(kbResults) as never,
        logger,
      );

      const results = await retrieve(svc, '查询');

      // 三路结果：doc-a(bm25+vector), doc-b(bm25), doc-c(vector), faq(structured) = 4 条
      expect(results).toHaveLength(4);
      // doc-a 两路命中，RRF 分数最高
      expect(results[0].id).toBe('doc-a');
      expect(results[0].paths).toEqual(expect.arrayContaining(['bm25', 'vector']));
      expect(results[0].rrfScore).toBeGreaterThan(results[1].rrfScore ?? 0);
    });

    it('多路命中同一文档时 paths 合并 + rrfScore 累加', async () => {
      const bm25Results: RetrievalResult[] = [
        {
          id: 'doc-x',
          collection: 'law_article',
          title: 'X',
          content: 'C',
          pathScore: 10,
          paths: ['bm25'],
        },
      ];
      const vectorResults = [
        {
          id: 'doc-x',
          score: 0.95,
          meta: { id: 'doc-x', collection: 'law_article', title: 'X', content: 'C' },
        },
      ];

      const svc = new RagService(
        makeBm25Retriever(bm25Results),
        makeEmbeddingService() as never,
        makeVectorStore(vectorResults) as never,
        undefined,
        logger,
      );

      const results = await retrieve(svc, '查询');
      expect(results).toHaveLength(1);
      expect(results[0].paths).toEqual(['bm25', 'vector']);
      // RRF: 1/(60+1) + 1/(60+1) ≈ 0.0328
      expect(results[0].rrfScore).toBeCloseTo(2 / 61, 4);
    });
  });

  describe('边界场景', () => {
    it('空查询返回空数组', async () => {
      const svc = new RagService(
        makeBm25Retriever(),
        makeEmbeddingService() as never,
        makeVectorStore() as never,
        makeKnowledgeBase() as never,
        logger,
      );
      const results = await retrieve(svc, '');
      expect(results).toEqual([]);
    });

    it('仅空格查询返回空数组', async () => {
      const svc = new RagService(
        makeBm25Retriever(),
        makeEmbeddingService() as never,
        makeVectorStore() as never,
        makeKnowledgeBase() as never,
        logger,
      );
      const results = await retrieve(svc, '   ');
      expect(results).toEqual([]);
    });

    it('单路命中（仅 BM25）也能返回结果', async () => {
      const bm25Results: RetrievalResult[] = [
        {
          id: 'doc-1',
          collection: 'law_article',
          title: 'T',
          content: 'C',
          pathScore: 5,
          paths: ['bm25'],
        },
      ];
      const svc = new RagService(
        makeBm25Retriever(bm25Results),
        undefined, // 无 embedding
        undefined, // 无 vector store
        undefined, // 无 knowledge base
        logger,
      );
      const results = await retrieve(svc, '查询');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('doc-1');
      expect(results[0].paths).toEqual(['bm25']);
    });

    it('无任何依赖注入时返回空数组', async () => {
      const svc = new RagService(undefined, undefined, undefined, undefined, logger);
      const results = await retrieve(svc, '查询');
      expect(results).toEqual([]);
    });

    it('finalTopK 截断最终结果数', async () => {
      const bm25Results: RetrievalResult[] = Array.from({ length: 5 }, (_, i) => ({
        id: `doc-${i}`,
        collection: 'law_article' as const,
        title: `T${i}`,
        content: `C${i}`,
        pathScore: 5 - i,
        paths: ['bm25' as const],
      }));
      const svc = new RagService(
        makeBm25Retriever(bm25Results),
        undefined,
        undefined,
        undefined,
        logger,
      );
      const results = await retrieve(svc, '查询', { finalTopK: 3 });
      expect(results).toHaveLength(3);
    });
  });

  describe('异常场景：单路失败不影响其他路', () => {
    it('BM25 路抛错 → 向量路与结构化路仍正常返回', async () => {
      const failingBm25: Retriever = {
        name: 'failing-bm25',
        retrieve: vi.fn().mockRejectedValue(new Error('bm25 boom')),
      };
      const vectorResults = [
        {
          id: 'doc-v',
          score: 0.9,
          meta: { id: 'doc-v', collection: 'law_article', title: 'V', content: 'C' },
        },
      ];
      const kbResults = [{ type: 'faq', title: 'FAQ', content: 'A', score: 1.0 }];

      const svc = new RagService(
        failingBm25,
        makeEmbeddingService() as never,
        makeVectorStore(vectorResults) as never,
        makeKnowledgeBase(kbResults) as never,
        logger,
      );

      const results = await retrieve(svc, '查询');
      // BM25 失败，但向量 + 结构化仍返回
      expect(results).toHaveLength(2);
      expect(logger.warn).toHaveBeenCalledWith(
        'BM25 召回失败，跳过该路',
        expect.objectContaining({ error: 'bm25 boom' }),
      );
    });

    it('向量路抛错 → BM25 与结构化路仍正常返回', async () => {
      const failingEmbedding = {
        embed: vi.fn().mockRejectedValue(new Error('embedding boom')),
        embedBatch: vi.fn(),
        dimension: 3,
      };
      const bm25Results: RetrievalResult[] = [
        {
          id: 'doc-b',
          collection: 'law_article',
          title: 'B',
          content: 'C',
          pathScore: 5,
          paths: ['bm25'],
        },
      ];

      const svc = new RagService(
        makeBm25Retriever(bm25Results),
        failingEmbedding as never,
        makeVectorStore() as never,
        makeKnowledgeBase([{ type: 'faq', title: 'F', content: 'A', score: 1 }]) as never,
        logger,
      );

      const results = await retrieve(svc, '查询');
      expect(results).toHaveLength(2); // BM25 + structured
      expect(logger.warn).toHaveBeenCalledWith(
        '向量召回失败，跳过该路',
        expect.objectContaining({ error: 'embedding boom' }),
      );
    });

    it('结构化路抛错 → BM25 与向量路仍正常返回', async () => {
      const failingKb = {
        queryByKeyword: vi.fn().mockRejectedValue(new Error('kb boom')),
        queryByType: vi.fn(),
        getById: vi.fn(),
      };
      const bm25Results: RetrievalResult[] = [
        {
          id: 'doc-b',
          collection: 'law_article',
          title: 'B',
          content: 'C',
          pathScore: 5,
          paths: ['bm25'],
        },
      ];

      const svc = new RagService(
        makeBm25Retriever(bm25Results),
        makeEmbeddingService() as never,
        makeVectorStore([
          {
            id: 'doc-v',
            score: 0.9,
            meta: { id: 'doc-v', collection: 'law_article', title: 'V', content: 'C' },
          },
        ]) as never,
        failingKb as never,
        logger,
      );

      const results = await retrieve(svc, '查询');
      expect(results).toHaveLength(2); // BM25 + vector
      expect(logger.warn).toHaveBeenCalledWith(
        '结构化召回失败，跳过该路',
        expect.objectContaining({ error: 'kb boom' }),
      );
    });
  });
});
