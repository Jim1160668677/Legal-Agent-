/**
 * LawyerReviewController 单元测试（v2.3 阶段十）。
 *
 * 覆盖：
 *   - 队列查询：GET /v1/reviews/queue / mine / :reviewId
 *   - 状态机操作：claim / start / submit / give-up / reflow
 *   - 溯源查询：GET /v1/answers/:msgId/trace
 *   - 合规复扫：POST /v1/reviews/:reviewId/compliance
 *   - 错误映射：REVIEW_NOT_FOUND → 404 / INVALID_TRANSITION → 400 / INVALID_SCORE → 400
 *
 * 设计依据：17 §2-§6；06-api-spec 律师审核端点。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { LawyerReviewController } from '../../src/modules/legal/review/lawyer-review.controller';
import { REVIEW_ERROR_CODES } from '../../src/modules/legal/review/review.constants';

// ===== Mock 服务工厂 =====

function makeReviewService() {
  return {
    getQueue: vi
      .fn()
      .mockResolvedValue([{ reviewId: 'lr_1', msgId: 'm1', state: 'pending', riskLevel: 'high' }]),
    getMyReviews: vi
      .fn()
      .mockResolvedValue([
        { reviewId: 'lr_2', msgId: 'm2', state: 'reviewing', claimedBy: 'lawyer-1' },
      ]),
    getReview: vi.fn(),
    claim: vi.fn(),
    startReview: vi.fn(),
    submit: vi.fn(),
    giveUp: vi.fn(),
  };
}

function makeTracer() {
  return {
    getTrace: vi.fn(),
    computeCitationFailureRate: vi.fn().mockReturnValue(0),
  };
}

function makeQualityScorer() {
  return {
    computeLawyerScore: vi.fn().mockReturnValue({ lawyerScore: 4.0, grade: 'excellent' }),
  };
}

function makeComplianceMonitor() {
  return {
    scan: vi.fn().mockResolvedValue({ level: 'pass', blocked: false, triggers: [] }),
    scanAfterLawyerReview: vi
      .fn()
      .mockResolvedValue({ level: 'pass', blocked: false, triggers: [] }),
  };
}

function makeAnnotationService() {
  return {
    reflow: vi.fn().mockResolvedValue({
      results: [],
      successCount: 0,
      skippedCount: 4,
      failedCount: 0,
      ok: true,
    }),
  };
}

function makeUser(): { sub: string; role: string } {
  return { sub: 'lawyer-1', role: 'ops' };
}

/** 构造带 code 属性的 Error（模拟 service 抛出的业务错误） */
function makeServiceError(code: number, message: string): Error {
  const err = new Error(message);
  (err as Error & { code?: number }).code = code;
  return err;
}

describe('LawyerReviewController（律师审核后台 REST 端点）', () => {
  let reviewService: ReturnType<typeof makeReviewService>;
  let tracer: ReturnType<typeof makeTracer>;
  let qualityScorer: ReturnType<typeof makeQualityScorer>;
  let complianceMonitor: ReturnType<typeof makeComplianceMonitor>;
  let annotationService: ReturnType<typeof makeAnnotationService>;
  let controller: LawyerReviewController;
  const user = makeUser();

  beforeEach(() => {
    reviewService = makeReviewService();
    tracer = makeTracer();
    qualityScorer = makeQualityScorer();
    complianceMonitor = makeComplianceMonitor();
    annotationService = makeAnnotationService();
    controller = new LawyerReviewController(
      reviewService as never,
      tracer as never,
      qualityScorer as never,
      complianceMonitor as never,
      annotationService as never,
    );
  });

  // ===== 队列与详情 =====

  describe('GET /v1/reviews/queue', () => {
    it('返回待审队列', async () => {
      const result = await controller.getQueue();
      expect(reviewService.getQueue).toHaveBeenCalledWith(20);
      expect(result).toHaveLength(1);
      expect(result[0].reviewId).toBe('lr_1');
    });

    it('limit 参数解析（clamp 1-100）', async () => {
      await controller.getQueue('5');
      expect(reviewService.getQueue).toHaveBeenCalledWith(5);
      await controller.getQueue('999');
      expect(reviewService.getQueue).toHaveBeenLastCalledWith(100);
      await controller.getQueue('0');
      // parseInt('0')||20 = 20（0 falsy 回退默认值）
      expect(reviewService.getQueue).toHaveBeenLastCalledWith(20);
    });
  });

  describe('GET /v1/reviews/mine', () => {
    it('返回当前律师的审核', async () => {
      const result = await controller.getMine(user);
      expect(reviewService.getMyReviews).toHaveBeenCalledWith('lawyer-1', 20);
      expect(result).toHaveLength(1);
    });
  });

  describe('GET /v1/reviews/:reviewId', () => {
    it('审核存在 → 返回详情', async () => {
      reviewService.getReview.mockResolvedValue({ reviewId: 'lr_1', state: 'pending' });
      const result = await controller.getReview('lr_1');
      expect(result.reviewId).toBe('lr_1');
    });

    it('审核不存在 → 404 NotFoundException', async () => {
      reviewService.getReview.mockResolvedValue(null);
      await expect(controller.getReview('lr_xxx')).rejects.toThrow(NotFoundException);
    });
  });

  // ===== 状态机操作 =====

  describe('POST /v1/reviews/:reviewId/claim', () => {
    it('领取成功 → 返回 claimed 状态', async () => {
      reviewService.claim.mockResolvedValue({ reviewId: 'lr_1', state: 'claimed' });
      const result = await controller.claim('lr_1', user);
      expect(reviewService.claim).toHaveBeenCalledWith('lr_1', 'lawyer-1');
      expect(result.state).toBe('claimed');
    });

    it('审核不存在 → 404', async () => {
      reviewService.claim.mockRejectedValue(
        makeServiceError(REVIEW_ERROR_CODES.REVIEW_NOT_FOUND, '审核不存在'),
      );
      await expect(controller.claim('lr_xxx', user)).rejects.toThrow(NotFoundException);
    });

    it('非法状态流转 → 400', async () => {
      reviewService.claim.mockRejectedValue(
        makeServiceError(REVIEW_ERROR_CODES.INVALID_TRANSITION, 'pending→claimed 非法'),
      );
      await expect(controller.claim('lr_1', user)).rejects.toThrow(BadRequestException);
    });
  });

  describe('POST /v1/reviews/:reviewId/start', () => {
    it('开始标注成功 → reviewing', async () => {
      reviewService.startReview.mockResolvedValue({ reviewId: 'lr_1', state: 'reviewing' });
      const result = await controller.start('lr_1', user);
      expect(result.state).toBe('reviewing');
    });

    it('非领取人越权 → 400', async () => {
      reviewService.startReview.mockRejectedValue(
        makeServiceError(REVIEW_ERROR_CODES.INVALID_TRANSITION, '无权标注'),
      );
      await expect(controller.start('lr_1', user)).rejects.toThrow(BadRequestException);
    });
  });

  describe('POST /v1/reviews/:reviewId/submit', () => {
    const dto = {
      scores: { accuracy: 4, completeness: 4, compliance: 5, usefulness: 4 },
      riskFlag: 'none' as const,
    };

    it('提交成功 → 返回 review + lawyerScore + compliance', async () => {
      reviewService.submit.mockResolvedValue({
        reviewId: 'lr_1',
        msgId: 'm1',
        userId: 'u1',
        intent: 'legal_qa',
        state: 'submitted',
        annotations: { scores: dto.scores, riskFlag: 'none' },
      });
      const result = await controller.submit('lr_1', dto, user);
      expect(result.review.state).toBe('submitted');
      expect(result.lawyerScore.lawyerScore).toBe(4.0);
      expect(result.compliance.level).toBe('pass');
      expect(complianceMonitor.scanAfterLawyerReview).toHaveBeenCalled();
    });

    it('非法评分 → 400 BadRequestException', async () => {
      reviewService.submit.mockRejectedValue(
        makeServiceError(REVIEW_ERROR_CODES.INVALID_SCORE, 'accuracy=6 非法'),
      );
      await expect(controller.submit('lr_1', dto, user)).rejects.toThrow(BadRequestException);
    });
  });

  describe('POST /v1/reviews/:reviewId/give-up', () => {
    it('放弃成功 → pending', async () => {
      reviewService.giveUp.mockResolvedValue({ reviewId: 'lr_1', state: 'pending' });
      const result = await controller.giveUp('lr_1', user);
      expect(result.state).toBe('pending');
    });
  });

  describe('POST /v1/reviews/:reviewId/reflow', () => {
    it('回流成功 → 返回 ReflowResult', async () => {
      reviewService.getReview.mockResolvedValue({
        reviewId: 'lr_1',
        msgId: 'm1',
        userId: 'u1',
        intent: 'legal_qa',
        state: 'submitted',
        annotations: {
          scores: { accuracy: 2, completeness: 2, compliance: 3, usefulness: 2 },
          riskFlag: 'high',
        },
      });
      const result = await controller.reflow('lr_1', {});
      expect(annotationService.reflow).toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });

    it('非 submitted 状态 → 400', async () => {
      reviewService.getReview.mockResolvedValue({
        reviewId: 'lr_1',
        state: 'reviewing',
        annotations: { scores: { accuracy: 2, completeness: 2, compliance: 3, usefulness: 2 } },
      });
      await expect(controller.reflow('lr_1', {})).rejects.toThrow(BadRequestException);
    });

    it('审核不存在 → 404', async () => {
      reviewService.getReview.mockResolvedValue(null);
      await expect(controller.reflow('lr_xxx', {})).rejects.toThrow(NotFoundException);
    });

    it('无标注数据 → 400', async () => {
      reviewService.getReview.mockResolvedValue({
        reviewId: 'lr_1',
        state: 'submitted',
        annotations: undefined,
      });
      await expect(controller.reflow('lr_1', {})).rejects.toThrow(BadRequestException);
    });

    it('未传 reasoningChainId → 从 trace 获取', async () => {
      reviewService.getReview.mockResolvedValue({
        reviewId: 'lr_1',
        msgId: 'm1',
        userId: 'u1',
        intent: 'case_reasoning',
        state: 'submitted',
        annotations: {
          scores: { accuracy: 2, completeness: 2, compliance: 3, usefulness: 2 },
          riskFlag: 'high',
        },
      });
      tracer.getTrace.mockResolvedValue({ reasoningChainId: 'rc_001', citedLaws: [] });
      await controller.reflow('lr_1', {});
      const callArgs = annotationService.reflow.mock.calls[0][1];
      expect(callArgs.reasoningChainId).toBe('rc_001');
    });
  });

  // ===== 溯源与合规 =====

  describe('GET /v1/answers/:msgId/trace', () => {
    it('溯源存在 → 返回 trace', async () => {
      tracer.getTrace.mockResolvedValue({ msgId: 'm1', autoScore: 4.5, citedLaws: [] });
      const result = await controller.getTrace('m1');
      expect(result.msgId).toBe('m1');
    });

    it('溯源不存在 → 404', async () => {
      tracer.getTrace.mockResolvedValue(null);
      await expect(controller.getTrace('m_xxx')).rejects.toThrow(NotFoundException);
    });
  });

  describe('POST /v1/reviews/:reviewId/compliance', () => {
    it('合规复扫 → 返回 scan 结果', async () => {
      reviewService.getReview.mockResolvedValue({
        reviewId: 'lr_1',
        msgId: 'm1',
        userId: 'u1',
        annotations: { riskFlag: 'none' },
      });
      tracer.getTrace.mockResolvedValue({ citedLaws: [{ ref: 'A', verified: true }] });
      const result = await controller.complianceScan('lr_1', {});
      expect(complianceMonitor.scan).toHaveBeenCalled();
      expect(result.level).toBe('pass');
    });

    it('审核不存在 → 404', async () => {
      reviewService.getReview.mockResolvedValue(null);
      await expect(controller.complianceScan('lr_xxx', {})).rejects.toThrow(NotFoundException);
    });
  });
});
