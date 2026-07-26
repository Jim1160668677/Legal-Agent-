/**
 * 4 桩 Agent（A4-W4，A4 §5.2 v2.3 Agent）。
 *
 * A4 阶段仅注册 AgentCard + 返回 NOT_IMPLEMENTED（7005），
 * 完整逻辑后续 v2.3 阶段实现：
 *   - tool         → v2.3 阶段七（8 项工具：期间计算/赔偿/量刑/案由/法条效力…）
 *   - nlu          → v2.3 阶段八（nlu.extract / nlu.clarify）
 *   - reasoning    → v2.3 阶段九（case.reason / case.compare / law.apply_check，IRAC 推理）
 *   - lawyer-review → v2.3 阶段十（review.lawyer / review.score / review.compliance，L-Internal）
 *
 * 验收 #13：4 桩 Agent 返回 NotImplemented 但 card 注册正确。
 *
 * 设计依据：A4 §5.2；A4 §十 验收 #13；A4 §十一 风险「桩 Agent 误调用」。
 */
import { Injectable, Optional } from '@nestjs/common';
import { BaseAgent } from './base.agent';
import type { AgentCard, AgentContext, AgentInvokeInput, AgentInvokeOutput } from './types';
import { AGENT_ERROR_CODES } from './types';
import type { PiiService } from '../../platform/pii/pii.service';
import type { AuditLogService } from '../../platform/audit/audit-log.service';
import type { AppLoggerService } from '../../platform/logger/logger.service';
import { DISCLAIMER_TEXT } from '../chat/sse-frames';

/**
 * 桩 Agent 基类：所有 capability 调用统一返回 NOT_IMPLEMENTED（7005）。
 *
 * 子类只需声明 readonly card，无需实现 execute（继承本类的 execute）。
 * 完整实现阶段（v2.3）覆写 execute 即可。
 */
abstract class StubAgentBase extends BaseAgent {
  protected async execute(_input: AgentInvokeInput, ctx: AgentContext): Promise<AgentInvokeOutput> {
    this.logger?.warn('Stub agent 被调用，返回 NOT_IMPLEMENTED', {
      agentId: this.card.agentId,
      capability: _input.capability,
      traceId: ctx.traceId,
    });
    return {
      ok: false,
      data: {},
      lawRefs: [],
      disclaimer: DISCLAIMER_TEXT,
      verified: false,
      usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
      errorCode: AGENT_ERROR_CODES.NOT_IMPLEMENTED,
      errorMessage: `Agent ${this.card.agentId} 未实现（v2.3 阶段完成）`,
    };
  }
}

// ===== ToolAgent（v2.3 阶段七：8 项工具）=====

const TOOL_CARD: AgentCard = {
  agentId: 'tool',
  name: '法律工具',
  description: '法律工具调用（期间计算/赔偿计算/量刑/案由/法条效力等 8 项，v2.3 阶段七实现）',
  version: '0.1.0',
  capabilities: [
    'tool.period_calculator',
    'tool.compensation_calculator',
    'tool.sentencing',
    'tool.case_cause',
    'tool.law_effectiveness',
    'tool.law_search',
    'tool.case_search',
    'tool.fee_calculator',
  ],
  inputSchema: {
    type: 'object',
    properties: {
      toolId: { type: 'string', description: '工具 ID' },
      args: { type: 'object', description: '工具入参' },
    },
    required: ['toolId'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      result: { type: 'object', description: '工具计算结果' },
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
export class ToolAgent extends StubAgentBase {
  readonly card = TOOL_CARD;

  constructor(
    @Optional() pii?: PiiService,
    @Optional() audit?: AuditLogService,
    @Optional() logger?: AppLoggerService,
  ) {
    super(pii, audit, logger);
  }
}

// ===== NluAgent（v2.3 阶段八：nlu.extract / nlu.clarify）=====

const NLU_CARD: AgentCard = {
  agentId: 'nlu',
  name: '自然语言理解',
  description: '法律文本实体抽取 + 模糊意图澄清（v2.3 阶段八实现）',
  version: '0.1.0',
  capabilities: ['nlu.extract', 'nlu.clarify'],
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '待解析文本' },
      slots: { type: 'array', description: '待抽取的槽位列表' },
    },
    required: ['text'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      entities: { type: 'array', description: '抽取的实体列表' },
      clarification: { type: 'string', description: '澄清问题（nlu.clarify）' },
      disclaimer: { type: 'string' },
      lawRefs: { type: 'array' },
      traceId: { type: 'string' },
    },
    required: ['disclaimer', 'lawRefs', 'traceId'],
  },
  piiLevel: 'L3',
  exposure: 'L-Internal',
  async: false,
  timeout: 5_000,
};

@Injectable()
export class NluAgent extends StubAgentBase {
  readonly card = NLU_CARD;

  constructor(
    @Optional() pii?: PiiService,
    @Optional() audit?: AuditLogService,
    @Optional() logger?: AppLoggerService,
  ) {
    super(pii, audit, logger);
  }
}

// ===== ReasoningAgent（v2.3 阶段九：IRAC 推理）=====

const REASONING_CARD: AgentCard = {
  agentId: 'reasoning',
  name: '案件推理',
  description: 'IRAC 法律推理 + 相似案例对比 + 法条适用校验（v2.3 阶段九实现）',
  version: '0.1.0',
  capabilities: ['case.reason', 'case.compare', 'law.apply_check'],
  inputSchema: {
    type: 'object',
    properties: {
      caseDescription: { type: 'string' },
      retrievedContext: { type: 'string' },
      issue: { type: 'string', description: '争议焦点（IRAC-Issue）' },
    },
    required: ['caseDescription'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      issue: { type: 'string' },
      rule: { type: 'string' },
      application: { type: 'string' },
      conclusion: { type: 'string' },
      disclaimer: { type: 'string' },
      lawRefs: { type: 'array' },
      traceId: { type: 'string' },
    },
    required: ['disclaimer', 'lawRefs', 'traceId'],
  },
  piiLevel: 'L3',
  exposure: 'L-Write-Limited',
  async: true,
  timeout: 30_000,
};

@Injectable()
export class ReasoningAgent extends StubAgentBase {
  readonly card = REASONING_CARD;

  constructor(
    @Optional() pii?: PiiService,
    @Optional() audit?: AuditLogService,
    @Optional() logger?: AppLoggerService,
  ) {
    super(pii, audit, logger);
  }
}

// ===== LawyerReviewAgent（v2.3 阶段十：律师复核，L-Internal）=====

const LAWYER_REVIEW_CARD: AgentCard = {
  agentId: 'lawyer-review',
  name: '律师复核',
  description: '律师人工复核 + 合规评分（v2.3 阶段十实现，L-Internal 不对外）',
  version: '0.1.0',
  capabilities: ['review.lawyer', 'review.score', 'review.compliance'],
  inputSchema: {
    type: 'object',
    properties: {
      document: { type: 'string', description: '待复核文书' },
      analysis: { type: 'string', description: '待复核分析结论' },
      criteria: { type: 'array', description: '评分维度' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      score: { type: 'number' },
      comments: { type: 'array' },
      complianceIssues: { type: 'array' },
      disclaimer: { type: 'string' },
      lawRefs: { type: 'array' },
      traceId: { type: 'string' },
    },
    required: ['disclaimer', 'lawRefs', 'traceId'],
  },
  piiLevel: 'L4',
  exposure: 'L-Internal',
  async: true,
  timeout: 60_000,
};

@Injectable()
export class LawyerReviewAgent extends StubAgentBase {
  readonly card = LAWYER_REVIEW_CARD;

  constructor(
    @Optional() pii?: PiiService,
    @Optional() audit?: AuditLogService,
    @Optional() logger?: AppLoggerService,
  ) {
    super(pii, audit, logger);
  }
}
