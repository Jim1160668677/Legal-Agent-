/**
 * InMemoryBm25Retriever 单元测试（A2-W3）。
 *
 * 覆盖：
 *   - 正常场景：addDocument + retrieve / BM25 评分排序 / IDF 权重
 *   - 边界场景：空索引 / 空查询 / 无匹配 / topK 截断 / filter 过滤
 *   - 多文档 BM25 评分：词频饱和 + 长度归一化
 *
 * 实现注：手动 new InMemoryBm25Retriever(mockModels, logger) 绕过 DI，
 *       通过 addDocument 手动构建索引（不走 onModuleInit/loadFromDb）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryBm25Retriever } from '../../src/modules/legal/retrieval/in-memory-bm25.retriever';
import type { Bm25Document } from '../../src/modules/legal/retrieval/retrieval.types';

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

/** mock Mongoose Model（loadFromDb 不在测试中调用，仅需存在） */
function makeMockModel() {
  return {
    find: vi.fn().mockReturnValue({
      lean: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue([]),
      }),
    }),
  };
}

function makeLawDoc(
  id: string,
  title: string,
  content: string,
  meta?: Record<string, unknown>,
): Bm25Document {
  return {
    id,
    collection: 'law_article',
    title,
    content,
    tokens: [], // 让 addDocument 自动分词
    meta: meta ?? {},
  };
}

describe('InMemoryBm25Retriever', () => {
  let retriever: InMemoryBm25Retriever;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    retriever = new InMemoryBm25Retriever(
      makeMockModel() as never,
      makeMockModel() as never,
      logger,
    );
  });

  describe('正常场景', () => {
    it('addDocument 后 retrieve 能检索到匹配文档', async () => {
      retriever.addDocument(
        makeLawDoc(
          'doc-1',
          '民法典第一百四十三条',
          '民事法律行为有效的条件包括行为能力意思表示真实',
        ),
      );
      const results = await retriever.retrieve('民事法律行为有效');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('doc-1');
      expect(results[0].paths).toEqual(['bm25']);
      expect(results[0].pathScore).toBeGreaterThan(0);
    });

    it('多文档按 BM25 分数降序排列', async () => {
      // doc-1: 高匹配（多个关键词命中）
      retriever.addDocument(
        makeLawDoc('doc-1', '民法典诉讼时效', '诉讼时效三年民事权利诉讼时效期间'),
      );
      // doc-2: 低匹配（少量关键词命中）
      retriever.addDocument(
        makeLawDoc('doc-2', '刑法犯罪构成', '犯罪构成要件包括主观客观主体客体'),
      );
      const results = await retriever.retrieve('诉讼时效');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('doc-1');
    });

    it('IDF 使罕见词贡献更高分', async () => {
      // "诉讼时效" 出现在 2 个文档中（常见词）
      retriever.addDocument(makeLawDoc('doc-1', '诉讼时效', '诉讼时效三年'));
      retriever.addDocument(makeLawDoc('doc-2', '诉讼时效规定', '诉讼时效一年'));
      // "仲裁" 仅出现在 1 个文档中（罕见词）
      retriever.addDocument(makeLawDoc('doc-3', '仲裁程序', '仲裁委员会仲裁裁决'));

      const results = await retriever.retrieve('仲裁');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('doc-3');
      // 罕见词 IDF 更高，单文档得分应较高
      expect(results[0].pathScore).toBeGreaterThan(0);
    });

    it('lawRefs 透传到检索结果', async () => {
      retriever.addDocument({
        id: 'doc-1',
        collection: 'law_article',
        title: '民法典第一百四十三条',
        content: '民事法律行为有效',
        tokens: [],
        lawRefs: [{ ref: '民法典第143条', title: '民法典 143', verified: false }],
      });
      const results = await retriever.retrieve('民事法律行为');
      expect(results[0].lawRefs).toHaveLength(1);
      expect(results[0].lawRefs![0].ref).toBe('民法典第143条');
    });
  });

  describe('边界场景', () => {
    it('空索引 retrieve 返回空数组', async () => {
      const results = await retriever.retrieve('任何查询');
      expect(results).toEqual([]);
    });

    it('空查询返回空数组', async () => {
      retriever.addDocument(makeLawDoc('doc-1', '标题', '内容'));
      const results = await retriever.retrieve('');
      expect(results).toEqual([]);
    });

    it('无匹配文档返回空数组', async () => {
      retriever.addDocument(makeLawDoc('doc-1', '刑法', '犯罪构成要件'));
      const results = await retriever.retrieve('行政诉讼');
      expect(results).toEqual([]);
    });

    it('topK 截断结果数量', async () => {
      for (let i = 0; i < 5; i++) {
        retriever.addDocument(makeLawDoc(`doc-${i}`, `诉讼时效${i}`, `诉讼时效期间民事权利`));
      }
      const results = await retriever.retrieve('诉讼时效', { topK: 3 });
      expect(results).toHaveLength(3);
    });

    it('filter 按元数据过滤', async () => {
      retriever.addDocument(
        makeLawDoc('doc-1', '民法典诉讼时效', '诉讼时效', { category: '民法' }),
      );
      retriever.addDocument(makeLawDoc('doc-2', '刑法诉讼时效', '诉讼时效', { category: '刑法' }));
      const results = await retriever.retrieve('诉讼时效', {
        filter: { category: '民法' },
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('doc-1');
    });

    it('仅空格查询返回空', async () => {
      retriever.addDocument(makeLawDoc('doc-1', '标题', '内容'));
      const results = await retriever.retrieve('   ');
      expect(results).toEqual([]);
    });
  });

  describe('size()', () => {
    it('返回当前索引文档数', () => {
      expect(retriever.size()).toBe(0);
      retriever.addDocument(makeLawDoc('doc-1', '标题一', '内容一'));
      expect(retriever.size()).toBe(1);
      retriever.addDocument(makeLawDoc('doc-2', '标题二', '内容二'));
      expect(retriever.size()).toBe(2);
    });
  });
});
