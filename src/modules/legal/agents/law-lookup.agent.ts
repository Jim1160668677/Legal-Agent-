/**
 * LawLookupAgent —— 法条精确查询 Agent（A4-W2，A4 §五 5.1 #1）。
 *
 * capability: law.lookup
 * 包装：RuleEngineService（内存 Map O(1) 精确匹配，< 100ms）
 * exposure: L-Read（对外只读）
 * async: false
 * fallback: legal-qa（未命中时降级到法律问答）
 *
 * 职责：
 *   1. 从输入提取法条引用（"民法典第一百四十三条"）或关键词
 *   2. RuleEngine 精确匹配 / 关键词召回 / FAQ 快答
 *   3. 命中即返（串行短路，A4 §6.2 legal_qa 编排计划）
 *   4. 未命中返回 ok=false（由编排器降级到 legal-qa）
 *
 * 设计依据：A4 §五 5.1；07 §1.4 规则层；06 §八 RuleEngine。
 */
import { Injectable, Optional } from '@nestjs/common';
import { BaseAgent } from './base.agent';
import type { AgentCard, AgentContext, AgentInvokeInput, AgentInvokeOutput } from './types';
import { PiiService } from '../../platform/pii/pii.service';
import { AuditLogService } from '../../platform/audit/audit-log.service';
import { AppLoggerService } from '../../platform/logger/logger.service';
import { RuleEngineService } from '../rule/rule-engine.service';
import { DISCLAIMER_TEXT } from '../chat/sse-frames';

/** AgentCard：法条查询 */
const CARD: AgentCard = {
  agentId: 'law-lookup',
  name: '法条查询',
  description: '法条精确匹配 + 关键词召回 + FAQ 快答（内存 Map，< 100ms）',
  version: '1.0.0',
  capabilities: ['law.lookup'],
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '查询文本（含法条引用或关键词）' },
    },
    required: ['query'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      answer: { type: 'string' },
      source: { type: 'string', enum: ['law_article', 'faq'] },
      matchedKey: { type: 'string' },
      disclaimer: { type: 'string' },
      lawRefs: { type: 'array' },
      traceId: { type: 'string' },
    },
    required: ['disclaimer', 'lawRefs', 'traceId'],
  },
  piiLevel: 'L1',
  exposure: 'L-Read',
  async: false,
  timeout: 5_000,
  fallbackAgentId: 'legal-qa',
};

@Injectable()
export class LawLookupAgent extends BaseAgent {
  readonly card = CARD;

  constructor(
    @Optional() private readonly ruleEngine?: RuleEngineService,
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

    // RuleEngine 未注入：降级返回未命中
    if (!this.ruleEngine) {
      return this.fail(5001, 'RuleEngine 未注入', ctx);
    }

    const result = await this.ruleEngine.query(query);
    if (!result) {
      // 未命中：返回 ok=false，由编排器降级到 legal-qa
      return {
        ok: false,
        data: {},
        lawRefs: [],
        disclaimer: DISCLAIMER_TEXT,
        verified: false,
        usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
        errorCode: 7003,
        errorMessage: '法条未命中，建议降级到 legal-qa',
      };
    }

    return {
      ok: true,
      data: {
        answer: result.answer,
        source: result.source,
        matchedKey: result.matchedKey,
      },
      lawRefs: result.lawRefs,
      disclaimer: DISCLAIMER_TEXT,
      verified: true, // RuleEngine 命中即为已核实（内存法条数据）
      usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
    };
  }

  /** 构造失败输出 */
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
