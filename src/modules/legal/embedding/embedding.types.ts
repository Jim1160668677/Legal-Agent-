/**
 * Embedding 共享类型与 Provider 接口（A2-W2，A2 §五）。
 *
 * 可插拔 Provider 架构（对齐 A1 ContentSafety 的 PassThrough 模式）：
 *   - MockEmbeddingProvider：确定性哈希向量，默认启用，用于开发/测试（无外部依赖）
 *   - AgnesEmbeddingProvider：真实 OpenAI 兼容 /embeddings 端点，需 EMBEDDING_API_KEY
 *
 * EmbeddingService 负责 embed/embedBatch + 向量缓存（Redis，TTL 30 天，A2 §五）。
 * VectorStore 抽象负责向量存储与相似度检索（InMemory 默认 / Atlas Vector Search 可选）。
 */

/** Embedding Provider 接口（可插拔） */
export interface EmbeddingProvider {
  readonly name: string;
  readonly dimension: number;
  /** 批量向量化；返回顺序与入参一致 */
  embed(texts: string[]): Promise<number[][]>;
}

/** Embedding Provider 注入 Token */
export const EMBEDDING_PROVIDER_TOKEN = 'EMBEDDING_PROVIDER';

/** VectorStore 注入 Token */
export const VECTOR_STORE_TOKEN = 'VECTOR_STORE';

/** Embedding 配置（AppConfig.embedding 段，A2-W2） */
export interface EmbeddingConfig {
  provider: 'mock' | 'agnes';
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 向量维度（mock/agnes 需一致） */
  dimension: number;
  /** 批量向量化每批大小（限流，A2 §五：10 条/批） */
  batchSize: number;
  /** 向量缓存 TTL（秒），默认 30 天 */
  cacheTtlSec: number;
}

/** 向量存储元数据（检索结果附带） */
export interface VectorDocMeta {
  id: string;
  collection: 'law_article' | 'case_precedent';
  [key: string]: unknown;
}

/** 向量检索结果 */
export interface VectorSearchResult {
  id: string;
  score: number;
  meta: VectorDocMeta;
}
