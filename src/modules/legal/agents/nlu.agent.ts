/**
 * NluAgent —— 自然语言理解 Agent（v2.3-W4，07 §八）。
 *
 * 替代 stub.agent.ts 中的 NluAgent 桩，包装 NluModule 三个核心服务：
 *   - capability 'nlu.extract'：
 *       1. EntityExtractorService.extract() 四层实体抽取
 *       2. CompoundIntentSplitterService.split() 复合意图拆分（若文本为复合）
 *       3. 返回 entities + isCompound + subIntents（若有）
 *   - capability 'nlu.clarify'：
 *       1. ClarificationManagerService.startClarify() 启动澄清
 *       2. ClarificationManagerService.answerClarify() 处理用户回复
 *       3. 返回 clarification 卡片 + state + turns + fallbackIntent
 *
 * 调用契约：
 *   - nlu.extract 入参 params: { text: string, intent?: IntentType, ctx?: NluContext }
 *   - nlu.clarify 入参 params:
 *       - 启动模式：{ mode: 'start', intent, entities, ctx }
 *       - 回复模式：{ mode: 'answer', sessionId, reply, ctx }
 *
 * 横切依赖：BaseAgent 注入 PiiService + AuditLogService + AppLoggerService（@Optional）
 *
 * 设计依据：07 §8.1-8.3；A4 §五 5.3。
 */
import { Injectable, Optional } from '@nestjs/common';
import { BaseAgent } from './base.agent';
import type { AgentCard, AgentContext, AgentInvokeInput, AgentInvokeOutput } from './types';
import { PiiService } from '../../platform/pii/pii.service';
import { AuditLogService } from '../../platform/audit/audit-log.service';
import { AppLoggerService } from '../../platform/logger/logger.service';
import { DISCLAIMER_TEXT } from '../chat/sse-frames';
import { EntityExtractorService } from '../nlu/entity-extractor.service';
import { ClarificationManagerService } from '../nlu/clarification-manager.service';
import { CompoundIntentSplitterService } from '../nlu/compound-intent-splitter.service';
import type { NluContext, Entity } from '../nlu/nlu.types';
import type { IntentType } from '../../../types/intent';

const NLU_CARD: AgentCard = {
  agentId: 'nlu',
  name: '自然语言理解',
  description: '法律文本实体抽取 + 模糊意图澄清 + 复合意图拆分（v2.3-W4）',
  version: '1.0.0',
  capabilities: ['nlu.extract', 'nlu.clarify'],
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '待解析文本（nlu.extract）' },
      intent: {
        type: 'string',
        description: '已识别意图（nlu.clarify 启动模式 / nlu.extract 复合拆分参考）',
      },
      entities: { type: 'array', description: '已抽取实体（nlu.clarify 启动模式）' },
      mode: { type: 'string', enum: ['start', 'answer'], description: 'nlu.clarify 模式' },
      sessionId: { type: 'string', description: '澄清会话 ID（nlu.clarify 回复模式）' },
      reply: { type: 'string', description: '用户回复文本（nlu.clarify 回复模式）' },
      ctx: {
        type: 'object',
        description: 'NLU 上下文（sessionId/userId/msgId/lastTurnEntities/recentTurns）',
      },
    },
    required: ['text'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      entities: { type: 'array', description: '抽取的实体列表' },
      isCompound: { type: 'boolean', description: '是否复合意图' },
      subIntents: { type: 'array', description: '复合意图子句（nlu.extract）' },
      clarification: { type: 'object', description: '澄清卡片（nlu.clarify）' },
      state: { type: 'string', description: '澄清状态机当前态（nlu.clarify）' },
      turns: { type: 'number', description: '已追问轮数（nlu.clarify）' },
      degradedCode: { type: 'number', description: '降级码（8010 LLM 降级 / 8011 澄清超时）' },
      warnings: { type: 'array', description: '警告信息' },
      disclaimer: { type: 'string' },
      lawRefs: { type: 'array' },
      traceId: { type: 'string' },
    },
    required: ['disclaimer', 'lawRefs', 'traceId'],
  },
  piiLevel: 'L3',
  exposure: 'L-Internal',
  async: false,
  timeout: 12_000,
};

@Injectable()
export class NluAgent extends BaseAgent {
  readonly card = NLU_CARD;

  constructor(
    private readonly entityExtractor: EntityExtractorService,
    private readonly clarificationManager: ClarificationManagerService,
    private readonly compoundSplitter: CompoundIntentSplitterService,
    @Optional() pii?: PiiService,
    @Optional() audit?: AuditLogService,
    @Optional() logger?: AppLoggerService,
  ) {
    super(pii, audit, logger);
  }

  protected async execute(input: AgentInvokeInput, ctx: AgentContext): Promise<AgentInvokeOutput> {
    const capability = input.capability || 'nlu.extract';
    const params = input.params ?? {};
    const nluCtx = this.resolveNluContext(params, ctx);

    try {
      if (capability === 'nlu.extract') {
        return await this.handleExtract(params, nluCtx, ctx);
      }
      if (capability === 'nlu.clarify') {
        return await this.handleClarify(params, nluCtx, ctx);
      }
      // 不支持的 capability
      return {
        ok: false,
        data: {},
        lawRefs: [],
        disclaimer: DISCLAIMER_TEXT,
        verified: false,
        usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
        errorCode: 7005,
        errorMessage: `NluAgent 不支持 capability: ${capability}`,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger?.error('NluAgent 执行异常', {
        agentId: 'nlu',
        capability,
        traceId: ctx.traceId,
        error: errorMessage,
      });
      return {
        ok: false,
        data: {},
        lawRefs: [],
        disclaimer: DISCLAIMER_TEXT,
        verified: false,
        usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
        errorCode: 7003,
        errorMessage: `NLU 处理异常：${errorMessage}`,
      };
    }
  }

  // ===== nlu.extract =====

  private async handleExtract(
    params: Record<string, unknown>,
    nluCtx: NluContext | undefined,
    ctx: AgentContext,
  ): Promise<AgentInvokeOutput> {
    const text = typeof params.text === 'string' ? params.text : '';
    if (!text.trim()) {
      return {
        ok: false,
        data: {},
        lawRefs: [],
        disclaimer: DISCLAIMER_TEXT,
        verified: false,
        usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
        errorCode: 7005,
        errorMessage: 'nlu.extract 入参 text 不能为空',
      };
    }

    // 并行执行：实体抽取 + 复合意图拆分
    const [extractResult, splitResult] = await Promise.all([
      this.entityExtractor.extract(text, nluCtx),
      this.compoundSplitter.split(text, nluCtx),
    ]);

    return {
      ok: true,
      data: {
        entities: extractResult.entities,
        isCompound: splitResult.isCompound,
        subIntents: splitResult.isCompound ? splitResult.subIntents : [],
        executionOrder: splitResult.isCompound ? splitResult.executionOrder : [],
        warnings: [...extractResult.warnings, ...splitResult.warnings],
        degradedCode: extractResult.degradedCode,
        modelVersion: extractResult.modelVersion,
        promptVersion: extractResult.promptVersion,
        traceId: ctx.traceId,
      },
      lawRefs: [],
      disclaimer: DISCLAIMER_TEXT,
      verified: false,
      usage: {
        durationMs: 0,
        tokensIn: extractResult.tokensIn ?? 0,
        tokensOut: extractResult.tokensOut ?? 0,
      },
    };
  }

  // ===== nlu.clarify =====

  private async handleClarify(
    params: Record<string, unknown>,
    nluCtx: NluContext | undefined,
    ctx: AgentContext,
  ): Promise<AgentInvokeOutput> {
    const mode = typeof params.mode === 'string' ? params.mode : 'start';

    let result;
    if (mode === 'answer') {
      const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
      const reply = typeof params.reply === 'string' ? params.reply : '';
      if (!sessionId || !reply) {
        return {
          ok: false,
          data: {},
          lawRefs: [],
          disclaimer: DISCLAIMER_TEXT,
          verified: false,
          usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
          errorCode: 7005,
          errorMessage: 'nlu.clarify answer 模式需要 sessionId 和 reply 参数',
        };
      }
      result = await this.clarificationManager.answerClarify(sessionId, reply, nluCtx);
    } else {
      // start 模式
      const intent = (
        typeof params.intent === 'string' ? params.intent : 'general_qa'
      ) as IntentType;
      const entities = Array.isArray(params.entities) ? (params.entities as Entity[]) : [];
      result = await this.clarificationManager.startClarify(intent, entities, nluCtx ?? {});
    }

    return {
      ok: true,
      data: {
        clarification: result.clarification,
        state: result.state,
        turns: result.turns,
        fallbackIntent: result.fallbackIntent,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        sessionId: result.sessionId,
        traceId: ctx.traceId,
      },
      lawRefs: [],
      disclaimer: DISCLAIMER_TEXT,
      verified: false,
      usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
    };
  }

  /** 从 AgentInvokeInput.params.ctx 与 AgentContext 派生 NluContext */
  private resolveNluContext(
    params: Record<string, unknown>,
    ctx: AgentContext,
  ): NluContext | undefined {
    const rawCtx = params.ctx;
    if (rawCtx && typeof rawCtx === 'object') {
      const c = rawCtx as Record<string, unknown>;
      return {
        sessionId: typeof c.sessionId === 'string' ? c.sessionId : ctx.traceId,
        userId: typeof c.userId === 'string' ? c.userId : ctx.callerUserId,
        msgId: typeof c.msgId === 'string' ? c.msgId : undefined,
        lastTurnEntities: Array.isArray(c.lastTurnEntities)
          ? (c.lastTurnEntities as Entity[])
          : undefined,
        recentTurns: Array.isArray(c.recentTurns)
          ? (c.recentTurns as NluContext['recentTurns'])
          : undefined,
      };
    }
    // 兜底：用 AgentContext 构造
    return {
      sessionId: ctx.traceId,
      userId: ctx.callerUserId,
    };
  }
}
