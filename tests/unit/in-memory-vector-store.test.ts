/**
 * InMemoryVectorStore 单元测试（A2-W2）。
 *
 * 覆盖三类场景：
 *   - 正常场景：upsert + search / topK 截断 / filter 精确匹配
 *   - 边界场景：空库 search / 同 id 覆盖 / delete / size
 *   - 相似度函数：cosineSimilarity 正交/同向/反向/零向量
 *
 * 实现注：直接 new InMemoryVectorStore()，无需 DI。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryVectorStore,
  cosineSimilarity,
} from '../../src/modules/legal/embedding/vector-store';
import type { VectorDocMeta } from '../../src/modules/legal/embedding/embedding.types';

function makeMeta(
  id: string,
  collection: 'law_article' | 'case_precedent' = 'law_article',
): VectorDocMeta {
  return { id, collection };
}

describe('InMemoryVectorStore', () => {
  let store: InMemoryVectorStore;

  beforeEach(() => {
    store = new InMemoryVectorStore();
  });

  describe('正常场景', () => {
    it('upsert 后 search 能检索到对应向量', async () => {
      const vec = [1, 0, 0, 0];
      await store.upsert('doc-1', vec, makeMeta('doc-1'));
      const results = await store.search([1, 0, 0, 0]);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('doc-1');
      expect(results[0].score).toBeCloseTo(1, 6);
    });

    it('search 返回结果按相似度降序排列', async () => {
      await store.upsert('doc-1', [1, 0, 0, 0], makeMeta('doc-1'));
      await store.upsert('doc-2', [0.9, 0.1, 0, 0], makeMeta('doc-2'));
      await store.upsert('doc-3', [0, 1, 0, 0], makeMeta('doc-3'));
      const results = await store.search([1, 0, 0, 0]);
      expect(results[0].id).toBe('doc-1'); // 完全匹配
      expect(results[1].id).toBe('doc-2'); // 近似
      expect(results[2].id).toBe('doc-3'); // 正交
      expect(results[0].score).toBeGreaterThan(results[1].score);
      expect(results[1].score).toBeGreaterThan(results[2].score);
    });

    it('topK 截断结果数量', async () => {
      for (let i = 0; i < 5; i++) {
        await store.upsert(`doc-${i}`, [i * 0.1, 1 - i * 0.1, 0, 0], makeMeta(`doc-${i}`));
      }
      const results = await store.search([0, 1, 0, 0], { topK: 3 });
      expect(results).toHaveLength(3);
    });

    it('filter 按 meta 字段精确匹配过滤', async () => {
      await store.upsert('doc-1', [1, 0, 0, 0], {
        id: 'doc-1',
        collection: 'law_article',
        category: '民事',
      });
      await store.upsert('doc-2', [1, 0, 0, 0], {
        id: 'doc-2',
        collection: 'case_precedent',
        category: '民事',
      });
      await store.upsert('doc-3', [1, 0, 0, 0], {
        id: 'doc-3',
        collection: 'law_article',
        category: '刑事',
      });
      const results = await store.search([1, 0, 0, 0], {
        filter: { collection: 'law_article', category: '民事' },
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('doc-1');
    });
  });

  describe('边界场景', () => {
    it('空库 search 返回空数组', async () => {
      const results = await store.search([1, 0, 0, 0]);
      expect(results).toEqual([]);
    });

    it('同 id upsert 覆盖旧向量', async () => {
      await store.upsert('doc-1', [1, 0, 0, 0], makeMeta('doc-1'));
      await store.upsert('doc-1', [0, 1, 0, 0], makeMeta('doc-1'));
      const results = await store.search([0, 1, 0, 0]);
      expect(results).toHaveLength(1);
      expect(results[0].score).toBeCloseTo(1, 6);
      // 旧向量不再匹配
      const oldResults = await store.search([1, 0, 0, 0]);
      expect(oldResults[0].score).toBeLessThan(1);
    });

    it('delete 移除向量后 search 不再返回', async () => {
      await store.upsert('doc-1', [1, 0, 0, 0], makeMeta('doc-1'));
      expect(store.size()).toBe(1);
      await store.delete('doc-1');
      expect(store.size()).toBe(0);
      const results = await store.search([1, 0, 0, 0]);
      expect(results).toEqual([]);
    });

    it('delete 不存在的 id 不报错', async () => {
      await expect(store.delete('nonexistent')).resolves.toBeUndefined();
      expect(store.size()).toBe(0);
    });

    it('size 返回当前存储条数', async () => {
      expect(store.size()).toBe(0);
      await store.upsert('doc-1', [1, 0], makeMeta('doc-1'));
      expect(store.size()).toBe(1);
      await store.upsert('doc-2', [0, 1], makeMeta('doc-2'));
      expect(store.size()).toBe(2);
      await store.delete('doc-1');
      expect(store.size()).toBe(1);
    });

    it('默认 topK=10', async () => {
      for (let i = 0; i < 15; i++) {
        await store.upsert(`doc-${i}`, [i, 0, 0, 0], makeMeta(`doc-${i}`));
      }
      const results = await store.search([1, 0, 0, 0]);
      expect(results).toHaveLength(10);
    });
  });
});

describe('cosineSimilarity', () => {
  it('同向向量相似度为 1', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
    expect(cosineSimilarity([2, 0, 0], [3, 0, 0])).toBeCloseTo(1, 6);
  });

  it('正交向量相似度为 0', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 6);
  });

  it('反向向量相似度为 -1', () => {
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1, 6);
  });

  it('零向量相似度为 0（避免除零）', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 0, 0])).toBe(0);
    expect(cosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0);
  });

  it('不同维度但长度相同按元素计算', () => {
    // [1,1] 与 [1,0]：cos = 1/(√2 * 1) = 1/√2 ≈ 0.7071
    expect(cosineSimilarity([1, 1], [1, 0])).toBeCloseTo(1 / Math.sqrt(2), 4);
  });
});
