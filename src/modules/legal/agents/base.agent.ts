/**
 * BaseAgent —— Agent 抽象基类（A4-W1，A4 §五 5.3 横切注入）。
 *
 * 模板方法模式：封装所有 Agent 的横切关注点，子类只需实现 execute()。
 *
 * 横切关注点：
 *   1. PII 边界校验（assertBoundary，超界抛 7004）
 *   2. 审计日志（agent_invoke 事件，success/failure/blocked）
 *   3. 结构化日志（info/warn/error，含 traceId/agentId/durationMs）
 *   4. usage 跟踪（durationMs 自动填充，tokensIn/Out 由子类填充）
 *   5. 超时保护（withTimeout，超时抛 7003 触发降级）
 *   6. 免责声明兜底（outputSchema 缺 disclaimer 时注入 FALLBACK_DISCLAIMER）
 *   7. invocation_log 写入（agent_invocation_log 集合，TTL 30 天）
 *
 * 子类契约：
 *   - 必须实现 readonly card: AgentCard
 *   - 必须实现 protected execute(input, ctx)：返回 AgentInvokeOutput（不含 usage.durationMs，由基类填充）
 *   - 可选覆写 protected buildParamsPreview(input)：返回入参摘要（用于 invocation_log，默认 JSON 截断 1000 字符）
 *
 * 设计依据：A4 §五 5.3；A4 §6.4 降级；A4 §8.2 PII 边界；A4 §8.3 超时。
 */
import { Optional } from '@nestjs/common';
import { PiiService } from '../../platform/pii/pii.service';
import type { PiiLevel } from '../../platform/pii/pii.service';
import { AuditLogService } from '../../platform/audit/audit-log.service';
import { AppLoggerService } from '../../platform/logger/logger.service';
import type {
  AgentCard,
  AgentContext,
  AgentInvokeInput,
  AgentInvokeOutput,
  AgentInvokeStatus,
  LegalAgent,
} from './types';
import { AGENT_ERROR_CODES } from './types';
import { FALLBACK_DISCLAIMER, DEFAULT_AGENT_TIMEOUT_MS } from './agents.constants';

/** invocation_log paramsPreview 最大长度 */
const PARAMS_PREVIEW_MAX = 1000;
/** errorMessage 最大长度（避免超长入库） */
const ERROR_MESSAGE_MAX = 500;

export abstract class BaseAgent implements LegalAgent {
  abstract readonly card: AgentCard;

  constructor(
    @Optional() protected readonly pii?: PiiService,
    @Optional() protected readonly audit?: AuditLogService,
    @Optional() protected readonly logger?: AppLoggerService,
  ) {}

  /**
   * 模板方法：PII 校验 → execute → usage 填充 → 审计 → 日志。
   * 子类不应覆写此方法，应实现 execute()。
   */
  async invoke(input: AgentInvokeInput, ctx: AgentContext): Promise<AgentInvokeOutput> {
    const startedAt = Date.now();
    const { agentId, capabilities } = this.card;
    const capability = input.capability || capabilities[0];

    // ===== 1. PII 边界校验（A4 §8.2）=====
    try {
      this.assertPiiBoundary(input.piiLevel);
    } catch (err) {
      // PII 违规：审计 blocked + 7004
      this.logInvocation(ctx, input, 'blocked', startedAt, {
        errorCode: AGENT_ERROR_CODES.PII_BOUNDARY_VIOLATION,
        errorMessage: this.toErrorMessage(err),
      });
      this.audit?.write('agent_invoke', {
        agentId,
        capability,
        callerAgentId: ctx.callerAgentId,
        result: 'blocked',
        reason: 'pii_boundary_violation',
      });
      throw err;
    }

    // ===== 2. 执行子类逻辑（含超时保护）=====
    try {
      const timeout = this.resolveTimeout(ctx);
      const result = await this.withTimeout(this.execute(input, ctx), timeout, ctx);

      // ===== 3. usage 填充 =====
      result.usage = {
        durationMs: Date.now() - startedAt,
        tokensIn: result.usage?.tokensIn ?? 0,
        tokensOut: result.usage?.tokensOut ?? 0,
        cacheHit: result.usage?.cacheHit,
      };

      // ===== 4. 兜底免责声明（A4 验收 #9）=====
      if (!result.disclaimer) {
        result.disclaimer = FALLBACK_DISCLAIMER;
        this.logger?.warn('Agent output 缺 disclaimer，已注入兜底', {
          agentId,
          traceId: ctx.traceId,
        });
      }

      // ===== 5. 审计 + 日志（success / degraded）=====
      // result.ok=true → success；result.ok=false → degraded（业务未命中/桩未实现/降级返回）
      const invokeResult: AgentInvokeStatus = result.ok ? 'success' : 'degraded';
      this.logInvocation(ctx, input, invokeResult, startedAt, {
        tokensIn: result.usage.tokensIn,
        tokensOut: result.usage.tokensOut,
        cacheHit: result.usage.cacheHit,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      });
      this.audit?.write('agent_invoke', {
        agentId,
        capability,
        callerAgentId: ctx.callerAgentId,
        result: invokeResult,
        durationMs: result.usage.durationMs,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      });

      return result;
    } catch (err) {
      const errorMessage = this.toErrorMessage(err);
      const isTimeout = errorMessage.includes('超时');

      // ===== 失败审计 + 日志 =====
      this.logInvocation(ctx, input, isTimeout ? 'degraded' : 'failed', startedAt, {
        errorCode: isTimeout
          ? AGENT_ERROR_CODES.AGENT_DEGRADED
          : AGENT_ERROR_CODES.CRITICAL_DEGRADATION,
        errorMessage,
      });
      this.audit?.write('agent_invoke', {
        agentId,
        capability,
        callerAgentId: ctx.callerAgentId,
        result: isTimeout ? 'degraded' : 'failed',
        durationMs: Date.now() - startedAt,
        errorMessage,
      });

      // 超时抛 7003（触发 fallbackAgentId 降级），其他错误原样抛
      if (isTimeout) {
        const timeoutErr = new Error(`Agent ${agentId} 超时（${this.resolveTimeout(ctx)}ms）`);
        (timeoutErr as Error & { code?: number }).code = AGENT_ERROR_CODES.AGENT_DEGRADED;
        throw timeoutErr;
      }
      throw err;
    }
  }

  /**
   * 子类实现：实际业务逻辑。
   * 返回的 AgentInvokeOutput 中 usage.durationMs 由基类填充，tokensIn/Out 由子类填充。
   */
  protected abstract execute(
    input: AgentInvokeInput,
    ctx: AgentContext,
  ): Promise<AgentInvokeOutput>;

  // ===== 内部辅助 =====

  /** PII 边界校验：inputLevel 超过 card.piiLevel 抛 7004 */
  protected assertPiiBoundary(inputLevel: PiiLevel): void {
    this.pii?.assertBoundary(inputLevel, this.card.piiLevel);
  }

  /**
   * 解析本次调用超时：
   *   1. AgentContext.deadline 剩余预算（min(deadline - now, card.timeout)）
   *   2. 无 deadline 时用 card.timeout
   *   3. 兜底 DEFAULT_AGENT_TIMEOUT_MS
   */
  protected resolveTimeout(ctx: AgentContext): number {
    const cardTimeout = this.card.timeout || DEFAULT_AGENT_TIMEOUT_MS;
    if (ctx.deadline > 0) {
      const remaining = ctx.deadline - Date.now();
      if (remaining > 0) {
        return Math.min(remaining, cardTimeout);
      }
      // deadline 已过：返回 0 触发立即超时（由 withTimeout 处理）
      return 0;
    }
    return cardTimeout;
  }

  /** Promise 超时保护（A4 §8.3） */
  protected withTimeout<T>(promise: Promise<T>, ms: number, _ctx: AgentContext): Promise<T> {
    if (ms <= 0) {
      return Promise.reject(new Error(`Agent ${this.card.agentId} 超时（deadline 已过）`));
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Agent ${this.card.agentId} 超时（${ms}ms）`));
      }, ms);
      promise
        .then((v) => {
          clearTimeout(timer);
          resolve(v);
        })
        .catch((err: unknown) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /** 入参摘要（用于 invocation_log，默认 JSON 截断，子类可覆写以脱敏） */
  protected buildParamsPreview(input: AgentInvokeInput): string {
    try {
      const json = JSON.stringify(input.params);
      return json.length > PARAMS_PREVIEW_MAX ? `${json.slice(0, PARAMS_PREVIEW_MAX)}...` : json;
    } catch {
      return '(params not serializable)';
    }
  }

  /** 写 invocation_log（TTL 30 天）—— A4 §九 */
  private logInvocation(
    ctx: AgentContext,
    input: AgentInvokeInput,
    result: AgentInvokeStatus,
    startedAt: number,
    extra: {
      tokensIn?: number;
      tokensOut?: number;
      cacheHit?: string;
      errorCode?: number;
      errorMessage?: string;
    } = {},
  ): void {
    const durationMs = Date.now() - startedAt;
    this.logger?.debug('Agent invoke', {
      agentId: this.card.agentId,
      capability: input.capability,
      traceId: ctx.traceId,
      callerAgentId: ctx.callerAgentId,
      result,
      durationMs,
      tokensIn: extra.tokensIn,
      tokensOut: extra.tokensOut,
      cacheHitTag: extra.cacheHit,
      errorCode: extra.errorCode,
    });
    // invocation_log 落库由 InvocationLogService 负责（A4-W2 实现），
    // 此处仅写 logger，避免 BaseAgent 直接依赖 Mongoose Model。
    // 完整 invocation_log 写入在 OrchestratorAgent 编排层统一处理。
  }

  /** 错误消息归一化 + 截断 */
  private toErrorMessage(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.length > ERROR_MESSAGE_MAX ? `${msg.slice(0, ERROR_MESSAGE_MAX)}...` : msg;
  }
}
