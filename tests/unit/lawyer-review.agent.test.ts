/**
 * LawyerReviewAgent 单元测试（v2.3 阶段十，11 第 12 个 Agent）。
 *
 * 覆盖：
 *   - AgentCard 字段（agentId=lawyer-review, 3 capabilities, exposure=L-Internal, piiLevel=L4）
 *   - capability 'review.lawyer'：sample/claim/start/submit/queue/my_reviews
 *   - capability 'review.score'：auto_score/lawyer_score/overall_score/record_trace/get_trace
 *   - capability 'review.compliance'：scan/scan_after_review/reflow
 *   - capability 路由：不支持的能力 → 7005
 *   - 服务未注入 → 7005
 *   - 入参缺失 → 7005
 *   - 业务错误（非法状态流转）→ 对应错误码
 *
 * 设计依据：11 lawyer-review Agent；17 §8 Agent 编排；A4 §五 5.3。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LawyerReviewAgent } from '../../src/modules/legal/agents/lawyer-review.agent';
import { AgentRegistry } from '../../src/modules/legal/agents/registry';
import { AGENT_ERROR_CODES } from '../../src/modules/legal/agents/types';
import type { AgentContext, AgentInvokeInput } from '../../src/modules/legal/agents/types';

function makeCtx(): AgentContext {
  return {
    traceId: 'trace-review-001',
    callerUserId: 'user-1',
    deadline: Date.now() + 60_000,
    lang: 'zh',
  };
}

function makeInput(capability: string, params: Record<string, unknown> = {}): AgentInvokeInput {
  return { capability, params, piiLevel: 'L4' };
}

function makeAudit() {
  return { write: vi.fn(), writeSync: vi.fn() };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
}

/** mock LawyerReviewService */
function makeLawyerReviewService() {
  return {
    sample: vi.fn().mockResolvedValue({ sampled: true, riskLevel: 'high', reviewId: 'lr-001' }),
    claim: vi.fn().mockResolvedValue({
      reviewId: 'lr-001',
      state: 'claimed',
      msgId: 'msg-1',
      intent: 'case_reasoning',
      riskLevel: 'high',
    }),
    startReview: vi.fn().mockResolvedValue({
      reviewId: 'lr-001',
      state: 'reviewing',
      msgId: 'msg-1',
      intent: 'case_reasoning',
      riskLevel: 'high',
    }),
    submit: vi.fn().mockResolvedValue({
      reviewId: 'lr-001',
      state: 'submitted',
      msgId: 'msg-1',
      intent: 'case_reasoning',
      riskLevel: 'high',
    }),
    giveUp: vi.fn().mockResolvedValue({
      reviewId: 'lr-001',
      state: 'pending',
      msgId: 'msg-1',
      intent: 'case_reasoning',
      riskLevel: 'high',
    }),
    markReflowed: vi.fn().mockResolvedValue({
      reviewId: 'lr-001',
      state: 'reflowed',
      msgId: 'msg-1',
      intent: 'case_reasoning',
      riskLevel: 'high',
    }),
    getQueue: vi.fn().mockResolvedValue([
      {
        reviewId: 'lr-001',
        state: 'pending',
        msgId: 'msg-1',
        intent: 'case_reasoning',
        riskLevel: 'high',
      },
    ]),
    getMyReviews: vi.fn().mockResolvedValue([
      {
        reviewId: 'lr-001',
        state: 'claimed',
        msgId: 'msg-1',
        intent: 'case_reasoning',
        riskLevel: 'high',
      },
    ]),
    getReview: vi.fn().mockResolvedValue(null),
    sweepTimeouts: vi.fn().mockResolvedValue({ requeued: 0, released: 0 }),
  };
}

/** mock AnswerTracer */
function makeAnswerTracer() {
  return {
    record: vi.fn().mockResolvedValue({
      msgId: 'msg-1',
      userId: 'user-1',
      intent: 'case_reasoning',
      citedLaws: [],
      citedCases: [],
      ragSources: [],
      autoScore: 4.5,
      createdAt: new Date(),
    }),
    getTrace: vi.fn().mockResolvedValue({
      msgId: 'msg-1',
      userId: 'user-1',
      intent: 'case_reasoning',
      citedLaws: [{ ref: '法条1', verified: true }],
      citedCases: [],
      ragSources: [],
      autoScore: 4.5,
      createdAt: new Date(),
    }),
    bindLawyerReview: vi.fn().mockResolvedValue(undefined),
    computeCitationFailureRate: vi.fn().mockReturnValue(0),
    listByUser: vi.fn().mockResolvedValue([]),
  };
}

/** mock AnswerQualityScorer */
function makeQualityScorer() {
  return {
    computeAutoScore: vi.fn().mockReturnValue({
      autoScore: 4.5,
      citationSuccessRate: 1,
      reasoningCompleteness: 1,
      disclaimerCoverage: 1,
    }),
    computeLawyerScore: vi.fn().mockReturnValue({ lawyerScore: 4.25, grade: 'excellent' }),
    computeOverallScore: vi
      .fn()
      .mockReturnValue({ score: 4.25, grade: 'excellent', triggerReflow: false }),
    writeScoredAudit: vi.fn(),
  };
}

/** mock ComplianceMonitor */
function makeComplianceMonitor() {
  return {
    scan: vi.fn().mockResolvedValue({
      level: 'pass',
      triggers: [],
      blocked: false,
    }),
    scanAfterLawyerReview: vi.fn().mockResolvedValue({
      level: 'pass',
      triggers: [],
      blocked: false,
    }),
  };
}

/** mock LawyerAnnotationService */
function makeAnnotationService() {
  return {
    reflow: vi.fn().mockResolvedValue({
      results: [{ target: 'intent_eval_set', success: true, targetId: 'eval-001' }],
      successCount: 1,
      skippedCount: 3,
      failedCount: 0,
      ok: true,
    }),
  };
}

describe('LawyerReviewAgent（律师复核 Agent，11 第 12 个 Agent）', () => {
  let audit: ReturnType<typeof makeAudit>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    audit = makeAudit();
    logger = makeLogger();
  });

  describe('AgentCard 字段', () => {
    it('card 字段完整正确', () => {
      const agent = new LawyerReviewAgent(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      expect(agent.card.agentId).toBe('lawyer-review');
      expect(agent.card.capabilities).toEqual([
        'review.lawyer',
        'review.score',
        'review.compliance',
      ]);
      expect(agent.card.exposure).toBe('L-Internal');
      expect(agent.card.piiLevel).toBe('L4');
      expect(agent.card.async).toBe(true);
      expect(agent.card.timeout).toBe(60_000);
      expect(agent.card.version).toBe('1.0.0');
    });
  });

  // ===== review.lawyer =====

  describe('capability review.lawyer', () => {
    it('action=sample 抽样入审', async () => {
      const svc = makeLawyerReviewService();
      const tracer = makeAnswerTracer();
      const agent = new LawyerReviewAgent(
        svc as never,
        tracer as never,
        undefined,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(
        makeInput('review.lawyer', {
          action: 'sample',
          msgId: 'msg-1',
          userId: 'user-1',
          intent: 'case_reasoning',
        }),
        makeCtx(),
      );
      expect(result.ok).toBe(true);
      expect(result.data.sampled).toBe(true);
      expect(result.data.reviewId).toBe('lr-001');
      expect(svc.sample).toHaveBeenCalledWith(
        expect.objectContaining({ msgId: 'msg-1', intent: 'case_reasoning' }),
      );
      // 命中入审时绑定溯源
      expect(tracer.bindLawyerReview).toHaveBeenCalledWith('msg-1', 'lr-001');
    });

    it('action=claim 律师领取', async () => {
      const svc = makeLawyerReviewService();
      const agent = new LawyerReviewAgent(
        svc as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(
        makeInput('review.lawyer', { action: 'claim', reviewId: 'lr-001', lawyerId: 'lawyer-1' }),
        makeCtx(),
      );
      expect(result.ok).toBe(true);
      expect(result.data.state).toBe('claimed');
    });

    it('action=queue 查询待审队列', async () => {
      const svc = makeLawyerReviewService();
      const agent = new LawyerReviewAgent(
        svc as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(
        makeInput('review.lawyer', { action: 'queue', limit: 10 }),
        makeCtx(),
      );
      expect(result.ok).toBe(true);
      expect(result.data.queue).toHaveLength(1);
      expect(result.data.total).toBe(1);
    });

    it('action 缺失 → 7005', async () => {
      const svc = makeLawyerReviewService();
      const agent = new LawyerReviewAgent(
        svc as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(makeInput('review.lawyer', {}), makeCtx());
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(7005);
    });

    it('LawyerReviewService 未注入 → 7005', async () => {
      const agent = new LawyerReviewAgent(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(
        makeInput('review.lawyer', { action: 'sample', msgId: 'msg-1', userId: 'user-1' }),
        makeCtx(),
      );
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(7005);
      expect(result.errorMessage).toContain('LawyerReviewService 未注入');
    });
  });

  // ===== review.score =====

  describe('capability review.score', () => {
    it('action=auto_score 计算自动评分', async () => {
      const qs = makeQualityScorer();
      const agent = new LawyerReviewAgent(
        undefined,
        undefined,
        qs as never,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(
        makeInput('review.score', {
          action: 'auto_score',
          answer: '回答含免责声明',
          trace: { citedLaws: [{ ref: '法条1', verified: true }], reasoningChainId: 'rc-001' },
          msgId: 'msg-1',
        }),
        makeCtx(),
      );
      expect(result.ok).toBe(true);
      expect(result.data.autoScore).toBe(4.5);
      expect(qs.computeAutoScore).toHaveBeenCalled();
      expect(qs.writeScoredAudit).toHaveBeenCalled();
    });

    it('action=lawyer_score 计算律师评分', async () => {
      const qs = makeQualityScorer();
      const agent = new LawyerReviewAgent(
        undefined,
        undefined,
        qs as never,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(
        makeInput('review.score', {
          action: 'lawyer_score',
          scores: { accuracy: 4, completeness: 4, compliance: 5, usefulness: 4 },
        }),
        makeCtx(),
      );
      expect(result.ok).toBe(true);
      expect(result.data.lawyerScore).toBe(4.25);
      expect(result.data.grade).toBe('excellent');
    });

    it('action=record_trace 记录溯源（先算 autoScore 再记录）', async () => {
      const tracer = makeAnswerTracer();
      const qs = makeQualityScorer();
      const agent = new LawyerReviewAgent(
        undefined,
        tracer as never,
        qs as never,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(
        makeInput('review.score', {
          action: 'record_trace',
          msgId: 'msg-1',
          userId: 'user-1',
          intent: 'case_reasoning',
          answer: '回答',
          citedLaws: [{ ref: '法条1', verified: true }],
          reasoningChainId: 'rc-001',
        }),
        makeCtx(),
      );
      expect(result.ok).toBe(true);
      expect(qs.computeAutoScore).toHaveBeenCalled();
      expect(tracer.record).toHaveBeenCalledWith(expect.any(Object), 4.5);
      expect(result.data.autoScore).toBe(4.5);
    });

    it('action=get_trace 查询溯源', async () => {
      const tracer = makeAnswerTracer();
      const agent = new LawyerReviewAgent(
        undefined,
        tracer as never,
        undefined,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(
        makeInput('review.score', { action: 'get_trace', msgId: 'msg-1' }),
        makeCtx(),
      );
      expect(result.ok).toBe(true);
      expect(result.data.trace).toBeDefined();
      expect(result.data.trace.msgId).toBe('msg-1');
    });
  });

  // ===== review.compliance =====

  describe('capability review.compliance', () => {
    it('action=scan 合规扫描', async () => {
      const cm = makeComplianceMonitor();
      const agent = new LawyerReviewAgent(
        undefined,
        undefined,
        undefined,
        cm as never,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(
        makeInput('review.compliance', {
          action: 'scan',
          msgId: 'msg-1',
          userId: 'user-1',
          answer: '内容',
          citationFailureRate: 0.1,
        }),
        makeCtx(),
      );
      expect(result.ok).toBe(true);
      expect(result.data.level).toBe('pass');
      expect(result.data.blocked).toBe(false);
      expect(cm.scan).toHaveBeenCalled();
    });

    it('action=scan_after_review 律师复扫', async () => {
      const cm = makeComplianceMonitor();
      const agent = new LawyerReviewAgent(
        undefined,
        undefined,
        undefined,
        cm as never,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(
        makeInput('review.compliance', {
          action: 'scan_after_review',
          msgId: 'msg-1',
          userId: 'user-1',
          lawyerRiskFlag: 'none',
        }),
        makeCtx(),
      );
      expect(result.ok).toBe(true);
      expect(cm.scanAfterLawyerReview).toHaveBeenCalledWith('msg-1', 'user-1', 'none');
    });

    it('action=reflow 标注回流', async () => {
      const as = makeAnnotationService();
      const agent = new LawyerReviewAgent(
        undefined,
        undefined,
        undefined,
        undefined,
        as as never,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(
        makeInput('review.compliance', {
          action: 'reflow',
          reflowInput: {
            reviewId: 'lr-001',
            msgId: 'msg-1',
            userId: 'user-1',
            intent: 'case_reasoning',
            annotations: {
              scores: { accuracy: 4, completeness: 4, compliance: 5, usefulness: 4 },
              riskFlag: 'none',
              reviewedBy: 'lawyer-1',
              reviewedAt: new Date(),
              duration: 1000,
            },
          },
          reasoningChainId: 'rc-001',
        }),
        makeCtx(),
      );
      expect(result.ok).toBe(true);
      expect(result.data.successCount).toBe(1);
      expect(result.data.ok).toBe(true);
      expect(as.reflow).toHaveBeenCalled();
    });
  });

  // ===== 能力路由与错误处理 =====

  describe('能力路由与错误处理', () => {
    it('不支持的 capability → 7005', async () => {
      const agent = new LawyerReviewAgent(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(makeInput('review.unknown', { action: 'foo' }), makeCtx());
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(7005);
    });

    it('业务异常（非法状态流转）返回错误码', async () => {
      const svc = makeLawyerReviewService();
      const err = new Error('非法状态流转：pending → submitted');
      (err as Error & { code?: number }).code = 8021;
      svc.claim.mockRejectedValueOnce(err);
      const agent = new LawyerReviewAgent(
        svc as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(
        makeInput('review.lawyer', { action: 'claim', reviewId: 'lr-001', lawyerId: 'lawyer-1' }),
        makeCtx(),
      );
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(8021);
    });

    it('未知异常返回 7003', async () => {
      const svc = makeLawyerReviewService();
      svc.claim.mockRejectedValueOnce(new Error('未知错误'));
      const agent = new LawyerReviewAgent(
        svc as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(
        makeInput('review.lawyer', { action: 'claim', reviewId: 'lr-001', lawyerId: 'lawyer-1' }),
        makeCtx(),
      );
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(7003);
    });

    it('出参始终含 disclaimer + lawRefs + traceId（A4 验收 #9）', async () => {
      const svc = makeLawyerReviewService();
      const agent = new LawyerReviewAgent(
        svc as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      const result = await agent.invoke(makeInput('review.lawyer', { action: 'queue' }), makeCtx());
      expect(result.disclaimer).toBeTruthy();
      expect(result.lawRefs).toEqual([]);
      expect(result.data.traceId).toBe('trace-review-001');
    });
  });

  // ===== AgentRegistry 注册与可见性 =====

  describe('AgentRegistry 注册', () => {
    it('注册后 listCards 默认不可见（L-Internal），includeInternal 可见', () => {
      const svc = makeLawyerReviewService();
      const registry = new AgentRegistry();
      registry.register(
        new LawyerReviewAgent(
          svc as never,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          audit as never,
          logger as never,
        ),
      );
      expect(registry.size).toBe(1);
      expect(registry.capabilityCount).toBe(3);
      expect(registry.listCards()).toEqual([]);
      const allCards = registry.listCards({ includeInternal: true });
      expect(allCards.map((c) => c.agentId)).toEqual(['lawyer-review']);
    });

    it('lookup(review.score) 路由到 lawyer-review', () => {
      const svc = makeLawyerReviewService();
      const registry = new AgentRegistry();
      registry.register(
        new LawyerReviewAgent(
          svc as never,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          audit as never,
          logger as never,
        ),
      );
      const resolved = registry.lookup('review.score');
      expect(resolved?.card.agentId).toBe('lawyer-review');
    });
  });
});

void AGENT_ERROR_CODES;
