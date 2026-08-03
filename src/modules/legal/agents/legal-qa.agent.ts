/**
 * LegalQaAgent —— 法律问答 Agent（A4-W2，A4 §五 5.1 #2）。
 *
 * capability: legal.qa
 * 包装：RuleEngineService（法条精确匹配）+ KnowledgeBaseService（术语/FAQ 关键词查询）
 * exposure: L-Read（对外只读）
 * async: false
 * fallback: 无（作为 law-lookup 的降级目标）
 *
 * 职责：
 *   1. 先走 RuleEngine 精确匹配（法条/FAQ 快答）
 *   2. 未命中走 KnowledgeBase 关键词查询（术语/FAQ/模板）
 *   3. 仍未命中返回 ok=false（由编排器降级到 LLM 或人工引导）
 *
 * 设计依据：A4 §五 5.1；07 §1.4 知识层；A2 §三 KnowledgeBase。
 */
import { Injectable, Optional } from '@nestjs/common';
import { BaseAgent } from './base.agent';
import type { AgentCard, AgentContext, AgentInvokeInput, AgentInvokeOutput } from './types';
import { PiiService } from '../../platform/pii/pii.service';
import { AuditLogService } from '../../platform/audit/audit-log.service';
import { AppLoggerService } from '../../platform/logger/logger.service';
import { RuleEngineService } from '../rule/rule-engine.service';
import { KnowledgeBaseService } from '../knowledge/knowledge-base.service';
import { DISCLAIMER_TEXT } from '../chat/sse-frames';

const CARD: AgentCard = {
  agentId: 'legal-qa',
  name: '法律问答',
  description: '法条 + FAQ + 术语知识库问答（RuleEngine 精确 + KnowledgeBase 关键词）',
  version: '1.0.0',
  capabilities: ['legal.qa'],
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '法律问题文本' },
    },
    required: ['query'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      answer: { type: 'string' },
      source: { type: 'string', enum: ['law_article', 'faq', 'knowledge', 'none'] },
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
export class LegalQaAgent extends BaseAgent {
  readonly card = CARD;

  constructor(
    @Optional() private readonly ruleEngine?: RuleEngineService,
    @Optional() private readonly knowledgeBase?: KnowledgeBaseService,
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

    // 1. RuleEngine 精确匹配
    if (this.ruleEngine) {
      const ruleResult = await this.ruleEngine.query(query);
      if (ruleResult) {
        return {
          ok: true,
          data: {
            answer: ruleResult.answer,
            source: ruleResult.source,
          },
          lawRefs: ruleResult.lawRefs,
          disclaimer: DISCLAIMER_TEXT,
          verified: true,
          usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
        };
      }
    }

    // 2. KnowledgeBase 关键词查询（术语/FAQ/模板）
    if (this.knowledgeBase) {
      const kbResults = await this.knowledgeBase.queryByKeyword(query, { limit: 3 });
      if (kbResults.length > 0) {
        const top = kbResults[0];
        const answer = this.formatKnowledgeAnswer(kbResults);
        return {
          ok: true,
          data: {
            answer,
            source: 'knowledge',
            matchedTitle: top.title,
            score: top.score,
          },
          lawRefs: top.lawRefs,
          disclaimer: DISCLAIMER_TEXT,
          verified: false, // KnowledgeBase 法条引用未核实（待 LLM/RagService 校验）
          usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
        };
      }
    }

    // 3. 未命中：返回 ok=false（编排器降级到 LLM）
    return {
      ok: false,
      data: { source: 'none' },
      lawRefs: [],
      disclaimer: DISCLAIMER_TEXT,
      verified: false,
      usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
      errorCode: 7003,
      errorMessage: '知识库未命中，建议降级到 LLM',
    };
  }

  /** 格式化 KnowledgeBase 多条结果为答案文本 */
  private formatKnowledgeAnswer(results: { title: string; content: string }[]): string {
    return results.map((r) => `【${r.title}】\n${r.content}`).join('\n\n');
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
