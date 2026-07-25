/**
 * RagService 检索集成测试（A2-W4）。
 *
 * 用种子法条数据（LAW_ARTICLES）构建真实 BM25 索引，端到端验证检索质量。
 * 不依赖 MongoDB / Redis / Embedding API，纯内存。
 *
 * 覆盖：
 *   - 法条引用查询（"民法典第一百四十三条" → 命中 民法典#143）
 *   - 关键词查询（"诉讼时效" → 命中 民法典#188）
 *   - 场景查询（"对方不履行合同" → 命中 民法典#577）
 *   - 无结果查询
 *   - 多结果查询（"犯罪" → 命中多条刑法）
 *
 * 实现注：构建 InMemoryBm25Retriever + RagService（仅 BM25 路），
 *       跳过向量路与结构化路（无外部依赖）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { InMemoryBm25Retriever } from '../../src/modules/legal/retrieval/in-memory-bm25.retriever';
import { RagService } from '../../src/modules/legal/retrieval/rag.service';
import { LAW_ARTICLES } from '../../src/data/lawArticles';

function docId(lawName: string, articleNoInt: number): string {
  return `${lawName}#${articleNoInt}`;
}

function buildRetriever(): InMemoryBm25Retriever {
  const mockModel = {
    find: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }),
  };
  const retriever = new InMemoryBm25Retriever(mockModel as never, mockModel as never);
  for (const art of LAW_ARTICLES) {
    if (art.status !== 'effective') continue;
    retriever.addDocument({
      id: docId(art.lawName, art.articleNoInt),
      collection: 'law_article',
      title: `${art.lawName} ${art.articleNo}`,
      content: art.content,
      lawRefs: [{ ref: `${art.lawName}第${art.articleNo}` }],
      meta: { lawName: art.lawName, articleNo: art.articleNo, category: art.category },
    });
  }
  return retriever;
}

describe('RagService 检索集成测试（种子数据端到端）', () => {
  let ragService: RagService;
  let retriever: InMemoryBm25Retriever;

  beforeAll(() => {
    retriever = buildRetriever();
    ragService = new RagService(retriever, undefined, undefined, undefined, undefined);
  });

  describe('法条引用查询', () => {
    it('"民法典第一百四十三条" → top1 命中 民法典#143', async () => {
      const results = await ragService.retrieve({ text: '民法典第一百四十三条' });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('民法典#143');
    });

    it('"刑法第232条" → 命中 刑法#232', async () => {
      const results = await ragService.retrieve({ text: '刑法第232条' });
      expect(results.some((r) => r.id === '刑法#232')).toBe(true);
    });

    it('"劳动合同法第四十七条" → 命中 劳动合同法#47', async () => {
      const results = await ragService.retrieve({ text: '劳动合同法第四十七条' });
      expect(results.some((r) => r.id === '劳动合同法#47')).toBe(true);
    });
  });

  describe('关键词查询', () => {
    it('"诉讼时效" → 命中 民法典#188', async () => {
      const results = await ragService.retrieve({ text: '诉讼时效几年' });
      expect(results.some((r) => r.id === '民法典#188')).toBe(true);
    });

    it('"正当防卫" → 命中 刑法#20', async () => {
      const results = await ragService.retrieve({ text: '正当防卫不负刑事责任' });
      expect(results.some((r) => r.id === '刑法#20')).toBe(true);
    });

    it('"经济补偿金" → 命中 劳动合同法#47', async () => {
      const results = await ragService.retrieve({ text: '经济补偿金怎么算' });
      expect(results.some((r) => r.id === '劳动合同法#47')).toBe(true);
    });
  });

  describe('场景查询', () => {
    it('"对方不履行合同义务" → 命中 民法典#577', async () => {
      const results = await ragService.retrieve({ text: '对方不履行合同义务怎么追责' });
      expect(results.some((r) => r.id === '民法典#577')).toBe(true);
    });

    it('"离婚财产分割" → 命中 民法典#1087', async () => {
      const results = await ragService.retrieve({ text: '离婚财产怎么分割' });
      expect(results.some((r) => r.id === '民法典#1087')).toBe(true);
    });
  });

  describe('多结果查询', () => {
    it('"犯罪" → 命中多条刑法（至少 2 条）', async () => {
      const results = await ragService.retrieve({ text: '犯罪' });
      const criminalLawHits = results.filter((r) => r.id.startsWith('刑法#'));
      expect(criminalLawHits.length).toBeGreaterThanOrEqual(2);
    });

    it('"侵权" → 命中 民法典#1165 和 民法典#1179', async () => {
      const results = await ragService.retrieve({ text: '侵权' });
      const ids = results.map((r) => r.id);
      expect(ids).toContain('民法典#1165');
      expect(ids).toContain('民法典#1179');
    });
  });

  describe('边界场景', () => {
    it('无匹配查询返回空数组', async () => {
      // 用纯 ASCII 无意义串确保不命中任何中文 token
      const results = await ragService.retrieve({ text: 'zzzqqqxxx-no-match' });
      expect(results).toEqual([]);
    });

    it('空查询返回空数组', async () => {
      const results = await ragService.retrieve({ text: '' });
      expect(results).toEqual([]);
    });

    it('finalTopK 截断生效', async () => {
      const results = await ragService.retrieve({ text: '诉讼', finalTopK: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('BM25 索引完整性', () => {
    it('索引包含全部有效法条', () => {
      const effectiveCount = LAW_ARTICLES.filter((a) => a.status === 'effective').length;
      expect(retriever.size()).toBe(effectiveCount);
    });
  });
});
