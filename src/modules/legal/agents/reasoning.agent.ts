/**
 * ReasoningAgent —— 法律推理 Agent（v2.3-W5，11 第 11 个 Agent）。
 *
 * 替代 stub.agent.ts 中的 ReasoningAgent 桩，包装 ReasoningModule 四个核心服务：
 *   - capability 'case.reason'：
 *       IracReasonerService.reason() 执行 IRAC 四步推理
 *       输入 caseDescription + question + entities + retrievedContext + ctx
 *       输出 issues + rules + applications + conclusion + reasoningChainId
 *   - capability 'case.compare'：
 *       CaseComparatorService.compare() 案例对比
 *       输入 userFacts + cases（可选，缺失时 RagService 召回）
 *       输出 comparison[] + totalCases
 *   - capability 'law.apply_check'：
 *       LawApplicationDeterminerService.determine() 法条适用判定
 *       输入 rule + factEntities
 *       输出 factMatch + matchedFacts + unmatchedFacts
 *
 * 调用契约：
 *   - case.reason 入参 params: { caseDescription, question?, entities?, retrievedContext?, ctx? }
 *   - case.compare 入参 params: { userFacts: { text, entities?, expectedVerdict? }, cases? }
 *   - law.apply_check 入参 params: { rule: { articleId, articleText, conditions? }, factEntities?, caseDescription? }
 *
 * 横切依赖：BaseAgent 注入 PiiService + AuditLogService + AppLoggerService（@Optional）
 *
 * 设计依据：11 reasoning Agent；A4 §五 5.3；16 §2-§5。
 */
import { Injectable, Optional } from '@nestjs/common';
import { BaseAgent } from './base.agent';
import type { AgentCard, AgentContext, AgentInvokeInput, AgentInvokeOutput } from './types';
import { PiiService } from '../../platform/pii/pii.service';
import { AuditLogService } from '../../platform/audit/audit-log.service';
import { AppLoggerService } from '../../platform/logger/logger.service';
import { DISCLAIMER_TEXT } from '../chat/sse-frames';
import { IracReasonerService } from '../reasoning/irac-reasoner.service';
import { CaseComparatorService } from '../reasoning/case-comparator.service';
import { LawApplicationDeterminerService } from '../reasoning/law-application-determiner.service';
import type { Entity } from '../nlu/nlu.types';
import type { Rule } from '../reasoning/reasoning.types';

const REASONING_CARD: AgentCard = {
  agentId: 'reasoning',
  name: '案件推理',
  description: 'IRAC 法律推理 + 相似案例对比 + 法条适用校验（v2.3-W5 实现）',
  version: '1.0.0',
  capabilities: ['case.reason', 'case.compare', 'law.apply_check'],
  inputSchema: {
    type: 'object',
    properties: {
      caseDescription: { type: 'string', description: '案件描述（case.reason）' },
      question: { type: 'string', description: '分析问题（case.reason，如 能否胜诉/判多重）' },
      entities: { type: 'array', description: '已抽取实体（case.reason，来自 nlu Agent）' },
      retrievedContext: {
        type: 'string',
        description: '编排器并行召回的上下文（case.reason 可选）',
      },
      ctx: {
        type: 'object',
        description: '推理上下文（userId/msgId/traceId/expectedVerdict）',
      },
      userFacts: {
        type: 'object',
        description: '用户案情（case.compare）',
        properties: {
          text: { type: 'string' },
          entities: { type: 'array' },
          expectedVerdict: { type: 'string' },
        },
      },
      cases: {
        type: 'array',
        description: '候选案例（case.compare 可选，缺失时 RagService 召回 top 3）',
      },
      rule: {
        type: 'object',
        description: '法条规则（law.apply_check）',
        properties: {
          articleId: { type: 'string' },
          articleText: { type: 'string' },
          conditions: { type: 'array' },
        },
      },
      factEntities: { type: 'array', description: '用户案情实体（law.apply_check）' },
    },
    required: ['caseDescription'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      issues: { type: 'array', description: '争议点列表（case.reason）' },
      rules: { type: 'array', description: '法条规则列表（case.reason）' },
      applications: { type: 'array', description: '事实映射列表（case.reason）' },
      conclusion: { type: 'object', description: '综合结论（case.reason）' },
      reasoningChainId: { type: 'string', description: '推理链 ID（case.reason）' },
      comparison: { type: 'array', description: '案例对比结果（case.compare）' },
      totalCases: { type: 'number', description: '参与对比的案例总数（case.compare）' },
      factMatch: { type: 'string', description: '法条适用判定（law.apply_check）' },
      matchedFacts: { type: 'array', description: '匹配的事实（law.apply_check）' },
      unmatchedFacts: { type: 'array', description: '未匹配的事实（law.apply_check）' },
      degraded: {
        type: 'string',
        description: '降级标记（none/llm_unavailable/application_skipped）',
      },
      warnings: { type: 'array', description: '警告信息' },
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
export class ReasoningAgent extends BaseAgent {
  readonly card = REASONING_CARD;

  constructor(
    @Optional() private readonly iracReasoner?: IracReasonerService,
    @Optional() private readonly caseComparator?: CaseComparatorService,
    @Optional() private readonly lawApplicationDeterminer?: LawApplicationDeterminerService,
    @Optional() pii?: PiiService,
    @Optional() audit?: AuditLogService,
    @Optional() logger?: AppLoggerService,
  ) {
    super(pii, audit, logger);
  }

  protected async execute(input: AgentInvokeInput, ctx: AgentContext): Promise<AgentInvokeOutput> {
    const capability = input.capability || 'case.reason';
    const params = input.params ?? {};

    try {
      if (capability === 'case.reason') {
        return await this.handleReason(params, ctx);
      }
      if (capability === 'case.compare') {
        return await this.handleCompare(params, ctx);
      }
      if (capability === 'law.apply_check') {
        return await this.handleApplyCheck(params, ctx);
      }
      // 不支持的 capability
      return this.fail(7005, `ReasoningAgent 不支持 capability: ${capability}`, ctx);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger?.error('ReasoningAgent 执行异常', {
        agentId: 'reasoning',
        capability,
        traceId: ctx.traceId,
        error: errorMessage,
      });
      return this.fail(7003, `推理处理异常：${errorMessage}`, ctx);
    }
  }

  // ===== case.reason：IRAC 四步推理 =====

  private async handleReason(
    params: Record<string, unknown>,
    ctx: AgentContext,
  ): Promise<AgentInvokeOutput> {
    const caseDescription =
      typeof params.caseDescription === 'string' ? params.caseDescription : '';
    if (!caseDescription.trim()) {
      return this.fail(7005, 'case.reason 入参 caseDescription 不能为空', ctx);
    }

    if (!this.iracReasoner) {
      return this.fail(7005, 'IracReasonerService 未注入', ctx);
    }

    const question = typeof params.question === 'string' ? params.question : undefined;
    const entities = Array.isArray(params.entities) ? (params.entities as Entity[]) : [];
    const retrievedContext =
      typeof params.retrievedContext === 'string' ? params.retrievedContext : undefined;
    const reasoningCtx = this.resolveReasoningContext(params, ctx);

    const result = await this.iracReasoner.reason({
      caseDescription,
      question,
      entities,
      retrievedContext,
      ctx: reasoningCtx,
    });

    return {
      ok: true,
      data: {
        issues: result.issues,
        rules: result.rules,
        applications: result.applications,
        conclusion: result.conclusion,
        reasoningChainId: result.reasoningChainId,
        degraded: result.degraded,
        warnings: result.warnings,
        modelVersion: result.modelVersion,
        promptVersion: result.promptVersion,
        traceId: ctx.traceId,
      },
      lawRefs: result.conclusion.lawRefs.map((ref) => ({ ref, verified: true })),
      disclaimer: result.conclusion.disclaimer,
      verified: true,
      usage: {
        durationMs: 0,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      },
    };
  }

  // ===== case.compare：案例对比 =====

  private async handleCompare(
    params: Record<string, unknown>,
    ctx: AgentContext,
  ): Promise<AgentInvokeOutput> {
    const userFactsRaw = params.userFacts;
    if (!userFactsRaw || typeof userFactsRaw !== 'object') {
      return this.fail(7005, 'case.compare 入参 userFacts 不能为空', ctx);
    }

    if (!this.caseComparator) {
      return this.fail(7005, 'CaseComparatorService 未注入', ctx);
    }

    const userFacts = this.resolveUserFacts(userFactsRaw as Record<string, unknown>);
    const cases = Array.isArray(params.cases) ? params.cases : undefined;

    const result = await this.caseComparator.compare({
      userFacts,
      cases,
    });

    // 聚合所有案例的 lawRefs（案例 ID）
    const lawRefs = result.comparison.map((c) => ({ ref: c.caseId, verified: true }));

    return {
      ok: true,
      data: {
        comparison: result.comparison,
        totalCases: result.totalCases,
        warnings: result.warnings,
        traceId: ctx.traceId,
      },
      lawRefs,
      disclaimer: DISCLAIMER_TEXT,
      verified: false,
      usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
    };
  }

  // ===== law.apply_check：法条适用判定 =====

  private async handleApplyCheck(
    params: Record<string, unknown>,
    ctx: AgentContext,
  ): Promise<AgentInvokeOutput> {
    const ruleRaw = params.rule;
    if (!ruleRaw || typeof ruleRaw !== 'object') {
      return this.fail(7005, 'law.apply_check 入参 rule 不能为空', ctx);
    }

    if (!this.lawApplicationDeterminer) {
      return this.fail(7005, 'LawApplicationDeterminerService 未注入', ctx);
    }

    const rule = this.resolveRule(ruleRaw as Record<string, unknown>);
    const factEntities = Array.isArray(params.factEntities)
      ? (params.factEntities as Entity[])
      : [];
    const caseDescription =
      typeof params.caseDescription === 'string' ? params.caseDescription : undefined;

    const result = await this.lawApplicationDeterminer.determine({
      rule,
      factEntities,
      caseDescription,
    });

    return {
      ok: true,
      data: {
        factMatch: result.factMatch,
        matchedFacts: result.matchedFacts,
        unmatchedFacts: result.unmatchedFacts,
        degradedCode: result.degradedCode,
        warnings: result.warnings,
        traceId: ctx.traceId,
      },
      lawRefs: [{ ref: rule.articleId, verified: true }],
      disclaimer: DISCLAIMER_TEXT,
      verified: true,
      usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
    };
  }

  // ===== 入参派生 =====

  /** 从 params.ctx 与 AgentContext 派生 ReasoningContext */
  private resolveReasoningContext(params: Record<string, unknown>, ctx: AgentContext) {
    const rawCtx = params.ctx;
    if (rawCtx && typeof rawCtx === 'object') {
      const c = rawCtx as Record<string, unknown>;
      return {
        userId: typeof c.userId === 'string' ? c.userId : ctx.callerUserId,
        msgId: typeof c.msgId === 'string' ? c.msgId : ctx.traceId,
        traceId: typeof c.traceId === 'string' ? c.traceId : ctx.traceId,
        expectedVerdict: typeof c.expectedVerdict === 'string' ? c.expectedVerdict : undefined,
      };
    }
    // 兜底：用 AgentContext 构造
    return {
      userId: ctx.callerUserId,
      msgId: ctx.traceId,
      traceId: ctx.traceId,
    };
  }

  /** 解析 userFacts 入参 */
  private resolveUserFacts(raw: Record<string, unknown>) {
    return {
      text: typeof raw.text === 'string' ? raw.text : '',
      entities: Array.isArray(raw.entities) ? (raw.entities as Entity[]) : undefined,
      expectedVerdict: typeof raw.expectedVerdict === 'string' ? raw.expectedVerdict : undefined,
    };
  }

  /** 解析 rule 入参 */
  private resolveRule(raw: Record<string, unknown>): Rule {
    return {
      articleId: typeof raw.articleId === 'string' ? raw.articleId : '',
      articleText: typeof raw.articleText === 'string' ? raw.articleText : '',
      conditions: Array.isArray(raw.conditions)
        ? (raw.conditions as string[]).filter((c) => typeof c === 'string')
        : [],
      legalConsequences: Array.isArray(raw.legalConsequences)
        ? (raw.legalConsequences as string[]).filter((c) => typeof c === 'string')
        : [],
    };
  }

  // ===== 错误返回辅助 =====

  private fail(code: number, message: string, ctx: AgentContext): AgentInvokeOutput {
    this.logger?.warn('ReasoningAgent 返回错误', {
      agentId: 'reasoning',
      errorCode: code,
      errorMessage: message,
      traceId: ctx.traceId,
    });
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
