/**
 * PrePublishReviewService 单元测试（v3.0 新增）。
 *
 * 覆盖：
 *   - 创建审核任务（ID 生成、优先级计算、默认状态）
 *   - 批量创建（单条失败不影响其他）
 *   - 律师领取（pending → claimed，非 pending 不可领）
 *   - claimNextForLawyer（优先级排序 + 过滤）
 *   - 状态机流转（startReview / submitAndApprove / submitAndReject）
 *   - 非法状态流转抛错
 *   - 队列查询 / 律师历史 / 待处理计数
 *   - 超时处理（pending 超时升级、claimed 超时升级）
 *   - 统计聚合
 *   - Model 未注入时抛错 / 内存兜底
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrePublishReviewService } from '../../src/modules/legal/review/pre-publish-review.service';
import type { CreateReviewInput } from '../../src/modules/legal/review/pre-publish-review.service';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
}

function makeOpinion(overrides: Partial<{ confidence: number; riskLevel: string; lawRefs: string[] }> = {}) {
  return {
    summary: 'AI 摘要',
    analysis: 'AI 分析',
    lawRefs: ['民法典第143条'],
    confidence: 0.6,
    riskLevel: 'medium',
    ...overrides,
  };
}

function makeInput(overrides: Partial<CreateReviewInput> = {}): CreateReviewInput {
  return {
    msgId: 'msg-1',
    userId: 'user-1',
    intent: 'case_reasoning',
    aiOpinion: makeOpinion(),
    ...overrides,
  };
}

function makeModifications() {
  return [
    {
      type: 'edit' as const,
      fieldPath: 'summary',
      originalContent: 'AI 摘要',
      modifiedContent: '律师修订摘要',
      appliedExpertiseIds: ['le-1'],
    },
  ];
}

function makeSupplements() {
  return [
    {
      supplementType: 'risk_warning',
      content: '需注意诉讼时效风险',
      lawRefs: ['民法典第188条'],
      expertiseIds: ['le-2'],
    },
  ];
}

function makeModel() {
  const doc = {
    reviewId: 'ppr_123',
    msgId: 'msg-1',
    userId: 'user-1',
    intent: 'case_reasoning',
    aiOpinion: makeOpinion(),
    state: 'pending',
    priority: 4,
    escalated: false,
    claimedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    modifications: [] as unknown[],
    supplements: [] as unknown[],
    reviewDuration: 0,
  };

  const model = {
    create: vi.fn().mockImplementation(async (d) => ({ ...d, reviewId: d.reviewId })),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    find: vi.fn(),
    countDocuments: vi.fn(),
    updateMany: vi.fn(),
    aggregate: vi.fn(),
  };

  const chain = (result: unknown) => ({ exec: () => Promise.resolve(result) });

  return {
    model,
    chain,
    doc,
    makeChainableFind: (result: unknown) => {
      const q = {
        sort: () => q,
        limit: () => Promise.resolve(result),
        exec: () => Promise.resolve(result),
      };
      return q;
    },
  };
}

describe('PrePublishReviewService（v3.0 预发布审核工作流）', () => {
  let service: PrePublishReviewService;
  let m: ReturnType<typeof makeModel>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    m = makeModel();
    logger = makeLogger();
    service = new PrePublishReviewService(m.model as never, undefined, logger as never);
  });

  // ===== 创建审核任务 =====

  it('创建审核任务：生成 reviewId + 默认 pending 状态', async () => {
    const created = await service.createReview(makeInput());

    expect(created.reviewId).toMatch(/^ppr_/);
    expect(created.state).toBe('pending');
    expect(created.triggerSource).toBe('auto');
    expect(created.priority).toBeGreaterThanOrEqual(1);
    expect(created.priority).toBeLessThanOrEqual(5);
  });

  it('计算优先级：高风险 + 低置信度 → 最高优先级', async () => {
    const created = await service.createReview(
      makeInput({ aiOpinion: makeOpinion({ confidence: 0.4, riskLevel: 'high' }) }),
    );

    expect(created.priority).toBe(5);
  });

  it('计算优先级：低风险 + 高置信度 → 低优先级', async () => {
    const created = await service.createReview(
      makeInput({ aiOpinion: makeOpinion({ confidence: 0.9, riskLevel: 'low' }) }),
    );

    expect(created.priority).toBe(1);
  });

  it('创建任务时记录审计日志', async () => {
    await service.createReview(makeInput());
    expect(logger.info).toHaveBeenCalled();
  });

  // ===== 批量创建 =====

  it('批量创建：单条失败不影响其他', async () => {
    m.model.create
      .mockRejectedValueOnce(new Error('dup'))
      .mockImplementationOnce(async (d) => ({ ...d }));
    const inputs = [makeInput({ msgId: 'm1' }), makeInput({ msgId: 'm2' })];

    const results = await service.batchCreateReviews(inputs);

    expect(results.length).toBe(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  // ===== 领取审核 =====

  it('领取任务：pending → claimed', async () => {
    const claimedDoc = { ...m.doc, state: 'claimed', claimedBy: 'lawyer-1' };
    m.model.findOneAndUpdate.mockImplementation(async () => claimedDoc);

    const result = await service.claimReview({ reviewId: 'ppr_123', lawyerId: 'lawyer-1' });

    expect(result?.state).toBe('claimed');
    expect(result?.claimedBy).toBe('lawyer-1');
    expect(m.model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ reviewId: 'ppr_123', state: 'pending' }),
      expect.any(Object),
      expect.objectContaining({ new: true }),
    );
  });

  it('领取不存在的任务返回 null', async () => {
    m.model.findOneAndUpdate.mockResolvedValue(null);
    const result = await service.claimReview({ reviewId: 'nope', lawyerId: 'lawyer-1' });
    expect(result).toBeNull();
  });

  // ===== claimNextForLawyer =====

  it('claimNextForLawyer：无待办返回 null', async () => {
    m.model.findOne.mockReturnValue({ sort: () => Promise.resolve(null) });
    const result = await service.claimNextForLawyer('lawyer-1');
    expect(result).toBeNull();
  });

  it('claimNextForLawyer：找到任务并领取', async () => {
    m.model.findOne.mockReturnValue({ sort: () => Promise.resolve({ reviewId: 'ppr_123', state: 'pending' }) });
    m.model.findOneAndUpdate.mockResolvedValue({ reviewId: 'ppr_123', state: 'claimed' });

    const result = await service.claimNextForLawyer('lawyer-1', { priority: 3 });

    expect(m.model.findOne).toHaveBeenCalledWith(expect.objectContaining({ state: 'pending', priority: { $gte: 3 } }));
    expect(result?.state).toBe('claimed');
  });

  // ===== 状态机 =====

  it('startReview：claimed → reviewing（仅领取律师）', async () => {
    m.model.findOneAndUpdate.mockResolvedValue({ state: 'reviewing' });
    const result = await service.startReview('ppr_123', 'lawyer-1');
    expect(result?.state).toBe('reviewing');
    expect(m.model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ claimedBy: 'lawyer-1', state: 'claimed' }),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('submitAndApprove：构建最终意见并计算耗时', async () => {
    m.model.findOne.mockResolvedValue({
      ...m.doc,
      state: 'reviewing',
      claimedAt: new Date(Date.now() - 5000),
    });
    m.model.findOneAndUpdate.mockImplementation(async (_f, upd) => ({ ...m.doc, ...upd.$set }));

    const result = await service.submitAndApprove({
      reviewId: 'ppr_123',
      lawyerId: 'lawyer-1',
      modifications: makeModifications(),
      supplements: makeSupplements(),
    });

    expect(result.status).toBe('approved');
    expect(result.finalOpinion.summary).toBe('律师修订摘要');
    expect(result.finalOpinion.lawRefs).toContain('民法典第188条');
    expect(result.finalOpinion.confidence).toBeGreaterThan(0.6);
    expect(result.reviewDuration).toBeGreaterThan(0);
  });

  it('submitAndReject：状态为 rejected', async () => {
    m.model.findOne.mockResolvedValue({ ...m.doc, state: 'reviewing' });
    m.model.findOneAndUpdate.mockImplementation(async (_f, upd) => ({ ...m.doc, ...upd.$set }));

    const result = await service.submitAndReject({
      reviewId: 'ppr_123',
      lawyerId: 'lawyer-1',
      modifications: [],
      supplements: [],
    });

    expect(result.status).toBe('rejected');
  });

  it('非法状态流转抛错：pending 直接 approve', async () => {
    m.model.findOne.mockResolvedValue({ ...m.doc, state: 'pending' });

    await expect(
      service.submitAndApprove({
        reviewId: 'ppr_123',
        lawyerId: 'lawyer-1',
        modifications: [],
        supplements: [],
      }),
    ).rejects.toThrow(/状态流转不允许/);
  });

  it('审核任务不存在抛错', async () => {
    m.model.findOne.mockResolvedValue(null);
    await expect(
      service.submitAndApprove({
        reviewId: 'nope',
        lawyerId: 'lawyer-1',
        modifications: [],
        supplements: [],
      }),
    ).rejects.toThrow(/审核任务不存在/);
  });

  // ===== 查询接口 =====

  it('getQueue：按状态过滤 + 排序 + 分页', async () => {
    m.model.find.mockReturnValue(m.makeChainableFind([m.doc]));
    const result = await service.getQueue({ states: ['pending'], limit: 10 });
    expect(result.length).toBe(1);
    expect(m.model.find).toHaveBeenCalledWith(expect.objectContaining({ state: { $in: ['pending'] } }));
  });

  it('getQueue：含 lawyerId 时使用 $or 查询', async () => {
    m.model.find.mockReturnValue(m.makeChainableFind([]));
    await service.getQueue({ lawyerId: 'lawyer-1' });
    expect(m.model.find).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: [
          { state: 'pending' },
          { state: { $in: ['claimed', 'reviewing'] }, claimedBy: 'lawyer-1' },
        ],
      }),
    );
  });

  it('getLawyerHistory：只查已完成状态', async () => {
    m.model.find.mockReturnValue(m.makeChainableFind([m.doc]));
    await service.getLawyerHistory('lawyer-1');
    expect(m.model.find).toHaveBeenCalledWith(
      expect.objectContaining({
        claimedBy: 'lawyer-1',
        state: { $in: ['approved', 'rejected'] },
      }),
    );
  });

  it('getPendingCount：统计待处理数量', async () => {
    m.model.countDocuments.mockResolvedValue(5);
    const count = await service.getPendingCount();
    expect(count).toBe(5);
  });

  // ===== 超时处理 =====

  it('processTimeouts：pending 超时升级 + claimed/reviewing 超时升级', async () => {
    m.model.updateMany.mockResolvedValue({ modifiedCount: 2 });

    const result = await service.processTimeouts(1000);

    expect(result.timedOut).toBe(2);
    expect(result.escalated).toBe(2);
    expect(m.model.updateMany).toHaveBeenCalledTimes(2);
  });

  // ===== 统计 =====

  it('getStats：聚合结果映射', async () => {
    m.model.aggregate.mockResolvedValue([
      {
        total: 10,
        approved: 6,
        rejected: 2,
        pending: 2,
        avgDuration: 120000,
        totalMods: 3,
      },
    ]);

    const stats = await service.getStats();

    expect(stats.total).toBe(10);
    expect(stats.approved).toBe(6);
    expect(stats.rejected).toBe(2);
    expect(stats.pending).toBe(2);
    expect(stats.averageDuration).toBe(120000);
    expect(stats.modificationsApplied).toBe(3);
  });

  it('getStats：无数据返回全零', async () => {
    m.model.aggregate.mockResolvedValue([]);
    const stats = await service.getStats();
    expect(stats.total).toBe(0);
    expect(stats.averageDuration).toBe(0);
  });

  // ===== Model 未注入 =====

  it('Model 未注入时 createReview 抛错', async () => {
    const noModel = new PrePublishReviewService(undefined, undefined, logger as never);
    await expect(noModel.createReview(makeInput())).rejects.toThrow(/未注入/);
  });

  it('Model 未注入时 getPendingCount 返回 0（内存兜底）', async () => {
    const noModel = new PrePublishReviewService(undefined, undefined, logger as never);
    const count = await noModel.getPendingCount();
    expect(count).toBe(0);
  });
});
