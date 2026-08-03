/**
 * 知识检索结果模型
 */
export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  type: KnowledgeType;
  source: string;
  relevanceScore: number;
  publishDate?: number;
  tags?: string[];
  url?: string;
}

export type KnowledgeType = 'law' | 'regulation' | 'case' | 'interpretation' | 'policy';

export interface KnowledgeRetrieveRequest {
  query: string;
  topK?: number;
  category?: KnowledgeType;
  tags?: string[];
}

export interface KnowledgeRetrieveResponse {
  success: boolean;
  data: KnowledgeItem[];
  total: number;
  query: string;
  searchTime: number;
  error: ApiError | null;
}

export interface HotSearchWord {
  keyword: string;
  count: number;
  category: KnowledgeType;
}

export interface KnowledgeCategory {
  id: string;
  name: string;
  type: KnowledgeType;
  icon: string;
  count: number;
}
