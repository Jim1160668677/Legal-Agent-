/**
 * KnowledgeBase 共享类型（A2-W1，A2 §三）。
 *
 * KnowledgeBase 负责结构化知识（流程/材料清单/术语/FAQ/模板）查询，
 * 替代 A1 Orchestrator 中 knowledge 路由的占位，响应 < 50ms（走 MongoDB 索引，无 LLM）。
 */
import type { LawRef } from '../../../types/llm';

/** 结构化知识类型（A2 §三 KnowledgeResult.type） */
export type KnowledgeType = 'process' | 'material' | 'term' | 'faq' | 'template';

/** KnowledgeBase 查询结果（A2 §三） */
export interface KnowledgeResult {
  type: KnowledgeType;
  title: string;
  content: string;
  /** 流程步骤/材料清单等结构化数据 */
  structured?: Record<string, unknown>;
  /** 关联法条引用（schema 存 string[]，此处转为 LawRef，默认 verified=false） */
  lawRefs: LawRef[];
  /** 相关度评分（queryByKeyword 时按命中权重计算；queryByType 时为 1.0） */
  score: number;
}

/** LegalKnowledge 集合 lean 投影类型（仅取查询所需字段） */
export interface LegalKnowledgeLean {
  _id: unknown;
  type: string;
  category: string;
  subCategory?: string;
  title: string;
  content: string;
  structured?: Record<string, unknown>;
  lawRefs?: string[];
  tags?: string[];
}

/**
 * 对外法律知识 DTO（KnowledgeController 返回）。
 * 相比 KnowledgeResult，增加 id（由 _id 映射），供前端详情页定位。
 */
export interface KnowledgeArticleDto {
  id: string;
  type: KnowledgeType;
  category: string;
  subCategory?: string;
  title: string;
  content: string;
  structured?: Record<string, unknown>;
  lawRefs: { ref: string; verified: boolean }[];
  tags?: string[];
}

/** 知识列表分页结果 */
export interface KnowledgeListResult {
  items: KnowledgeArticleDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** 知识分类信息（listCategories 聚合结果） */
export interface KnowledgeCategoryInfo {
  category: string;
  types: KnowledgeType[];
  count: number;
}

/** 将 LegalKnowledgeLean 映射为带 id 的对外 DTO */
export function toKnowledgeArticleDto(doc: LegalKnowledgeLean): KnowledgeArticleDto {
  return {
    id: String(doc._id),
    type: normalizeKnowledgeType(doc.type),
    category: doc.category,
    subCategory: doc.subCategory,
    title: doc.title,
    content: doc.content,
    structured: doc.structured,
    lawRefs: (doc.lawRefs ?? []).map((ref) => ({ ref, verified: false })),
    tags: doc.tags,
  };
}

/** queryByKeyword 命中权重：标题 > tags > content */
const SCORE_TITLE_HIT = 1.0;
const SCORE_TAG_HIT = 0.6;
const SCORE_CONTENT_HIT = 0.3;

/**
 * 将 LegalKnowledgeLean 转换为 KnowledgeResult。
 * lawRefs 由 string[] 转为 LawRef[]（verified=false，待 RagService/LLM 校验）。
 */
export function toKnowledgeResult(doc: LegalKnowledgeLean, score: number): KnowledgeResult {
  return {
    type: normalizeKnowledgeType(doc.type),
    title: doc.title,
    content: doc.content,
    structured: doc.structured,
    lawRefs: (doc.lawRefs ?? []).map((ref) => ({ ref, verified: false })),
    score,
  };
}

/** 将 schema 中的自由 string 归一化为 KnowledgeType，未知值降级为 faq */
export function normalizeKnowledgeType(raw: string): KnowledgeType {
  const allowed: KnowledgeType[] = ['process', 'material', 'term', 'faq', 'template'];
  return (allowed as string[]).includes(raw) ? (raw as KnowledgeType) : 'faq';
}

/**
 * 计算关键词命中评分（queryByKeyword 用）。
 * 命中标题满分；命中 tags 中权；命中 content 低权；取最高命中分。
 */
export function scoreByKeyword(doc: LegalKnowledgeLean, keyword: string): number {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return 0;
  const title = doc.title.toLowerCase();
  if (title.includes(kw)) return SCORE_TITLE_HIT;
  const tags = (doc.tags ?? []).map((t) => t.toLowerCase());
  if (tags.some((t) => t.includes(kw))) return SCORE_TAG_HIT;
  const content = doc.content.toLowerCase();
  if (content.includes(kw)) return SCORE_CONTENT_HIT;
  return 0;
}
