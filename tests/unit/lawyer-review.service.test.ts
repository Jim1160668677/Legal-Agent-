/**
 * LawyerReviewService 单元测试（v2.3 阶段十，17 §2）。
 *
 * 覆盖：
 *   - 抽样策略：高风险 100% / 用户标记 100% / 普通 5%（mock Math.random）
 *   - 状态机流转：pending → claimed → reviewing → submitted → reflowed
 *   - 非法状态流转抛错（如 pending 直接 submit）
 *   - 律师领取人校验（非领取人不能 startReview/submit）
 *   - 四维评分合法性校验（1-5 数值，越界抛错）
 *   - give_up 释放回 pending
 *   - markReflowed 标记回流完成
 *   - 队列查询 / 我的审核查询
 *   - 内存兜底（无 DB Model 时仍可用）
 *
 * 设计依据：17 §2 律师审核工作流；05 3.33 lawyer_review。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LawyerReviewService } from '../../src/modules/legal/review/lawyer-review.service';
import type { LawyerReviewAnnotations } from '../../src/modules/legal/review/review.types';

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

function makeScores(
  overrides: Partial<LawyerReviewAnnotations['scores']> = {},
): LawyerReviewAnnotations['scores'] {
  return {
    accuracy: 4,
    completeness: 4,
    compliance: 5,
    usefulness: 4,
    ...overrides,
  };
}

function makeAnnotations(
  overrides: Partial<LawyerReviewAnnotations> = {},
): LawyerReviewAnnotations {
  return {
    scores: makeScores(),
    riskFlag: 'none',
    reviewedBy: 'lawyer-1',
    reviewedAt: new Date(),
    duration: 120000,
    ...overrides,
  };
}

describe('LawyerReviewService（律师审核工作流，17 §2）', () => {
  let service: LawyerReviewService;
  let audit: ReturnType<typeof makeAudit>;
  let logger: ReturnType<typeof makeLogger>;
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    audit = makeAudit();
    logger = makeLogger();
    // 无 DB Model，使用内存兜底
    service = new LawyerReviewService(undefined, audit as never, logger as never);
    // 默认 Math.random 返回 0.5（普通意图不命中 5% 抽样）
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  // ===== 抽样策略（17 §2.3）=====

  describe('sample 抽样策略', () => {
    it('高风险意图（case_reasoning）100% 入审', async () => {
      const result = await service.sample({
        msgId: 'msg-1',
        userId: 'user-1',
        intent: 'case_reasoning',
      });
      expect(result.sampled).toBe(true);
      expect(result.riskLevel).toBe('high');
      expect(result.reviewId).toMatch(/^lr_/);
    });

    it('高风险意图（document_generate）100% 入审', async () => {
      const result = await service.sample({
        msgId: 'msg-2',
        userId: 'user-1',
        intent: 'document_generate',
      });
      expect(result.sampled).toBe(true);
      expect(result.riskLevel).toBe('high');
    });

    it('用户标记反馈 100% 入审', async () => {
      const result = await service.sample({
        msgId: 'msg-3',
        userId: 'user-1',
        intent: 'general_qa',
        userFlagged: true,
      });
      expect(result.sampled).toBe(true);
      expect(result.riskLevel).toBe('user_flagged');
    });

    it('普通意图 Math.random() >= 0.05 不入审', async () => {
      randomSpy.mockReturnValue(0.5);
      const result = await service.sample({
        msgId: 'msg-4',
        userId: 'user-1',
        intent: 'general_qa',
      });
      expect(result.sampled).toBe(false);
      // 未命中抽样时仍返回 riskLevel（17 §2.3 抽样来源标记，便于分析）
      expect(result.riskLevel).toBe('normal');
    });

    it('普通意图 Math.random() < 0.05 命中 5% 抽样', async () => {
      randomSpy.mockReturnValue(0.02);
      const result = await service.sample({
        msgId: 'msg-5',
        userId: 'user-1',
        intent: 'general_qa',
      });
      expect(result.sampled).toBe(true);
      expect(result.riskLevel).toBe('normal');
    });
  });

  // ===== 状态机流转（17 §2.2）=====

  describe('状态机流转', () => {
    it('完整流程：pending → claimed → reviewing → submitted → reflowed', async () => {
      const { reviewId } = await service.sample({
        msgId: 'msg-flow-1',
        userId: 'user-1',
        intent: 'case_reasoning',
      });

      // claim
      let review = await service.claim(reviewId!, 'lawyer-1');
      expect(review?.state).toBe('claimed');
      expect(review?.claimedBy).toBe('lawyer-1');

      // startReview
      review = await service.startReview(reviewId!, 'lawyer-1');
      expect(review?.state).toBe('reviewing');

      // submit
      review = await service.submit(reviewId!, makeAnnotations());
      expect(review?.state).toBe('submitted');
      expect(review?.annotations?.scores.accuracy).toBe(4);
      // 提交时写审计
      expect(audit.write).toHaveBeenCalledWith(
        'lawyer_review_submit',
        expect.objectContaining({
          reviewId,
          lawyerId: 'lawyer-1',
          msgId: 'msg-flow-1',
        }),
      );

      // markReflowed
      review = await service.markReflowed(reviewId!, ['intent_eval_set', 'reasoning_chain']);
      expect(review?.state).toBe('reflowed');
      expect(review?.reflowTargets).toEqual(['intent_eval_set', 'reasoning_chain']);
    });

    it('非法流转：pending 直接 submit 抛 INVALID_TRANSITION', async () => {
      const { reviewId } = await service.sample({
        msgId: 'msg-illegal-1',
        userId: 'user-1',
        intent: 'case_reasoning',
      });
      await expect(service.submit(reviewId!, makeAnnotations())).rejects.toThrow(/非法状态流转/);
    });

    it('非法流转：claimed 直接 submit 抛错（需先 reviewing）', async () => {
      const { reviewId } = await service.sample({
        msgId: 'msg-illegal-2',
        userId: 'user-1',
        intent: 'case_reasoning',
      });
      await service.claim(reviewId!, 'lawyer-1');
      await expect(service.submit(reviewId!, makeAnnotations())).rejects.toThrow(/非法状态流转/);
    });

    it('非领取人不能 startReview', async () => {
      const { reviewId } = await service.sample({
        msgId: 'msg-perm-1',
        userId: 'user-1',
        intent: 'case_reasoning',
      });
      await service.claim(reviewId!, 'lawyer-1');
      await expect(service.startReview(reviewId!, 'lawyer-2')).rejects.toThrow(
        /已被 lawyer-1 领取/,
      );
    });

    it('give_up 释放回 pending（claimed → pending）', async () => {
      const { reviewId } = await service.sample({
        msgId: 'msg-giveup-1',
        userId: 'user-1',
        intent: 'case_reasoning',
      });
      await service.claim(reviewId!, 'lawyer-1');
      const review = await service.giveUp(reviewId!, 'lawyer-1');
      expect(review?.state).toBe('pending');
      expect(review?.claimedBy).toBeUndefined();
      expect(review?.claimedAt).toBeUndefined();
    });

    it('非领取人不能 giveUp', async () => {
      const { reviewId } = await service.sample({
        msgId: 'msg-giveup-2',
        userId: 'user-1',
        intent: 'case_reasoning',
      });
      await service.claim(reviewId!, 'lawyer-1');
      await expect(service.giveUp(reviewId!, 'lawyer-2')).rejects.toThrow(/无权放弃/);
    });

    it('审核不存在时 claim 抛 REVIEW_NOT_FOUND', async () => {
      await expect(service.claim('lr_nonexistent', 'lawyer-1')).rejects.toThrow(/不存在/);
    });
  });

  // ===== 四维评分校验（17 §2.4）=====

  describe('四维评分合法性', () => {
    it('评分 < 1 抛 INVALID_SCORE', async () => {
      const { reviewId } = await service.sample({
        msgId: 'msg-score-1',
        userId: 'user-1',
        intent: 'case_reasoning',
      });
      await service.claim(reviewId!, 'lawyer-1');
      await service.startReview(reviewId!, 'lawyer-1');
      await expect(
        service.submit(reviewId!, makeAnnotations({ scores: makeScores({ accuracy: 0 }) })),
      ).rejects.toThrow(/评分维度 accuracy 非法/);
    });

    it('评分 > 5 抛 INVALID_SCORE', async () => {
      const { reviewId } = await service.sample({
        msgId: 'msg-score-2',
        userId: 'user-1',
        intent: 'case_reasoning',
      });
      await service.claim(reviewId!, 'lawyer-1');
      await service.startReview(reviewId!, 'lawyer-1');
      await expect(
        service.submit(reviewId!, makeAnnotations({ scores: makeScores({ completeness: 6 }) })),
      ).rejects.toThrow(/评分维度 completeness 非法/);
    });

    it('评分非数字抛错', async () => {
      const { reviewId } = await service.sample({
        msgId: 'msg-score-3',
        userId: 'user-1',
        intent: 'case_reasoning',
      });
      await service.claim(reviewId!, 'lawyer-1');
      await service.startReview(reviewId!, 'lawyer-1');
      await expect(
        service.submit(reviewId!, makeAnnotations({ scores: makeScores({ compliance: NaN }) })),
      ).rejects.toThrow(/评分维度 compliance 非法/);
    });
  });

  // ===== 查询 =====

  describe('查询', () => {
    it('getQueue 返回待审队列（高风险优先）', async () => {
      // 普通意图入审
      randomSpy.mockReturnValue(0.01);
      await service.sample({ msgId: 'msg-q-1', userId: 'user-1', intent: 'general_qa' });
      // 高风险入审
      await service.sample({ msgId: 'msg-q-2', userId: 'user-1', intent: 'case_reasoning' });

      const queue = await service.getQueue(10);
      expect(queue.length).toBe(2);
      // 高风险排在前面
      expect(queue[0].riskLevel).toBe('high');
      expect(queue[1].riskLevel).toBe('normal');
    });

    it('getMyReviews 返回律师领取的审核', async () => {
      const { reviewId } = await service.sample({
        msgId: 'msg-mine-1',
        userId: 'user-1',
        intent: 'case_reasoning',
      });
      await service.claim(reviewId!, 'lawyer-1');

      const reviews = await service.getMyReviews('lawyer-1');
      expect(reviews.length).toBe(1);
      expect(reviews[0].reviewId).toBe(reviewId);
    });

    it('getReview 返回审核详情', async () => {
      const { reviewId } = await service.sample({
        msgId: 'msg-detail-1',
        userId: 'user-1',
        intent: 'case_reasoning',
      });
      const review = await service.getReview(reviewId!);
      expect(review?.reviewId).toBe(reviewId);
      expect(review?.state).toBe('pending');
      expect(review?.intent).toBe('case_reasoning');
    });

    it('getReview 不存在返回 null', async () => {
      const review = await service.getReview('lr_nonexistent');
      expect(review).toBeNull();
    });
  });

  // ===== 超时巡检（17 §2.2）=====

  describe('sweepTimeouts 超时巡检', () => {
    it('pending 超 72h 重新入队（刷新 sampledAt）', async () => {
      const { reviewId } = await service.sample({
        msgId: 'msg-timeout-1',
        userId: 'user-1',
        intent: 'case_reasoning',
      });
      // 手动将 updatedAt 设为 73h 前
      const review = await service.getReview(reviewId!);
      if (review) {
        review.updatedAt = new Date(Date.now() - 73 * 3600 * 1000);
      }
      const result = await service.sweepTimeouts();
      expect(result.requeued).toBe(1);
    });

    it('claimed 超 48h 释放回 pending', async () => {
      const { reviewId } = await service.sample({
        msgId: 'msg-timeout-2',
        userId: 'user-1',
        intent: 'case_reasoning',
      });
      await service.claim(reviewId!, 'lawyer-1');
      const review = await service.getReview(reviewId!);
      if (review) {
        review.updatedAt = new Date(Date.now() - 49 * 3600 * 1000);
      }
      const result = await service.sweepTimeouts();
      expect(result.released).toBe(1);
      const after = await service.getReview(reviewId!);
      expect(after?.state).toBe('pending');
      expect(after?.claimedBy).toBeUndefined();
    });
  });

  // ===== 内存兜底 =====

  it('无 DB Model 时使用内存兜底，全流程可用', async () => {
    const svc = new LawyerReviewService(undefined, audit as never, logger as never);
    const { reviewId } = await svc.sample({
      msgId: 'msg-mem-1',
      userId: 'user-1',
      intent: 'case_reasoning',
    });
    expect(reviewId).toBeDefined();
    const claimed = await svc.claim(reviewId!, 'lawyer-1');
    expect(claimed?.state).toBe('claimed');
  });
});
