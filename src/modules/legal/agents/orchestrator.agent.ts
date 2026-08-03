/**
 * OrchestratorAgent —— 意图编排核心 Agent（A4-W3，A4 §六）。
 *
 * capability: orchestrate
 * exposure: L-Internal（仅 ChatController / 内部调用，不对外暴露）
 * async: false（编排本身同步；下游异步 agent 返回 jobId 由调用方轮询）
 *
 * 职责（A4 §6.1 编排流程）：
 *   1. IntentRouter.classify 判定意图
 *   2. 查 PLAN_BY_INTENT 编排计划
 *   3. 执行编排（single / parallel / serial + shortCircuit）
 *   4. 聚合输出（合并 lawRefs / disclaimer / usage）
 *   5. 降级处理：
 *      - 子 agent 失败 → 尝试 fallbackAgentId
 *      - 关键 agent 全失败 → 返回 5001（由 ChatController 降级到 v2.0 单体）
 *
 * 编排模式（A4 §6.3）：
 *   - single：单 agent 直调
 *   - parallel：Promise.allSettled + 聚合（部分失败不阻断）
 *   - serial：前序输出作为后序输入；shortCircuit=true 时命中即返
 *
 * 入参契约：
 *   input.params.message: 用户原始消息（用于意图分类 + 派生 query）
 *   input.params.dialogContext?: 对话上下文（IntentRouter 用）
 *   input.params.templateCode/vars/caseDescription/category/keyword: 各 agent 专用参数
 *
 * 出参契约：
 *   data.answer / data.results / data.docId 等（取决于最终 agent）
 *   data.intent / data.route / data.plan: 编排元信息
 *   lawRefs: 聚合所有 agent 的法条引用
 *   disclaimer: 兜底免责
 *
 * 设计依据：A4 §六；A4 §6.2 PLAN_BY_INTENT；A4 §6.4 降级机制。
 */
import { Injectable, Optional } from '@nestjs/common';
import { BaseAgent } from './base.agent';
import type {
  AgentCard,
  AgentContext,
  AgentInvokeInput,
  AgentInvokeOutput,
  LegalAgent,
  OrchestrationPlan,
} from './types';
import { PLAN_BY_INTENT } from './agents.constants';
import { AGENT_ERROR_CODES } from './types';
import { PiiService } from '../../platform/pii/pii.service';
import { AuditLogService } from '../../platform/audit/audit-log.service';
import { AppLoggerService } from '../../platform/logger/logger.service';
import { IntentRouterService } from '../intent/intent-router.service';
import type { IntentResult } from '../../../types/intent';
import type { DialogContext } from '../../../types/dialog';
import type { LawRef } from '../../../types/llm';
import { AgentRegistry } from './registry';
import { DISCLAIMER_TEXT } from '../chat/sse-frames';

const CARD: AgentCard = {
  agentId: 'orchestrator',
  name: '编排器',
  description: '意图识别 + 多 Agent 编排调度（single/parallel/serial + shortCircuit）',
  version: '1.0.0',
  capabilities: ['orchestrate'],
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: '用户原始消息' },
      dialogContext: { type: 'object', description: '对话上下文（可选）' },
      templateCode: { type: 'string' },
      vars: { type: 'object' },
      caseDescription: { type: 'string' },
      category: { type: 'string' },
      keyword: { type: 'string' },
    },
    required: ['message'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      answer: { type: 'string' },
      intent: { type: 'string' },
      route: { type: 'string' },
      plan: { type: 'string' },
      disclaimer: { type: 'string' },
      lawRefs: { type: 'array' },
      traceId: { type: 'string' },
    },
    required: ['disclaimer', 'lawRefs', 'traceId'],
  },
  piiLevel: 'L1', // 编排器本身不直接处理 PII，仅路由
  exposure: 'L-Internal',
  async: false,
  timeout: 30_000, // 编排可能涉及多 agent，给 30s
};

@Injectable()
export class OrchestratorAgent extends BaseAgent {
  readonly card = CARD;

  constructor(
    private readonly registry: AgentRegistry,
    private readonly intentRouter: IntentRouterService,
    @Optional() pii?: PiiService,
    @Optional() audit?: AuditLogService,
    @Optional() logger?: AppLoggerService,
  ) {
    super(pii, audit, logger);
  }

  protected async execute(input: AgentInvokeInput, ctx: AgentContext): Promise<AgentInvokeOutput> {
    const message = String(input.params.message ?? '').trim();
    if (!message) {
      return this.fail(1001, 'message 不能为空', ctx);
    }

    // 1. 意图识别
    const dialogCtx = this.resolveDialogContext(input, ctx);
    let classify: IntentResult;
    try {
      classify = await this.intentRouter.classify(message, dialogCtx);
    } catch (err) {
      this.logger?.error('Orchestrator: 意图识别失败', {
        traceId: ctx.traceId,
        error: err instanceof Error ? err.message : String(err),
      });
      return this.fail(5001, '意图识别失败', ctx);
    }

    this.logger?.info('Orchestrator: 意图识别完成', {
      traceId: ctx.traceId,
      intent: classify.intent,
      route: classify.route,
      confidence: classify.confidence,
    });

    // 2. 查编排计划
    const plan = PLAN_BY_INTENT[classify.intent];
    if (!plan) {
      this.logger?.warn('Orchestrator: 未知意图，无编排计划', {
        intent: classify.intent,
      });
      return this.fail(7003, `未知意图: ${classify.intent}`, ctx);
    }

    // 3. 执行编排
    try {
      const result = await this.executePlan(plan, input, ctx, classify);
      // 注入编排元信息
      result.data = {
        ...result.data,
        intent: classify.intent,
        route: classify.route,
        plan: plan.intent,
        confidence: classify.confidence,
      };
      return result;
    } catch (err) {
      this.logger?.error('Orchestrator: 编排执行失败', {
        traceId: ctx.traceId,
        intent: classify.intent,
        error: err instanceof Error ? err.message : String(err),
      });
      this.audit?.write('degradation', {
        agentId: 'orchestrator',
        intent: classify.intent,
        reason: 'critical_agents_failed',
        error: err instanceof Error ? err.message : String(err),
      });
      // 关键 agent 全失败 → 返回 5001（由 ChatController 降级到 v2.0 单体）
      return this.fail(5001, '编排失败：关键 agent 全部不可用', ctx);
    }
  }

  // ===== 编排执行 =====

  /**
   * 执行编排计划（A4 §6.3）。
   * 遍历 steps，按 mode 调用 agent，串行模式前序输出作为后序输入。
   */
  private async executePlan(
    plan: OrchestrationPlan,
    input: AgentInvokeInput,
    ctx: AgentContext,
    classify: IntentResult,
  ): Promise<AgentInvokeOutput> {
    let lastResult: AgentInvokeOutput | null = null;
    let parallelResults: Record<string, AgentInvokeOutput> = {};

    for (const step of plan.steps) {
      if (step.mode === 'single') {
        lastResult = await this.executeSingle(
          step.agentIds[0],
          input,
          ctx,
          classify,
          parallelResults,
          lastResult,
        );
        if (step.shortCircuit && lastResult.ok) {
          return this.aggregate(lastResult, parallelResults, classify);
        }
      } else if (step.mode === 'parallel') {
        parallelResults = await this.executeParallel(step.agentIds, input, ctx, classify);
      } else if (step.mode === 'serial') {
        for (const agentId of step.agentIds) {
          lastResult = await this.executeSingle(
            agentId,
            input,
            ctx,
            classify,
            parallelResults,
            lastResult,
          );
          if (step.shortCircuit && lastResult.ok) {
            return this.aggregate(lastResult, parallelResults, classify);
          }
        }
      }
    }

    if (!lastResult) {
      throw new Error('编排计划未产生任何结果');
    }
    return this.aggregate(lastResult, parallelResults, classify);
  }

  /**
   * 单 agent 调用（含 fallback 降级）。
   * - 派生入参（deriveInput）
   * - 调用 agent.invoke
   * - 失败时尝试 card.fallbackAgentId
   */
  private async executeSingle(
    agentId: string,
    input: AgentInvokeInput,
    ctx: AgentContext,
    classify: IntentResult,
    parallelResults: Record<string, AgentInvokeOutput>,
    prevResult: AgentInvokeOutput | null,
  ): Promise<AgentInvokeOutput> {
    const agent = this.registry.get(agentId);
    const stepInput = this.deriveInput(agent, input, ctx, classify, parallelResults, prevResult);

    try {
      const result = await agent.invoke(stepInput, ctx);
      if (result.ok) {
        return result;
      }
      // agent 返回 ok=false（业务未命中）：尝试 fallback
      if (agent.card.fallbackAgentId) {
        this.logger?.warn('Orchestrator: agent 未命中，尝试 fallback', {
          agentId,
          fallbackAgentId: agent.card.fallbackAgentId,
          errorCode: result.errorCode,
          traceId: ctx.traceId,
        });
        return this.invokeFallback(agent.card.fallbackAgentId, stepInput, ctx, agentId);
      }
      return result;
    } catch (err) {
      // agent 抛错（超时/异常）：尝试 fallback
      this.logger?.warn('Orchestrator: agent 调用异常，尝试 fallback', {
        agentId,
        error: err instanceof Error ? err.message : String(err),
        traceId: ctx.traceId,
      });
      this.audit?.write('degradation', {
        agentId,
        reason: 'invoke_failed',
        error: err instanceof Error ? err.message : String(err),
      });
      if (agent.card.fallbackAgentId) {
        return this.invokeFallback(agent.card.fallbackAgentId, stepInput, ctx, agentId);
      }
      throw err;
    }
  }

  /**
   * 并行调用多 agent（A4 §6.3 parallel）。
   * Promise.allSettled + 聚合，部分失败不阻断。
   */
  private async executeParallel(
    agentIds: string[],
    input: AgentInvokeInput,
    ctx: AgentContext,
    classify: IntentResult,
  ): Promise<Record<string, AgentInvokeOutput>> {
    const entries = await Promise.allSettled(
      agentIds.map(async (agentId) => {
        const agent = this.registry.get(agentId);
        const stepInput = this.deriveInput(agent, input, ctx, classify, {}, null);
        try {
          const result = await agent.invoke(stepInput, ctx);
          return [agentId, result] as const;
        } catch (err) {
          // 单个并行 agent 失败：返回失败结果而非抛错（部分失败不阻断）
          this.logger?.warn('Orchestrator: 并行 agent 失败，降级跳过', {
            agentId,
            error: err instanceof Error ? err.message : String(err),
            traceId: ctx.traceId,
          });
          this.audit?.write('degradation', {
            agentId,
            reason: 'parallel_invoke_failed',
            error: err instanceof Error ? err.message : String(err),
          });
          const failedResult: AgentInvokeOutput = {
            ok: false,
            data: {},
            lawRefs: [],
            disclaimer: DISCLAIMER_TEXT,
            verified: false,
            usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
            errorCode: AGENT_ERROR_CODES.AGENT_DEGRADED,
            errorMessage: err instanceof Error ? err.message : String(err),
          };
          return [agentId, failedResult] as const;
        }
      }),
    );

    const results: Record<string, AgentInvokeOutput> = {};
    for (const settled of entries) {
      if (settled.status === 'fulfilled') {
        results[settled.value[0]] = settled.value[1];
      }
    }
    return results;
  }

  /** 调用 fallback agent（A4 §6.4 降级机制） */
  private async invokeFallback(
    fallbackAgentId: string,
    input: AgentInvokeInput,
    ctx: AgentContext,
    originalAgentId: string,
  ): Promise<AgentInvokeOutput> {
    try {
      const fallbackAgent = this.registry.get(fallbackAgentId);
      const result = await fallbackAgent.invoke(input, ctx);
      this.audit?.write('degradation', {
        agentId: originalAgentId,
        fallbackAgentId,
        reason: 'fallback_invoked',
        result: result.ok ? 'success' : 'failed',
      });
      return result;
    } catch (err) {
      this.logger?.error('Orchestrator: fallback agent 也失败', {
        fallbackAgentId,
        originalAgentId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  // ===== 入参派生 =====

  /**
   * 派生各 agent 的入参（A4 §8.1 上下文传递）。
   * 根据 capability 从 input.params + parallelResults + prevResult 提取对应字段。
   */
  private deriveInput(
    agent: LegalAgent,
    input: AgentInvokeInput,
    _ctx: AgentContext,
    classify: IntentResult,
    parallelResults: Record<string, AgentInvokeOutput>,
    _prevResult: AgentInvokeOutput | null,
  ): AgentInvokeInput {
    const cap = this.resolveCapability(agent, classify.intent);
    const message = String(input.params.message ?? '');
    const piiLevel = input.piiLevel;

    switch (cap) {
      case 'law.lookup':
      case 'legal.qa':
      case 'case.search':
        return {
          capability: cap,
          params: { query: message },
          piiLevel,
        };

      case 'process.guide':
        return {
          capability: cap,
          params: {
            category: input.params.category,
            keyword: input.params.keyword ?? message,
          },
          piiLevel,
        };

      case 'material.checklist':
        return {
          capability: cap,
          params: {
            category: input.params.category,
            keyword: input.params.keyword ?? message,
          },
          piiLevel,
        };

      case 'document.generate': {
        // 异步生成：透传 templateCode + vars
        const asyncFlag = agent.card.async;
        return {
          capability: cap,
          params: {
            templateCode: input.params.templateCode,
            vars: input.params.vars ?? {},
            async: asyncFlag,
          },
          piiLevel,
        };
      }

      case 'case.analyze': {
        // 串行阶段：合并并行召回结果作为 retrievedContext
        const retrievedContext = this.mergeParallelContext(parallelResults);
        return {
          capability: cap,
          params: {
            caseDescription: input.params.caseDescription ?? message,
            question: input.params.question,
            retrievedContext,
          },
          piiLevel,
        };
      }

      case 'memory.read':
        return {
          capability: cap,
          params: { intent: classify.intent },
          piiLevel,
        };

      case 'memory.write':
        return {
          capability: cap,
          params: { entry: input.params.entry },
          piiLevel,
        };

      default:
        // 未知 capability：透传原入参
        return { capability: cap, params: input.params, piiLevel };
    }
  }

  /** 合并并行 agent 的结果为 case.analyze 的 retrievedContext 字符串 */
  private mergeParallelContext(parallelResults: Record<string, AgentInvokeOutput>): string {
    const parts: string[] = [];
    for (const [agentId, result] of Object.entries(parallelResults)) {
      if (!result.ok) continue;
      // case-search 返回 results 数组
      const results = result.data.results as Array<{ title: string; content: string }> | undefined;
      if (Array.isArray(results)) {
        for (const r of results) {
          parts.push(`【${r.title}】${r.content}`);
        }
      } else if (result.data.answer) {
        // law-lookup / legal-qa 返回 answer
        parts.push(`【${agentId}】${String(result.data.answer)}`);
      }
    }
    return parts.join('\n\n');
  }

  // ===== 输出聚合 =====

  /**
   * 聚合最终输出（A4 §6.1 第 4 步）。
   * - lawRefs 合并去重
   * - usage 累加
   * - disclaimer 取最终 agent 的（兜底由 BaseAgent 注入）
   */
  private aggregate(
    finalResult: AgentInvokeOutput,
    parallelResults: Record<string, AgentInvokeOutput>,
    _classify: IntentResult,
  ): AgentInvokeOutput {
    // 合并所有并行结果的 lawRefs
    const allLawRefs: LawRef[] = [...finalResult.lawRefs];
    const seen = new Set(allLawRefs.map((r) => r.ref));
    for (const r of Object.values(parallelResults)) {
      for (const lr of r.lawRefs) {
        if (!seen.has(lr.ref)) {
          seen.add(lr.ref);
          allLawRefs.push(lr);
        }
      }
    }

    // 累加 usage
    const totalTokensIn =
      finalResult.usage.tokensIn +
      Object.values(parallelResults).reduce((sum, r) => sum + r.usage.tokensIn, 0);
    const totalTokensOut =
      finalResult.usage.tokensOut +
      Object.values(parallelResults).reduce((sum, r) => sum + r.usage.tokensOut, 0);

    return {
      ...finalResult,
      lawRefs: allLawRefs,
      usage: {
        durationMs: finalResult.usage.durationMs,
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        cacheHit: finalResult.usage.cacheHit,
      },
    };
  }

  // ===== 辅助 =====

  /**
   * 根据 intent 选择 agent 的正确 capability（A4 §6.2）。
   *
   * 处理 multi-capability agent：
   *   - process-guide 拥有 process.guide + material.checklist
   *     · material_checklist 意图 → material.checklist
   *     · 其他意图（process_guide/document_generate 并行召回）→ process.guide
   *   - document 拥有 document.generate + document.export
   *     · document_generate 意图 → document.generate
   *   - case-analysis 拥有 case.analyze（单 capability，直接返回）
   *
   * 兜底：若 agent.capabilities 不含 intent 映射的目标 capability，返回 capabilities[0]。
   */
  private resolveCapability(agent: LegalAgent, intent: string): string {
    const caps = agent.card.capabilities;
    if (caps.length === 0) {
      throw new Error(`Agent ${agent.card.agentId} 无 capability 声明`);
    }

    // intent → 期望的 capability 映射（仅 multi-capability agent 需要）
    const INTENT_TO_CAPABILITY: Record<string, string> = {
      material_checklist: 'material.checklist',
      process_guide: 'process.guide',
      document_generate: 'document.generate',
      case_analysis: 'case.analyze',
      case_reasoning: 'case.reasoning',
      tool_invoke: 'tool.invoke',
    };

    const expected = INTENT_TO_CAPABILITY[intent];
    if (expected && caps.includes(expected)) {
      return expected;
    }

    // 兜底：第一个 capability
    return caps[0];
  }

  /** 解析 DialogContext：优先用 input.params.dialogContext，否则构造默认值 */
  private resolveDialogContext(input: AgentInvokeInput, ctx: AgentContext): DialogContext {
    const explicit = input.params.dialogContext as DialogContext | undefined;
    if (explicit && typeof explicit === 'object' && 'recentTurns' in explicit) {
      return explicit;
    }
    return {
      sessionId: ctx.traceId,
      userId: ctx.callerUserId,
      unresolvedCount: 0,
      recentTurns: [],
    };
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
