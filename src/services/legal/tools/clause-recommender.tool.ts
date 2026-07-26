/**
 * ClauseRecommender —— 条款推荐工具（v2.3-W1，14-tool-design.md §十一）。
 *
 * 输入：文书类型 + 已填变量（可选）+ 分类筛选（可选）
 * 输出：推荐适用条款 Top-5（含 matchScore + applicable + reason）
 *
 * 算法（14 §11.4）：
 *   1. 按 docType 过滤 clause_library
 *   2. 若 category 提供，追加过滤
 *   3. BM25 召回阶段：filledVars 转为查询文本，对条款 content 打分，召回 Top-5
 *   4. LLM rerank 阶段（可选）：缺失时降级为仅 BM25
 *   5. applicable 判定：根据条款 applicableConditions 与 filledVars 兼容性
 *   6. 无匹配抛 8009
 *
 * 法条依据：本工具不直接引用法条（条款库由法务团队编写）
 *
 * 设计依据：14-tool-design.md §十一工具 8。
 */
import { Injectable } from '@nestjs/common';
import { filterByDocType, type ClauseEntry } from '../../../data/clauseLibrary';
import { tokenize, termFrequencies } from '../../../modules/legal/retrieval/bm25.tokenizer';
import {
  LegalToolError,
  TOOL_ERROR_CODES,
  type JsonSchema,
  type LegalTool,
  type ToolContext,
  type ToolId,
  type ToolResult,
} from './types';

export interface ClauseRecommenderInput {
  docType: string;
  filledVars?: Record<string, unknown>;
  category?: string;
}

export interface RecommendedClause {
  clauseId: string;
  title: string;
  content: string;
  matchScore: number;
  applicable: boolean;
  reason?: string;
}

export interface ClauseRecommenderOutput {
  recommendedClauses: RecommendedClause[];
}

const DISCLAIMER =
  '⚠️ 推荐条款仅供参考，请在专业律师审核后使用。条款适用性因具体案情而异，本工具推荐不构成法律意见。';

/** BM25 参数 */
const K1 = 1.5;
const B = 0.75;

/** 条款文档（用于 BM25 索引） */
interface ClauseDoc {
  entry: ClauseEntry;
  tf: Map<string, number>;
  length: number;
}

@Injectable()
export class ClauseRecommenderTool implements LegalTool<
  ClauseRecommenderInput,
  ClauseRecommenderOutput
> {
  readonly toolId: ToolId = 'clause_recommender';
  readonly name = '条款推荐';
  readonly description = '文书类型+已填变量→推荐适用条款 top 5（BM25 召回 + LLM rerank）';
  readonly category = 'general' as const;
  readonly piiLevel = 'L1' as const;
  readonly async = false;
  readonly timeout = 5_000;
  readonly cacheable = true;
  readonly cacheTtl = 24 * 3_600;
  readonly toolVersion = '1.0.0';

  readonly inputSchema: JsonSchema = {
    type: 'object',
    properties: {
      docType: { type: 'string' },
      filledVars: { type: 'object' },
      category: { type: 'string' },
    },
    required: ['docType'],
  };

  readonly outputSchema: JsonSchema = {
    type: 'object',
    properties: {
      recommendedClauses: { type: 'array', maxItems: 5 },
    },
    required: ['recommendedClauses'],
  };

  async invoke(
    input: ClauseRecommenderInput,
    ctx: ToolContext,
  ): Promise<ToolResult<ClauseRecommenderOutput>> {
    // 1. 按 docType 过滤
    let candidates = filterByDocType(input.docType);
    if (candidates.length === 0) {
      // 无匹配 → 抛 8009
      throw new LegalToolError(
        TOOL_ERROR_CODES.NO_CLAUSE_MATCH,
        `文书类型「${input.docType}」无对应条款`,
        this.toolId,
        'docType',
      );
    }

    // 2. category 过滤
    if (input.category) {
      const filtered = candidates.filter((c) => c.category.includes(input.category!));
      if (filtered.length > 0) candidates = filtered;
    }

    // 3. BM25 召回
    const filledVars = input.filledVars ?? {};
    const queryText = this.varsToQuery(filledVars);
    const ranked = this.bm25Rank(candidates, queryText);

    // 4. 取 Top-5
    const top5 = ranked.slice(0, 5);

    // 5. LLM rerank（可选）
    const warnings: string[] = [];
    let finalRanked = top5;
    if (ctx.llmService && queryText.length > 0) {
      try {
        finalRanked = await this.llmRerank(ctx.llmService, input.docType, filledVars, top5);
      } catch (err) {
        ctx.logger?.warn('LLM rerank 失败，降级为仅 BM25', {
          error: err instanceof Error ? err.message : String(err),
          traceId: ctx.traceId,
        });
        warnings.push('LLM rerank 不可用，仅基于关键词匹配');
      }
    } else if (queryText.length === 0) {
      // 无 filledVars，按默认顺序取 Top-5
      warnings.push('未提供 filledVars，按条款默认顺序推荐');
    }

    // 6. 组装输出 + applicable 判定
    const recommendedClauses: RecommendedClause[] = finalRanked.map((r, idx) => {
      const entry = r.entry;
      const applicable = this.checkApplicable(entry, filledVars);
      const matchScore = Math.round(r.score * 100) / 100;
      return {
        clauseId: entry.clauseId,
        title: entry.title,
        content: entry.content,
        matchScore: idx === 0 ? Math.max(0.8, matchScore) : matchScore,
        applicable,
        reason: this.buildReason(entry, filledVars, applicable),
      };
    });

    ctx.logger?.debug('ClauseRecommender 推荐', {
      docType: input.docType,
      filledVarsKeys: Object.keys(filledVars),
      candidateCount: candidates.length,
      recommendedCount: recommendedClauses.length,
      traceId: ctx.traceId,
    });

    return {
      success: true,
      data: { recommendedClauses },
      warnings: warnings.length > 0 ? warnings : undefined,
      degraded: warnings.length > 0,
      disclaimer: DISCLAIMER,
    };
  }

  /** filledVars → 查询文本 */
  private varsToQuery(vars: Record<string, unknown>): string {
    return Object.entries(vars)
      .map(([k, v]) => `${k} ${String(v)}`)
      .join(' ');
  }

  /** BM25 排序 */
  private bm25Rank(
    candidates: ClauseEntry[],
    query: string,
  ): Array<{ entry: ClauseEntry; score: number }> {
    if (!query.trim()) {
      // 无查询文本，按默认顺序返回
      return candidates.map((entry) => ({ entry, score: 0.5 }));
    }

    // 构建本次候选集的 BM25 索引
    const docs: ClauseDoc[] = candidates.map((entry) => {
      const text = `${entry.title} ${entry.content} ${entry.category}`;
      const tokens = tokenize(text);
      return { entry, tf: termFrequencies(tokens), length: tokens.length };
    });

    const N = docs.length;
    const avgdl = docs.reduce((s, d) => s + d.length, 0) / (N || 1);

    // 倒排索引
    const inverted = new Map<string, Set<number>>();
    docs.forEach((d, i) => {
      for (const t of d.tf.keys()) {
        const s = inverted.get(t) ?? new Set<number>();
        s.add(i);
        inverted.set(t, s);
      }
    });

    const queryTokens = tokenize(query);
    const scores = new Array(N).fill(0);

    for (const token of new Set(queryTokens)) {
      const docIds = inverted.get(token);
      if (!docIds) continue;
      const df = docIds.size;
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      for (const i of docIds) {
        const tf = docs[i].tf.get(token) ?? 0;
        if (tf === 0) continue;
        const denom = tf + K1 * (1 - B + B * (docs[i].length / (avgdl || 1)));
        scores[i] += (idf * (tf * (K1 + 1))) / denom;
      }
    }

    return docs
      .map((d, i) => ({ entry: d.entry, score: scores[i] }))
      .sort((a, b) => b.score - a.score);
  }

  /** LLM rerank */
  private async llmRerank(
    llm: { complete: (prompt: string) => Promise<string> },
    docType: string,
    filledVars: Record<string, unknown>,
    top5: Array<{ entry: ClauseEntry; score: number }>,
  ): Promise<Array<{ entry: ClauseEntry; score: number }>> {
    const clauseList = top5
      .map((c, i) => `${i + 1}. ${c.entry.clauseId} ${c.entry.title}`)
      .join('\n');
    const prompt = `文书类型：${docType}\n已填变量：${JSON.stringify(filledVars)}\n\n候选条款：\n${clauseList}\n\n请按匹配度从高到低排序，返回 JSON 数组：[{"clauseId":"...","matchScore":0.9}]。仅返回 JSON。`;
    const resp = await llm.complete(prompt);
    try {
      const m = resp.match(/\[[\s\S]*\]/);
      if (!m) throw new Error('LLM 返回非 JSON 数组');
      const parsed = JSON.parse(m[0]) as Array<{ clauseId?: string; matchScore?: number }>;
      // 按 LLM 排序重排 top5
      const ranked: Array<{ entry: ClauseEntry; score: number }> = [];
      for (const item of parsed) {
        const found = top5.find((t) => t.entry.clauseId === item.clauseId);
        if (found) {
          ranked.push({ entry: found.entry, score: item.matchScore ?? found.score });
        }
      }
      // 补全未在 LLM 结果中的条款
      for (const t of top5) {
        if (!ranked.some((r) => r.entry.clauseId === t.entry.clauseId)) {
          ranked.push(t);
        }
      }
      return ranked.slice(0, 5);
    } catch {
      return top5;
    }
  }

  /** applicable 判定：filledVars 是否满足条款 applicableConditions */
  private checkApplicable(entry: ClauseEntry, filledVars: Record<string, unknown>): boolean {
    if (!entry.applicableConditions) return true;
    for (const [field, type] of Object.entries(entry.applicableConditions)) {
      const v = filledVars[field];
      if (v === undefined || v === null) return false;
      if (type === 'number' && typeof v !== 'number') return false;
      if (type === 'string' && typeof v !== 'string') return false;
    }
    return true;
  }

  /** 构建推荐理由 */
  private buildReason(
    entry: ClauseEntry,
    filledVars: Record<string, unknown>,
    applicable: boolean,
  ): string {
    const filledKeys = Object.keys(filledVars);
    if (applicable) {
      return `条款变量与已填字段（${filledKeys.join(', ') || '无'}）兼容，推荐采纳`;
    }
    return `条款变量部分缺失，请补充 ${Object.keys(entry.applicableConditions ?? {}).join(', ')} 后使用`;
  }
}
