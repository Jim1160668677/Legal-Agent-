/**
 * KnowledgeBaseService —— 结构化知识查询（A2-W1，A2 §三）。
 *
 * 职责：
 *   1. queryByType(type, category, subCategory?)：按类型+分类查询流程/材料清单（走索引，< 50ms）
 *   2. queryByKeyword(keyword, opts?)：关键词查询（title/tags/content 命中，评分排序）
 *   3. getById(id)：精确查询单条（RuleEngine 补充用）
 *
 * 数据来源：legal_knowledge 集合（type/category/subCategory/title/content/structured/lawRefs/tags）。
 * 无 LLM 调用，纯 MongoDB 查询，失败降级返回空（不阻塞主流程，对齐 MemoryManager 降级模式）。
 *
 * 设计依据：A2 §三 KnowledgeBase；05 legal_knowledge schema。
 */
import { Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  LegalKnowledge,
  type LegalKnowledgeDocument,
} from '../../../infra/database/schemas/legal.schema';
import type { AppLoggerService } from '../../platform/logger/logger.service';
import type { KnowledgeResult, LegalKnowledgeLean } from './knowledge.types';
import { toKnowledgeResult, scoreByKeyword } from './knowledge.types';

/** queryByKeyword 默认返回上限 */
const DEFAULT_KEYWORD_LIMIT = 10;

/** 转义正则特殊字符，防止关键词注入 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class KnowledgeBaseService {
  constructor(
    @InjectModel(LegalKnowledge.name)
    private readonly knowledgeModel: Model<LegalKnowledgeDocument>,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  /**
   * 按类型+分类查询结构化知识（流程/材料清单）。
   * 走 idx_type_category 索引，响应 < 50ms。
   */
  async queryByType(
    type: string,
    category: string,
    subCategory?: string,
  ): Promise<KnowledgeResult[]> {
    const filter: Record<string, unknown> = { type, category };
    if (subCategory) filter.subCategory = subCategory;
    try {
      const docs = await this.knowledgeModel.find(filter).lean<LegalKnowledgeLean[]>().exec();
      return docs.map((d) => toKnowledgeResult(d, 1.0));
    } catch (err) {
      this.logger?.warn('queryByType 查询失败，降级返回空', {
        type,
        category,
        subCategory,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * 关键词查询（用于 knowledge 路由命中）。
   * $or 召回 title/tags/content 命中文档，客户端按命中权重评分排序，取 top-N。
   */
  async queryByKeyword(keyword: string, opts?: { limit?: number }): Promise<KnowledgeResult[]> {
    const limit = opts?.limit ?? DEFAULT_KEYWORD_LIMIT;
    const kw = keyword.trim();
    if (!kw) return [];
    try {
      const regex = new RegExp(escapeRegex(kw), 'i');
      const docs = await this.knowledgeModel
        .find({ $or: [{ title: regex }, { tags: kw }, { content: regex }] })
        .lean<LegalKnowledgeLean[]>()
        .exec();
      return docs
        .map((d) => ({ doc: d, score: scoreByKeyword(d, kw) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((x) => toKnowledgeResult(x.doc, x.score));
    } catch (err) {
      this.logger?.warn('queryByKeyword 查询失败，降级返回空', {
        keyword: kw,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * 精确查询单条（用于 RuleEngine 补充 / 前端详情页）。
   */
  async getById(id: string): Promise<KnowledgeResult | null> {
    if (!id) return null;
    try {
      const doc = await this.knowledgeModel.findById(id).lean<LegalKnowledgeLean | null>().exec();
      return doc ? toKnowledgeResult(doc, 1.0) : null;
    } catch (err) {
      this.logger?.warn('getById 查询失败，降级返回 null', {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
