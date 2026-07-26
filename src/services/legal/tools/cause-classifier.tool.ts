/**
 * CauseClassifier —— 案由分类工具（v2.3-W1，14-tool-design.md §九）。
 *
 * 输入：案情描述（自由文本）
 * 输出：Top-3 案由（案由代码 + 名称 + 类别 + 适用程序 + 置信度）+ reasoning
 *
 * 算法（14 §9.4）：
 *   1. PII 脱敏（可选）
 *   2. 关键词匹配阶段：分词 + BM25 打分，召回 Top-3
 *   3. 置信度判定：
 *      - top-1 归一化分数 ≥ 0.7 → 直接返回（仅关键词匹配）
 *      - < 0.7 → 调 LLM 辅助（可选），缺失时仅返回关键词结果 + warnings
 *   4. top-1 最终置信度 < 0.5 → 抛 8006（案由置信度过低）
 *
 * 法条依据：最高人民法院《民事案件案由规定》《刑事案件罪名规定》
 *
 * 简化说明：
 *   - 本实现采用字符级 BM25（复用项目 tokenize/termFrequencies，与 InMemoryBm25Retriever 同源）
 *   - LLM rerank 留 @Optional 注入点，缺失时仅走关键词路径
 *
 * 设计依据：14-tool-design.md §九工具 6。
 */
import { Injectable } from '@nestjs/common';
import {
  CAUSE_CLASSIFICATION,
  type CauseClassificationEntry,
  type CauseCategory,
  type ApplicableProcedure,
} from '../../../data/causeClassification';
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

export interface CauseClassifierInput {
  caseDescription: string;
}

export interface CauseCandidate {
  causeCode: string;
  causeName: string;
  category: CauseCategory;
  applicableProcedure?: ApplicableProcedure;
  confidence: number;
}

export interface CauseClassifierOutput {
  topCandidates: CauseCandidate[];
  reasoning: string;
}

const DISCLAIMER =
  '⚠️ 案由分类仅供参考，具体案由以法院立案为准。如分类置信度较低，建议咨询专业律师确定准确案由。';

/** BM25 参数（与 InMemoryBm25Retriever 一致） */
const K1 = 1.5;
const B = 0.75;

/** 案由文档（用于 BM25 索引） */
interface CauseDoc {
  entry: CauseClassificationEntry;
  tf: Map<string, number>;
  length: number;
}

@Injectable()
export class CauseClassifierTool implements LegalTool<CauseClassifierInput, CauseClassifierOutput> {
  readonly toolId: ToolId = 'cause_classification';
  readonly name = '案由分类';
  readonly description = '案情描述→Top-3 案由推荐（含置信度与适用程序）';
  readonly category = 'general' as const;
  readonly piiLevel = 'L2' as const;
  readonly async = false;
  readonly timeout = 6_000;
  readonly cacheable = false;
  readonly toolVersion = '1.0.0';

  readonly inputSchema: JsonSchema = {
    type: 'object',
    properties: {
      caseDescription: { type: 'string', maxLength: 2000 },
    },
    required: ['caseDescription'],
  };

  readonly outputSchema: JsonSchema = {
    type: 'object',
    properties: {
      topCandidates: { type: 'array', minItems: 1, maxItems: 3 },
      reasoning: { type: 'string' },
    },
    required: ['topCandidates'],
  };

  /** 预构建的 BM25 索引（按 keywords 文档化） */
  private readonly docs: CauseDoc[] = (() => {
    return CAUSE_CLASSIFICATION.map((entry) => {
      const text = `${entry.causeName} ${entry.keywords.join(' ')}`;
      const tokens = tokenize(text);
      return {
        entry,
        tf: termFrequencies(tokens),
        length: tokens.length,
      };
    });
  })();

  /** 倒排索引：token → docId 集合 */
  private readonly invertedIndex: Map<string, Set<number>> = (() => {
    const idx = new Map<string, Set<number>>();
    this.docs.forEach((doc, i) => {
      for (const token of doc.tf.keys()) {
        const set = idx.get(token) ?? new Set<number>();
        set.add(i);
        idx.set(token, set);
      }
    });
    return idx;
  })();

  /** 平均文档长度 */
  private readonly avgDocLength: number = (() => {
    if (this.docs.length === 0) return 0;
    return this.docs.reduce((s, d) => s + d.length, 0) / this.docs.length;
  })();

  async invoke(
    input: CauseClassifierInput,
    ctx: ToolContext,
  ): Promise<ToolResult<CauseClassifierOutput>> {
    const description = ctx.pii
      ? ctx.pii.detectAndMask(input.caseDescription)
      : input.caseDescription;
    const queryTokens = tokenize(description);

    if (queryTokens.length === 0) {
      throw new LegalToolError(
        TOOL_ERROR_CODES.INVALID_INPUT,
        'caseDescription 分词后无有效 token',
        this.toolId,
        'caseDescription',
      );
    }

    // 1. BM25 打分
    const scores = this.bm25Scores(queryTokens);
    const ranked = scores
      .map((score, i) => ({ i, score }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (ranked.length === 0) {
      // 无匹配 → 抛 8006（置信度过低）
      throw new LegalToolError(
        TOOL_ERROR_CODES.LOW_CONFIDENCE,
        '案由分类无匹配候选，建议转人工咨询或补充案情描述',
        this.toolId,
      );
    }

    // 2. 归一化置信度（top-1 / max possible score 近似）
    const maxScore = ranked[0].score;
    const candidates: CauseCandidate[] = ranked.map((r, idx) => {
      const entry = this.docs[r.i].entry;
      // 归一化：score / (score + 1) 平滑到 [0, 1)
      const confidence =
        idx === 0 ? Math.min(0.95, maxScore / (maxScore + 1) + 0.2) : (r.score / maxScore) * 0.7;
      return {
        causeCode: entry.causeCode,
        causeName: entry.causeName,
        category: entry.category,
        applicableProcedure: entry.applicableProcedure,
        confidence: Math.round(confidence * 100) / 100,
      };
    });

    // 3. top-1 置信度 < 0.5 → 抛 8006
    if (candidates[0].confidence < 0.5) {
      throw new LegalToolError(
        TOOL_ERROR_CODES.LOW_CONFIDENCE,
        `案由置信度过低（top-1=${candidates[0].confidence}），建议补充案情或转人工咨询`,
        this.toolId,
      );
    }

    // 4. LLM 辅助（可选）：top-1 < 0.7 时调用 LLM rerank
    const warnings: string[] = [];
    let finalCandidates = candidates;
    let reasoning = `基于关键词匹配，Top-1 案由「${candidates[0].causeName}」置信度 ${candidates[0].confidence}（BM25 分数 ${maxScore.toFixed(2)}）`;

    if (candidates[0].confidence < 0.7 && ctx.llmService) {
      try {
        const llmResult = await this.assistWithLlm(ctx.llmService, description, candidates);
        finalCandidates = llmResult.candidates;
        reasoning = llmResult.reasoning;
      } catch (err) {
        ctx.logger?.warn('LLM rerank 失败，降级为仅关键词匹配', {
          error: err instanceof Error ? err.message : String(err),
          traceId: ctx.traceId,
        });
        warnings.push('LLM 辅助不可用，仅基于关键词匹配');
      }
    } else if (candidates[0].confidence < 0.7) {
      warnings.push('LLM 辅助不可用，仅基于关键词匹配');
    }

    ctx.logger?.debug('CauseClassifier 分类', {
      topCause: finalCandidates[0].causeName,
      confidence: finalCandidates[0].confidence,
      candidateCount: finalCandidates.length,
      traceId: ctx.traceId,
    });

    return {
      success: true,
      data: {
        topCandidates: finalCandidates,
        reasoning,
      },
      lawRefs: this.collectLawRefs(finalCandidates),
      warnings: warnings.length > 0 ? warnings : undefined,
      degraded: warnings.length > 0,
      disclaimer: DISCLAIMER,
    };
  }

  /** BM25 打分（返回每个文档的分数） */
  private bm25Scores(queryTokens: string[]): number[] {
    const N = this.docs.length;
    const avgdl = this.avgDocLength || 1;
    const scores = new Array(N).fill(0);

    for (const token of new Set(queryTokens)) {
      const docIds = this.invertedIndex.get(token);
      if (!docIds) continue;
      const df = docIds.size;
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

      for (const i of docIds) {
        const doc = this.docs[i];
        const tf = doc.tf.get(token) ?? 0;
        if (tf === 0) continue;
        const denom = tf + K1 * (1 - B + B * (doc.length / avgdl));
        scores[i] += (idf * (tf * (K1 + 1))) / denom;
      }
    }

    return scores;
  }

  /** LLM rerank 辅助 */
  private async assistWithLlm(
    llm: { complete: (prompt: string) => Promise<string> },
    description: string,
    candidates: CauseCandidate[],
  ): Promise<{ candidates: CauseCandidate[]; reasoning: string }> {
    const candidateList = candidates
      .map((c, i) => `${i + 1}. ${c.causeCode} ${c.causeName}（${c.category}）`)
      .join('\n');
    const prompt = `案情描述：${description}\n\n候选案由：\n${candidateList}\n\n请从候选中选择最匹配的案由，返回 JSON 格式：{"topCauseCode":"...","reasoning":"..."}。仅返回 JSON，不要其他文字。`;
    const resp = await llm.complete(prompt);
    try {
      const m = resp.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('LLM 返回非 JSON');
      const parsed = JSON.parse(m[0]) as { topCauseCode?: string; reasoning?: string };
      const top = candidates.find((c) => c.causeCode === parsed.topCauseCode);
      if (top) {
        // 把 top 提到第一位
        const others = candidates.filter((c) => c.causeCode !== top.causeCode);
        const finalCandidates = [top, ...others].slice(0, 3);
        // top 置信度提升到 0.75
        finalCandidates[0] = { ...top, confidence: 0.75 };
        return {
          candidates: finalCandidates,
          reasoning: parsed.reasoning || `LLM 辅助判定，Top-1 案由「${top.causeName}」`,
        };
      }
    } catch {
      // 解析失败 → 回退
    }
    return { candidates, reasoning: 'LLM rerank 解析失败，保留关键词匹配结果' };
  }

  /** 收集 top-3 案由关联法条 */
  private collectLawRefs(
    candidates: CauseCandidate[],
  ): Array<{ ref: string; title: string; verified: boolean }> {
    const refs: Array<{ ref: string; title: string; verified: boolean }> = [];
    for (const c of candidates) {
      const entry = CAUSE_CLASSIFICATION.find((e) => e.causeCode === c.causeCode);
      if (entry) {
        for (const r of entry.lawRefs) {
          if (!refs.some((x) => x.ref === r.ref)) {
            refs.push({ ...r, verified: true });
          }
        }
      }
    }
    return refs;
  }
}
