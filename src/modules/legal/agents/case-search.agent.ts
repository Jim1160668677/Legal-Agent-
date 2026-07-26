/**
 * CaseSearchAgent —— 案例语义召回 Agent（A4-W2，A4 §五 5.1 #3）。
 *
 * capability: case.search
 * 包装：RagService（三路召回 BM25+向量+结构化 + RRF 融合）
 * exposure: L-Read（对外只读）
 * async: false
 * fallback: 无
 *
 * 职责：
 *   1. 接收查询文本，调用 RagService.retrieve 三路召回
 *   2. 限定 collection=case_precedent（案例集合）
 *   3. 返回 top-K 案例列表（title/content/score/lawRefs）
 *   4. 案例分析编排计划中作为并行召回的第一步（A4 §6.2）
 *
 * 设计依据：A4 §五 5.1；A2 §4.2 RagService；07 §1.4 知识层。
 */
import { Injectable, Optional } from '@nestjs/common';
import { BaseAgent } from './base.agent';
import type { AgentCard, AgentContext, AgentInvokeInput, AgentInvokeOutput } from './types';
import type { PiiService } from '../../platform/pii/pii.service';
import type { AuditLogService } from '../../platform/audit/audit-log.service';
import type { AppLoggerService } from '../../platform/logger/logger.service';
import type { RagService } from '../retrieval/rag.service';
import { DISCLAIMER_TEXT } from '../chat/sse-frames';

const CARD: AgentCard = {
  agentId: 'case-search',
  name: '案例检索',
  description: '三路召回（BM25+向量+结构化）+ RRF 融合的案例语义检索',
  version: '1.0.0',
  capabilities: ['case.search'],
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '案例检索文本' },
      topK: { type: 'number', description: '返回结果数（默认 10）', default: 10 },
    },
    required: ['query'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      results: { type: 'array', description: '案例列表' },
      total: { type: 'number' },
      disclaimer: { type: 'string' },
      lawRefs: { type: 'array' },
      traceId: { type: 'string' },
    },
    required: ['disclaimer', 'lawRefs', 'traceId'],
  },
  piiLevel: 'L2',
  exposure: 'L-Read',
  async: false,
  timeout: 10_000, // 检索可能涉及向量计算，给 10s
};

@Injectable()
export class CaseSearchAgent extends BaseAgent {
  readonly card = CARD;

  constructor(
    @Optional() private readonly rag?: RagService,
    @Optional() pii?: PiiService,
    @Optional() audit?: AuditLogService,
    @Optional() logger?: AppLoggerService,
  ) {
    super(pii, audit, logger);
  }

  protected async execute(input: AgentInvokeInput, ctx: AgentContext): Promise<AgentInvokeOutput> {
    const query = String(input.params.query ?? '').trim();
    if (!query) {
      return this.fail(1001, '查询文本不能为空', ctx);
    }

    if (!this.rag) {
      return this.fail(5001, 'RagService 未注入', ctx);
    }

    const topK = Number(input.params.topK ?? 10);
    const results = await this.rag.retrieve({
      text: query,
      collections: ['case_precedent', 'law_article'], // 案例检索同时召回法条作为上下文
      finalTopK: topK,
    });

    // 聚合法条引用
    const lawRefs = this.aggregateLawRefs(results);

    return {
      ok: true,
      data: {
        results: results.map((r) => ({
          id: r.id,
          title: r.title,
          content: r.content.slice(0, 500), // 截断避免超长
          score: r.rrfScore ?? r.pathScore,
          collection: r.collection,
        })),
        total: results.length,
      },
      lawRefs,
      disclaimer: DISCLAIMER_TEXT,
      verified: false,
      usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
    };
  }

  /** 聚合检索结果中的法条引用（去重） */
  private aggregateLawRefs(
    results: { lawRefs?: { ref: string; title?: string; verified?: boolean }[] }[],
  ) {
    const seen = new Set<string>();
    const merged: { ref: string; title?: string; verified?: boolean }[] = [];
    for (const r of results) {
      for (const lr of r.lawRefs ?? []) {
        if (!seen.has(lr.ref)) {
          seen.add(lr.ref);
          merged.push(lr);
        }
      }
    }
    return merged;
  }

  private fail(code: number, message: string, _ctx: AgentContext): AgentInvokeOutput {
    return {
      ok: false,
      data: {},
      lawRefs: [],
      disclaimer: DISCLAIMER_TEXT,
      verified: false,
      usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
      errorCode: code,
      errorMessage: message,
    };
  }
}
