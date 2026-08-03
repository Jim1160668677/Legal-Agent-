/**
 * LawyerReviewAgent —— 律师复核 Agent（v2.3 阶段十，11 第 12 个 Agent）。
 *
 * 替代 stub.agent.ts 中的 LawyerReviewAgent 桩，包装 ReviewModule 五个核心服务：
 *   - capability 'review.lawyer'：律师审核工作流
 *       LawyerReviewService.sample / claim / startReview / submit / giveUp / getQueue
 *       入参 action: 'sample' | 'claim' | 'start' | 'submit' | 'give_up' | 'queue' | 'my_reviews'
 *   - capability 'review.score'：质量评分聚合
 *       AnswerQualityScorer.computeAutoScore / computeLawyerScore / computeOverallScore
 *       + AnswerTracer.record / getTrace
 *       入参 action: 'auto_score' | 'lawyer_score' | 'overall_score' | 'record_trace' | 'get_trace'
 *   - capability 'review.compliance'：合规风险扫描
 *       ComplianceMonitor.scan / scanAfterLawyerReview
 *       + LawyerAnnotationService.reflow（回流触发）
 *       入参 action: 'scan' | 'scan_after_review' | 'reflow'
 *
 * 调用契约（L-Internal，仅编排器可调，11 §8.1）：
 *   - 所有入参 params: { action, ... }
 *   - 出参 data: { ...actionResult, traceId }
 *
 * 横切依赖：BaseAgent 注入 PiiService + AuditLogService + AppLoggerService（@Optional）
 *
 * 设计依据：11 lawyer-review Agent；17 §8 Agent 编排；A4 §五 5.3。
 */
import { Injectable, Optional } from '@nestjs/common';
import { BaseAgent } from './base.agent';
import type { AgentCard, AgentContext, AgentInvokeInput, AgentInvokeOutput } from './types';
import { AGENT_ERROR_CODES } from './types';
import { PiiService } from '../../platform/pii/pii.service';
import { AuditLogService } from '../../platform/audit/audit-log.service';
import { AppLoggerService } from '../../platform/logger/logger.service';
import { DISCLAIMER_TEXT } from '../chat/sse-frames';
import { LawyerReviewService } from '../review/lawyer-review.service';
import { AnswerTracer } from '../review/answer-tracer.service';
import { AnswerQualityScorer } from '../review/answer-quality-scorer.service';
import { ComplianceMonitor } from '../review/compliance-monitor.service';
import { LawyerAnnotationService } from '../review/lawyer-annotation.service';
import type { IntentType } from '../../../types/intent';
import type {
  LawyerReviewAnnotations,
  TraceRecordInput,
  ComplianceScanInput,
  ReflowInput,
  ReviewSamplingInput,
} from '../review/review.types';

const LAWYER_REVIEW_CARD: AgentCard = {
  agentId: 'lawyer-review',
  name: '律师复核',
  description:
    '律师人工复核 + 质量评分 + 合规监控 + 标注回流（v2.3 阶段十实现，L-Internal 不对外）',
  version: '1.0.0',
  capabilities: ['review.lawyer', 'review.score', 'review.compliance'],
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description:
          '操作类型：review.lawyer→sample/claim/start/submit/give_up/queue/my_reviews；review.score→auto_score/lawyer_score/overall_score/record_trace/get_trace；review.compliance→scan/scan_after_review/reflow',
      },
      msgId: { type: 'string' },
      userId: { type: 'string' },
      intent: { type: 'string' },
      lawyerId: { type: 'string', description: '律师 userId' },
      reviewId: { type: 'string' },
      annotations: { type: 'object', description: '律师标注（submit 时）' },
      trace: { type: 'object', description: '溯源元数据（record_trace 时）' },
      answer: { type: 'string', description: 'AI 回答文本（auto_score/scan 时）' },
      scores: { type: 'object', description: '四维评分（lawyer_score 时）' },
      autoScore: { type: 'number' },
      lawyerScore: { type: 'number' },
      scanInput: { type: 'object', description: '合规扫描输入（scan 时）' },
      reflowInput: { type: 'object', description: '回流输入（reflow 时）' },
    },
    required: ['action'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      sampled: { type: 'boolean' },
      reviewId: { type: 'string' },
      state: { type: 'string' },
      queue: { type: 'array' },
      autoScore: { type: 'number' },
      lawyerScore: { type: 'number' },
      grade: { type: 'string' },
      trace: { type: 'object' },
      level: { type: 'string', description: '合规等级 pass/warn/block' },
      blocked: { type: 'boolean' },
      alertId: { type: 'string' },
      reflowResult: { type: 'object' },
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
export class LawyerReviewAgent extends BaseAgent {
  readonly card = LAWYER_REVIEW_CARD;

  constructor(
    @Optional() private readonly lawyerReviewService?: LawyerReviewService,
    @Optional() private readonly answerTracer?: AnswerTracer,
    @Optional() private readonly qualityScorer?: AnswerQualityScorer,
    @Optional() private readonly complianceMonitor?: ComplianceMonitor,
    @Optional() private readonly annotationService?: LawyerAnnotationService,
    @Optional() pii?: PiiService,
    @Optional() audit?: AuditLogService,
    @Optional() logger?: AppLoggerService,
  ) {
    super(pii, audit, logger);
  }

  protected async execute(input: AgentInvokeInput, ctx: AgentContext): Promise<AgentInvokeOutput> {
    const capability = input.capability || 'review.lawyer';
    const params = input.params ?? {};
    const action = typeof params.action === 'string' ? params.action : '';

    try {
      if (capability === 'review.lawyer') {
        return await this.handleReviewWorkflow(action, params, ctx);
      }
      if (capability === 'review.score') {
        return await this.handleScore(action, params, ctx);
      }
      if (capability === 'review.compliance') {
        return await this.handleCompliance(action, params, ctx);
      }
      return this.fail(7005, `LawyerReviewAgent 不支持 capability: ${capability}`, ctx);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const code = (err as Error & { code?: number }).code;
      this.logger?.error('LawyerReviewAgent 执行异常', {
        agentId: 'lawyer-review',
        capability,
        action,
        traceId: ctx.traceId,
        error: errorMessage,
      });
      // 业务错误（如非法状态流转）返回具体错误码，其他返回 7003
      const errorCode = code ?? 7003;
      return this.fail(errorCode, `律师复核处理异常：${errorMessage}`, ctx);
    }
  }

  // ===== review.lawyer：律师审核工作流 =====

  private async handleReviewWorkflow(
    action: string,
    params: Record<string, unknown>,
    ctx: AgentContext,
  ): Promise<AgentInvokeOutput> {
    if (!this.lawyerReviewService) {
      return this.fail(7005, 'LawyerReviewService 未注入', ctx);
    }

    switch (action) {
      case 'sample': {
        const sampleInput = this.resolveSamplingInput(params, ctx);
        const result = await this.lawyerReviewService.sample(sampleInput);
        // 命中入审时绑定溯源
        if (result.sampled && result.reviewId && this.answerTracer) {
          await this.answerTracer.bindLawyerReview(sampleInput.msgId, result.reviewId);
        }
        return this.ok(
          { sampled: result.sampled, riskLevel: result.riskLevel, reviewId: result.reviewId },
          ctx,
        );
      }
      case 'claim': {
        const reviewId = this.requireString(params, 'reviewId', ctx);
        const lawyerId = this.requireString(params, 'lawyerId', ctx);
        const review = await this.lawyerReviewService.claim(reviewId, lawyerId);
        return this.reviewResult(review, ctx);
      }
      case 'start': {
        const reviewId = this.requireString(params, 'reviewId', ctx);
        const lawyerId = this.requireString(params, 'lawyerId', ctx);
        const review = await this.lawyerReviewService.startReview(reviewId, lawyerId);
        return this.reviewResult(review, ctx);
      }
      case 'submit': {
        const reviewId = this.requireString(params, 'reviewId', ctx);
        const annotations = this.resolveAnnotations(params, ctx);
        const review = await this.lawyerReviewService.submit(reviewId, annotations);
        return this.reviewResult(review, ctx);
      }
      case 'give_up': {
        const reviewId = this.requireString(params, 'reviewId', ctx);
        const lawyerId = this.requireString(params, 'lawyerId', ctx);
        const review = await this.lawyerReviewService.giveUp(reviewId, lawyerId);
        return this.reviewResult(review, ctx);
      }
      case 'queue': {
        const limit = typeof params.limit === 'number' ? params.limit : 20;
        const queue = await this.lawyerReviewService.getQueue(limit);
        return this.ok({ queue, total: queue.length }, ctx);
      }
      case 'my_reviews': {
        const lawyerId = this.requireString(params, 'lawyerId', ctx);
        const limit = typeof params.limit === 'number' ? params.limit : 20;
        const reviews = await this.lawyerReviewService.getMyReviews(lawyerId, limit);
        return this.ok({ myReviews: reviews, total: reviews.length }, ctx);
      }
      default:
        return this.fail(7005, `review.lawyer 不支持 action: ${action}`, ctx);
    }
  }

  // ===== review.score：质量评分聚合 =====

  private async handleScore(
    action: string,
    params: Record<string, unknown>,
    ctx: AgentContext,
  ): Promise<AgentInvokeOutput> {
    switch (action) {
      case 'auto_score': {
        if (!this.qualityScorer) {
          return this.fail(7005, 'AnswerQualityScorer 未注入', ctx);
        }
        const answer = this.requireString(params, 'answer', ctx);
        const trace = this.resolveTraceMeta(params, ctx);
        const hasDisclaimer =
          typeof params.hasDisclaimer === 'boolean' ? params.hasDisclaimer : undefined;
        const result = this.qualityScorer.computeAutoScore({ answer, trace, hasDisclaimer });
        this.qualityScorer.writeScoredAudit(
          typeof params.msgId === 'string' ? params.msgId : ctx.traceId,
          result.autoScore,
        );
        return this.ok(
          {
            autoScore: result.autoScore,
            citationSuccessRate: result.citationSuccessRate,
            reasoningCompleteness: result.reasoningCompleteness,
            disclaimerCoverage: result.disclaimerCoverage,
          },
          ctx,
        );
      }
      case 'lawyer_score': {
        if (!this.qualityScorer) {
          return this.fail(7005, 'AnswerQualityScorer 未注入', ctx);
        }
        const scores = this.resolveScores(params, ctx);
        const result = this.qualityScorer.computeLawyerScore({ scores });
        return this.ok({ lawyerScore: result.lawyerScore, grade: result.grade }, ctx);
      }
      case 'overall_score': {
        if (!this.qualityScorer) {
          return this.fail(7005, 'AnswerQualityScorer 未注入', ctx);
        }
        const autoScore = typeof params.autoScore === 'number' ? params.autoScore : 0;
        const lawyerScore = typeof params.lawyerScore === 'number' ? params.lawyerScore : undefined;
        const result = this.qualityScorer.computeOverallScore(autoScore, lawyerScore);
        return this.ok(
          { score: result.score, grade: result.grade, triggerReflow: result.triggerReflow },
          ctx,
        );
      }
      case 'record_trace': {
        if (!this.answerTracer || !this.qualityScorer) {
          return this.fail(7005, 'AnswerTracer 或 AnswerQualityScorer 未注入', ctx);
        }
        const traceInput = this.resolveTraceRecordInput(params, ctx);
        // 先计算 autoScore，再记录溯源
        const autoResult = this.qualityScorer.computeAutoScore({
          answer: traceInput.answer,
          trace: {
            citedLaws: traceInput.citedLaws,
            reasoningChainId: traceInput.reasoningChainId,
          },
        });
        const trace = await this.answerTracer.record(traceInput, autoResult.autoScore);
        return this.ok({ trace, autoScore: autoResult.autoScore }, ctx);
      }
      case 'get_trace': {
        if (!this.answerTracer) {
          return this.fail(7005, 'AnswerTracer 未注入', ctx);
        }
        const msgId = this.requireString(params, 'msgId', ctx);
        const trace = await this.answerTracer.getTrace(msgId);
        return this.ok({ trace }, ctx);
      }
      default:
        return this.fail(7005, `review.score 不支持 action: ${action}`, ctx);
    }
  }

  // ===== review.compliance：合规风险扫描 + 回流 =====

  private async handleCompliance(
    action: string,
    params: Record<string, unknown>,
    ctx: AgentContext,
  ): Promise<AgentInvokeOutput> {
    switch (action) {
      case 'scan': {
        if (!this.complianceMonitor) {
          return this.fail(7005, 'ComplianceMonitor 未注入', ctx);
        }
        const scanInput = this.resolveScanInput(params, ctx);
        const result = await this.complianceMonitor.scan(scanInput);
        return this.ok(
          {
            level: result.level,
            triggers: result.triggers,
            blocked: result.blocked,
            alertId: result.alertId,
          },
          ctx,
        );
      }
      case 'scan_after_review': {
        if (!this.complianceMonitor) {
          return this.fail(7005, 'ComplianceMonitor 未注入', ctx);
        }
        const msgId = this.requireString(params, 'msgId', ctx);
        const userId = this.requireString(params, 'userId', ctx);
        const riskFlag = this.resolveRiskFlag(params, ctx);
        const result = await this.complianceMonitor.scanAfterLawyerReview(msgId, userId, riskFlag);
        return this.ok(
          {
            level: result.level,
            triggers: result.triggers,
            blocked: result.blocked,
            alertId: result.alertId,
          },
          ctx,
        );
      }
      case 'reflow': {
        if (!this.annotationService) {
          return this.fail(7005, 'LawyerAnnotationService 未注入', ctx);
        }
        const reflowInput = this.resolveReflowInput(params, ctx);
        const reasoningChainId =
          typeof params.reasoningChainId === 'string' ? params.reasoningChainId : undefined;
        const qualityScore =
          typeof params.qualityScore === 'number' ? params.qualityScore : undefined;
        const result = await this.annotationService.reflow(reflowInput, {
          reasoningChainId,
          qualityScore,
        });
        return this.ok(
          {
            reflowResult: result,
            successCount: result.successCount,
            skippedCount: result.skippedCount,
            failedCount: result.failedCount,
            ok: result.ok,
          },
          ctx,
        );
      }
      default:
        return this.fail(7005, `review.compliance 不支持 action: ${action}`, ctx);
    }
  }

  // ===== 入参派生 =====

  private resolveSamplingInput(
    params: Record<string, unknown>,
    ctx: AgentContext,
  ): ReviewSamplingInput {
    return {
      msgId: this.requireString(params, 'msgId', ctx),
      userId: this.requireString(params, 'userId', ctx),
      intent: (params.intent as IntentType) ?? 'general_qa',
      userFlagged: typeof params.userFlagged === 'boolean' ? params.userFlagged : false,
    };
  }

  private resolveAnnotations(
    params: Record<string, unknown>,
    ctx: AgentContext,
  ): LawyerReviewAnnotations {
    const raw = params.annotations;
    if (!raw || typeof raw !== 'object') {
      return this.failThrow(7005, 'submit 入参 annotations 不能为空', ctx);
    }
    const a = raw as Record<string, unknown>;
    const scores = a.scores as LawyerReviewAnnotations['scores'];
    if (!scores) {
      return this.failThrow(7005, 'annotations.scores 不能为空', ctx);
    }
    return {
      scores,
      textAnnotations: a.textAnnotations as LawyerReviewAnnotations['textAnnotations'],
      riskFlag: (a.riskFlag as LawyerReviewAnnotations['riskFlag']) ?? 'none',
      reviewedBy: typeof a.reviewedBy === 'string' ? a.reviewedBy : '',
      reviewedAt: a.reviewedAt instanceof Date ? a.reviewedAt : new Date(),
      duration: typeof a.duration === 'number' ? a.duration : 0,
    };
  }

  private resolveTraceMeta(params: Record<string, unknown>, _ctx: AgentContext) {
    const traceRaw = params.trace;
    const trace =
      traceRaw && typeof traceRaw === 'object'
        ? (traceRaw as {
            citedLaws?: Array<{ ref: string; verified: boolean }>;
            reasoningChainId?: string;
          })
        : {};
    return {
      citedLaws: Array.isArray(trace.citedLaws) ? trace.citedLaws : [],
      reasoningChainId: trace.reasoningChainId,
    };
  }

  private resolveScores(
    params: Record<string, unknown>,
    ctx: AgentContext,
  ): LawyerReviewAnnotations['scores'] {
    const raw = params.scores;
    if (!raw || typeof raw !== 'object') {
      return this.failThrow(7005, 'scores 不能为空', ctx);
    }
    const s = raw as Record<string, unknown>;
    return {
      accuracy: typeof s.accuracy === 'number' ? s.accuracy : 0,
      completeness: typeof s.completeness === 'number' ? s.completeness : 0,
      compliance: typeof s.compliance === 'number' ? s.compliance : 0,
      usefulness: typeof s.usefulness === 'number' ? s.usefulness : 0,
    };
  }

  private resolveTraceRecordInput(
    params: Record<string, unknown>,
    ctx: AgentContext,
  ): TraceRecordInput {
    return {
      msgId: this.requireString(params, 'msgId', ctx),
      userId: this.requireString(params, 'userId', ctx),
      intent: (params.intent as IntentType) ?? 'general_qa',
      citedLaws: Array.isArray(params.citedLaws)
        ? (params.citedLaws as TraceRecordInput['citedLaws'])
        : [],
      citedCases: Array.isArray(params.citedCases)
        ? (params.citedCases as TraceRecordInput['citedCases'])
        : undefined,
      promptVersion: typeof params.promptVersion === 'string' ? params.promptVersion : undefined,
      modelVersion: typeof params.modelVersion === 'string' ? params.modelVersion : undefined,
      reasoningChainId:
        typeof params.reasoningChainId === 'string' ? params.reasoningChainId : undefined,
      ragSources: Array.isArray(params.ragSources)
        ? (params.ragSources as TraceRecordInput['ragSources'])
        : undefined,
      answer: this.requireString(params, 'answer', ctx),
    };
  }

  private resolveScanInput(
    params: Record<string, unknown>,
    ctx: AgentContext,
  ): ComplianceScanInput {
    return {
      msgId: this.requireString(params, 'msgId', ctx),
      userId: this.requireString(params, 'userId', ctx),
      answer: typeof params.answer === 'string' ? params.answer : '',
      citationFailureRate:
        typeof params.citationFailureRate === 'number' ? params.citationFailureRate : undefined,
      lawyerRiskFlag: this.resolveRiskFlag(params, ctx),
      contentSafetyResult: params.contentSafetyResult as ComplianceScanInput['contentSafetyResult'],
    };
  }

  private resolveRiskFlag(
    params: Record<string, unknown>,
    _ctx: AgentContext,
  ): 'none' | 'low' | 'high' {
    const flag = params.lawyerRiskFlag ?? params.riskFlag;
    if (flag === 'high' || flag === 'low' || flag === 'none') return flag;
    return 'none';
  }

  private resolveReflowInput(params: Record<string, unknown>, ctx: AgentContext): ReflowInput {
    const raw = params.reflowInput;
    const src = (raw && typeof raw === 'object' ? raw : params) as Record<string, unknown>;
    return {
      reviewId: this.requireString(src, 'reviewId', ctx),
      msgId: this.requireString(src, 'msgId', ctx),
      userId: this.requireString(src, 'userId', ctx),
      intent: (src.intent as IntentType) ?? 'general_qa',
      annotations: this.resolveAnnotations(
        src.annotations ? { annotations: src.annotations } : src,
        ctx,
      ),
    };
  }

  // ===== 输出辅助 =====

  private ok(data: Record<string, unknown>, ctx: AgentContext): AgentInvokeOutput {
    return {
      ok: true,
      data: { ...data, traceId: ctx.traceId },
      lawRefs: [],
      disclaimer: DISCLAIMER_TEXT,
      verified: true,
      usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
    };
  }

  private reviewResult(
    review: {
      reviewId: string;
      state: string;
      msgId: string;
      intent: string;
      riskLevel: string;
    } | null,
    ctx: AgentContext,
  ): AgentInvokeOutput {
    if (!review) {
      return this.fail(8020, '审核记录不存在或状态流转失败', ctx);
    }
    return this.ok(
      {
        reviewId: review.reviewId,
        state: review.state,
        msgId: review.msgId,
        intent: review.intent,
        riskLevel: review.riskLevel,
      },
      ctx,
    );
  }

  private fail(code: number, message: string, ctx: AgentContext): AgentInvokeOutput {
    this.logger?.warn('LawyerReviewAgent 返回错误', {
      agentId: 'lawyer-review',
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

  private failThrow(code: number, message: string, _ctx: AgentContext): never {
    const err = new Error(message);
    (err as Error & { code?: number }).code = code;
    throw err;
  }

  private requireString(params: Record<string, unknown>, key: string, ctx: AgentContext): string {
    const val = params[key];
    if (typeof val !== 'string' || val.length === 0) {
      return this.failThrow(7005, `入参 ${key} 不能为空`, ctx);
    }
    return val;
  }
}

// 引用 AGENT_ERROR_CODES 避免未使用告警（保留以备扩展）
void AGENT_ERROR_CODES;
