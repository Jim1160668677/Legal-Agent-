/**
 * 检索共享类型 + RRF 融合配置（A2-W3，A2 §4.2 三路召回）。
 *
 * 三路召回架构：
 *   - BM25：基于词频的文本相关性（Okapi BM25，对中文用字符 bigram）
 *   - 向量：语义相似度（EmbeddingService + VectorStore，A2-W2 基础设施）
 *   - 结构化：KnowledgeBase 关键词检索（A2-W1，流程/材料/术语/FAQ/模板）
 *
 * RRF（Reciprocal Rank Fusion）将三路结果融合为统一排序列表：
 *   score(d) = Σ_path weight_path / (k + rank_path(d))
 *   k=60（标准默认值），各路默认均等权重 1.0
 *
 * 设计依据：A2 §4.2 第二路向量召回 + RRF 融合；A2-W3 交付物。
 */
import type { LawRef } from '../../../types/llm';

/** 检索来源路径 */
export type RetrievalPath = 'bm25' | 'vector' | 'structured';

/** 检索结果集合来源 */
export type RetrievalCollection = 'law_article' | 'case_precedent' | 'legal_knowledge';

/** BM25 Retriever 注入 Token */
export const BM25_RETRIEVER_TOKEN = 'BM25_RETRIEVER';

/** 检索结果统一格式（三路共用） */
export interface RetrievalResult {
  /** 文档唯一标识（contentHash / _id / knowledgeId） */
  id: string;
  collection: RetrievalCollection;
  title: string;
  content: string;
  /** 原始路径得分（BM25 score / cosine similarity / keyword score） */
  pathScore: number;
  /** RRF 融合后得分（融合后填充） */
  rrfScore?: number;
  /** 命中路径集合（多路命中时合并） */
  paths: RetrievalPath[];
  /** 法条引用（如有） */
  lawRefs?: LawRef[];
  /** 附加元数据（category / causeOfAction / type 等，用于过滤与展示） */
  meta?: Record<string, unknown>;
}

/** 检索查询参数 */
export interface RetrievalQuery {
  text: string;
  /** 限定检索集合（默认全部） */
  collections?: RetrievalCollection[];
  /** 元数据过滤（传给向量检索 filter） */
  filter?: Record<string, unknown>;
  /** 每路召回数（默认 10） */
  topKPerPath?: number;
  /** 最终融合后返回数（默认 10） */
  finalTopK?: number;
}

/** RRF 融合配置 */
export interface RrfConfig {
  /** RRF k 参数（默认 60，标准值） */
  k: number;
  /** 各路权重（默认均等 1.0） */
  weights: Record<RetrievalPath, number>;
}

/** 默认 RRF 配置 */
export const DEFAULT_RRF_CONFIG: RrfConfig = {
  k: 60,
  weights: { bm25: 1.0, vector: 1.0, structured: 1.0 },
};

/** Retriever 接口（可插拔，对齐 EmbeddingProvider/VectorStore 模式） */
export interface Retriever {
  readonly name: string;
  /** 单路检索：返回按 pathScore 降序的结果 */
  retrieve(
    query: string,
    opts?: { topK?: number; filter?: Record<string, unknown> },
  ): Promise<RetrievalResult[]>;
}

/** BM25 索引文档（内部用） */
export interface Bm25Document {
  id: string;
  collection: RetrievalCollection;
  title: string;
  content: string;
  /** 预分词 token；为空时由 addDocument 自动分词 */
  tokens?: string[];
  lawRefs?: LawRef[];
  meta?: Record<string, unknown>;
}
