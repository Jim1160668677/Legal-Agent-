/**
 * ProcessGuideAgent —— 流程指引 + 材料清单 Agent（A4-W2，A4 §五 5.1 #4）。
 *
 * capabilities: process.guide / material.checklist
 * 包装：KnowledgeBaseService（结构化流程/材料查询，走索引 < 50ms）
 * exposure: L-Read（对外只读）
 * async: false
 * fallback: 无
 *
 * 职责：
 *   1. process.guide：按 category 查询立案/起诉/举证流程步骤
 *   2. material.checklist：按 category 查询材料清单（离婚/立案/上诉）
 *   3. capability 路由：根据 input.capability 决定查 process 还是 material
 *
 * 编排计划（A4 §6.2）：
 *   - process_guide 意图：单 agent 调用
 *   - material_checklist 意图：单 agent 调用
 *   - document_generate 意图：并行召回（law-lookup // process-guide）提供上下文
 *
 * 设计依据：A4 §五 5.1；A2 §三 KnowledgeBase；07 §1.4 知识层。
 */
import { Injectable, Optional } from '@nestjs/common';
import { BaseAgent } from './base.agent';
import type { AgentCard, AgentContext, AgentInvokeInput, AgentInvokeOutput } from './types';
import type { PiiService } from '../../platform/pii/pii.service';
import type { AuditLogService } from '../../platform/audit/audit-log.service';
import type { AppLoggerService } from '../../platform/logger/logger.service';
import type { KnowledgeBaseService } from '../knowledge/knowledge-base.service';
import { DISCLAIMER_TEXT } from '../chat/sse-frames';

const CARD: AgentCard = {
  agentId: 'process-guide',
  name: '流程指引',
  description: '法律流程指引 + 材料清单查询（立案/起诉/举证流程，材料清单）',
  version: '1.0.0',
  capabilities: ['process.guide', 'material.checklist'],
  inputSchema: {
    type: 'object',
    properties: {
      category: { type: 'string', description: '流程分类（如 立案/起诉/离婚）' },
      subCategory: { type: 'string', description: '子分类（如 民事立案/行政立案）' },
      keyword: { type: 'string', description: '关键词（模糊查询）' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      results: { type: 'array', description: '流程步骤/材料清单列表' },
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
  timeout: 5_000,
};

@Injectable()
export class ProcessGuideAgent extends BaseAgent {
  readonly card = CARD;

  constructor(
    @Optional() private readonly knowledgeBase?: KnowledgeBaseService,
    @Optional() pii?: PiiService,
    @Optional() audit?: AuditLogService,
    @Optional() logger?: AppLoggerService,
  ) {
    super(pii, audit, logger);
  }

  protected async execute(input: AgentInvokeInput, ctx: AgentContext): Promise<AgentInvokeOutput> {
    if (!this.knowledgeBase) {
      return this.fail(5001, 'KnowledgeBaseService 未注入', ctx);
    }

    // 按 capability 决定查询类型
    const knowledgeType = input.capability === 'material.checklist' ? 'material' : 'process';
    const category = String(input.params.category ?? '').trim();
    const keyword = String(input.params.keyword ?? '').trim();

    let results;
    if (category) {
      // 按类型+分类精确查询（走索引）
      results = await this.knowledgeBase.queryByType(
        knowledgeType,
        category,
        input.params.subCategory ? String(input.params.subCategory) : undefined,
      );
    } else if (keyword) {
      // 关键词模糊查询
      results = await this.knowledgeBase.queryByKeyword(keyword, { limit: 10 });
      // 过滤为当前类型
      results = results.filter((r) => r.type === knowledgeType);
    } else {
      return this.fail(1001, 'category 或 keyword 至少需要一个', ctx);
    }

    // 聚合法条引用
    const lawRefs = this.aggregateLawRefs(results);

    return {
      ok: true,
      data: {
        results: results.map((r) => ({
          title: r.title,
          content: r.content,
          structured: r.structured,
          score: r.score,
        })),
        total: results.length,
        queryType: knowledgeType,
      },
      lawRefs,
      disclaimer: DISCLAIMER_TEXT,
      verified: false,
      usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
    };
  }

  private aggregateLawRefs(
    results: { lawRefs: { ref: string; title?: string; verified?: boolean }[] }[],
  ) {
    const seen = new Set<string>();
    const merged: { ref: string; title?: string; verified?: boolean }[] = [];
    for (const r of results) {
      for (const lr of r.lawRefs) {
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
