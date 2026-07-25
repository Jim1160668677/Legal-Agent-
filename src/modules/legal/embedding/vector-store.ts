/**
 * VectorStore 接口 + InMemoryVectorStore 实现（A2-W2，A2 §六）。
 *
 * 可插拔向量存储（对齐 A1 可插拔 Provider 模式）：
 *   - InMemoryVectorStore：内存 Map + 余弦相似度，默认启用，开发/测试
 *   - AtlasVectorSearch：$vectorSearch 管道，生产可选（需 Atlas M10+，A2-W2 后期接入）
 *
 * 设计依据：A2 §六 向量索引方案；A2 §4.2 第二路向量召回。
 */
import { Injectable } from '@nestjs/common';
import type { VectorDocMeta, VectorSearchResult } from './embedding.types';
import { VECTOR_STORE_TOKEN } from './embedding.types';

export { VECTOR_STORE_TOKEN };

/** 向量存储接口（可插拔） */
export interface VectorStore {
  readonly name: string;
  /** 写入/更新向量（同 id 覆盖） */
  upsert(id: string, vector: number[], meta: VectorDocMeta): Promise<void>;
  /** 相似度检索；filter 按 meta 字段精确匹配（category/causeOfAction 等） */
  search(
    queryVector: number[],
    opts?: { topK?: number; filter?: Record<string, unknown> },
  ): Promise<VectorSearchResult[]>;
  /** 删除单条 */
  delete(id: string): Promise<void>;
  /** 当前存储条数（调试/测试用） */
  size(): number;
}

/** 余弦相似度（向量需同维度；归一化向量下等价于点积） */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * InMemoryVectorStore —— 内存余弦相似度检索（A2-W2 默认）。
 * 适用于开发/测试与小规模数据；生产规模检索走 Atlas VectorSearch。
 */
@Injectable()
export class InMemoryVectorStore implements VectorStore {
  readonly name = 'in-memory';
  private readonly store = new Map<string, { vector: number[]; meta: VectorDocMeta }>();

  async upsert(id: string, vector: number[], meta: VectorDocMeta): Promise<void> {
    this.store.set(id, { vector, meta });
  }

  async search(
    queryVector: number[],
    opts?: { topK?: number; filter?: Record<string, unknown> },
  ): Promise<VectorSearchResult[]> {
    const topK = opts?.topK ?? 10;
    const filter = opts?.filter;
    const results: VectorSearchResult[] = [];
    for (const [id, { vector, meta }] of this.store) {
      if (filter && !Object.entries(filter).every(([k, v]) => meta[k] === v)) continue;
      results.push({ id, score: cosineSimilarity(queryVector, vector), meta });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  size(): number {
    return this.store.size;
  }
}
