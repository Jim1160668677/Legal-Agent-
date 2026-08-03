/**
 * LawyerAnnotationService 单元测试（v2.3 阶段十，17 §6）。
 *
 * 覆盖：
 *   - 回流 4 目标：intent_eval_set / reasoning_chain / law_article / feedback
 *   - hasRelevantAnnotations 判定（无相关标注时跳过）
 *   - 去重策略（17 §6.4）
 *   - 回流完成后标记 lawyer_review.state=reflowed
 *   - annotation_reflowed 审计写入
 *   - Model 未注入时抛错
 *   - 部分目标失败不影响其他目标
 *
 * 设计依据：17 §6 律师标注回流；05 3.28/3.1/3.17 集合。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LawyerAnnotationService } from '../../src/modules/legal/review/lawyer-annotation.service';
import type {
  ReflowInput,
  LawyerReviewAnnotations,
} from '../../src/modules/legal/review/review.types';

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

function makeAnnotations(
  overrides: Partial<LawyerReviewAnnotations> = {},
): LawyerReviewAnnotations {
  return {
    scores: { accuracy: 2, completeness: 2, compliance: 2, usefulness: 2 },
    riskFlag: 'high',
    reviewedBy: 'lawyer-1',
    reviewedAt: new Date(),
    duration: 1000,
    textAnnotations: {
      citationErrors: [
        { lawRef: '民法典第143条', errorType: '引用错误', correction: '应为第144条' },
      ],
      factCorrections: [{ segment: '事实段', correction: '订正内容' }],
      reasoningFlaws: [{ step: 'Application', flaw: '要件匹配错误', suggestion: '应匹配要件2' }],
      generalComment: '存在多处问题',
    },
    ...overrides,
  };
}

function makeReflowInput(overrides: Partial<ReflowInput> = {}): ReflowInput {
  return {
    reviewId: 'lr-001',
    msgId: 'msg-1',
    userId: 'user-1',
    intent: 'case_reasoning',
    annotations: makeAnnotations(),
    ...overrides,
  };
}

/** mock Model：updateOne/findOne 返回带 .exec() 的链式对象，create 返回 Promise */
function chain(result: unknown) {
  return { exec: () => Promise.resolve(result) };
}
function makeModel(
  methods: Partial<{
    create: ReturnType<typeof vi.fn>;
    updateOne: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return {
    create: methods.create ?? vi.fn().mockResolvedValue({ _id: { toString: () => 'id-001' } }),
    updateOne: methods.updateOne ?? vi.fn().mockReturnValue(chain({ matchedCount: 1 })),
    findOne: methods.findOne ?? vi.fn().mockReturnValue(chain(null)),
  };
}

function makeLawyerReviewService() {
  return { markReflowed: vi.fn().mockResolvedValue({ reviewId: 'lr-001', state: 'reflowed' }) };
}

describe('LawyerAnnotationService（律师标注回流，17 §6）', () => {
  let audit: ReturnType<typeof makeAudit>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    audit = makeAudit();
    logger = makeLogger();
  });

  // ===== 回流 4 目标 =====

  describe('reflow 回流 4 目标', () => {
    it('case_reasoning + 推理缺陷 → 回流 intent_eval_set + reasoning_chain', async () => {
      const evalSetModel = makeModel();
      const reasoningChainModel = makeModel();
      const lawArticleModel = makeModel();
      const feedbackModel = makeModel();
      const lrs = makeLawyerReviewService();
      const svc = new LawyerAnnotationService(
        evalSetModel as never,
        reasoningChainModel as never,
        lawArticleModel as never,
        feedbackModel as never,
        lrs as never,
        audit as never,
        logger as never,
      );
      const input = makeReflowInput();
      const result = await svc.reflow(input, { reasoningChainId: 'rc-001' });

      // intent_eval_set 回流成功
      expect(evalSetModel.create).toHaveBeenCalled();
      // reasoning_chain 回流成功（标记 lawyerCorrected）
      expect(reasoningChainModel.updateOne).toHaveBeenCalledWith(
        { chainId: 'rc-001' },
        expect.objectContaining({
          $set: expect.objectContaining({ lawyerCorrected: true }),
        }),
      );
      // law_article 回流成功（citationErrors 非空）
      expect(lawArticleModel.updateOne).toHaveBeenCalled();
      // feedback 回流成功（generalComment 非空）
      expect(feedbackModel.create).toHaveBeenCalled();

      expect(result.successCount).toBe(4);
      expect(result.failedCount).toBe(0);
      expect(result.ok).toBe(true);
      // 标记 reflowed
      expect(lrs.markReflowed).toHaveBeenCalledWith('lr-001', expect.any(Array));
      // 审计
      expect(audit.write).toHaveBeenCalledWith(
        'annotation_reflowed',
        expect.objectContaining({
          reviewId: 'lr-001',
          target: 'intent_eval_set',
        }),
      );
    });

    it('无 reasoningChainId 时 reasoning_chain 目标跳过', async () => {
      const evalSetModel = makeModel();
      const lawArticleModel = makeModel();
      const feedbackModel = makeModel();
      const svc = new LawyerAnnotationService(
        evalSetModel as never,
        undefined,
        lawArticleModel as never,
        feedbackModel as never,
        makeLawyerReviewService() as never,
        audit as never,
        logger as never,
      );
      const result = await svc.reflow(makeReflowInput(), {}); // 无 reasoningChainId

      const targetResults = result.results;
      const rcResult = targetResults.find((r) => r.target === 'reasoning_chain');
      expect(rcResult?.skipped).toBe(true);
    });

    it('非 case_reasoning 意图 → intent_eval_set 跳过', async () => {
      const lawArticleModel = makeModel();
      const feedbackModel = makeModel();
      const svc = new LawyerAnnotationService(
        undefined,
        undefined,
        lawArticleModel as never,
        feedbackModel as never,
        makeLawyerReviewService() as never,
        audit as never,
        logger as never,
      );
      const result = await svc.reflow(makeReflowInput({ intent: 'general_qa' }), {
        reasoningChainId: 'rc-001',
      });
      const evalResult = result.results.find((r) => r.target === 'intent_eval_set');
      expect(evalResult?.skipped).toBe(true);
    });

    it('无 citationErrors → law_article 跳过', async () => {
      const evalSetModel = makeModel();
      const feedbackModel = makeModel();
      const svc = new LawyerAnnotationService(
        evalSetModel as never,
        undefined,
        undefined,
        feedbackModel as never,
        makeLawyerReviewService() as never,
        audit as never,
        logger as never,
      );
      const input = makeReflowInput({
        annotations: makeAnnotations({
          textAnnotations: {
            citationErrors: [],
            reasoningFlaws: [{ step: 's', flaw: 'f', suggestion: 'g' }],
          },
        }),
      });
      const result = await svc.reflow(input, { reasoningChainId: 'rc-001' });
      const lawResult = result.results.find((r) => r.target === 'law_article');
      expect(lawResult?.skipped).toBe(true);
    });

    it('部分目标失败不影响其他目标', async () => {
      const evalSetModel = makeModel({
        create: vi.fn().mockRejectedValue(new Error('DB 写入失败')),
      });
      const reasoningChainModel = makeModel();
      const lawArticleModel = makeModel();
      const feedbackModel = makeModel();
      const svc = new LawyerAnnotationService(
        evalSetModel as never,
        reasoningChainModel as never,
        lawArticleModel as never,
        feedbackModel as never,
        makeLawyerReviewService() as never,
        audit as never,
        logger as never,
      );
      const result = await svc.reflow(makeReflowInput(), { reasoningChainId: 'rc-001' });
      // intent_eval_set 失败，其余 3 个目标成功
      expect(result.failedCount).toBe(1);
      expect(result.successCount).toBe(3);
      expect(result.ok).toBe(false);
    });
  });

  // ===== 去重策略（17 §6.4）=====

  describe('去重策略', () => {
    it('intent_eval_set 按 reviewId 去重：已存在则返回已存在 ID', async () => {
      const existing = { _id: { toString: () => 'existing-id' } };
      const evalSetModel = makeModel({
        findOne: vi.fn().mockReturnValue(chain(existing)),
        create: vi.fn(),
      });
      const svc = new LawyerAnnotationService(
        evalSetModel as never,
        undefined,
        undefined,
        undefined,
        makeLawyerReviewService() as never,
        audit as never,
        logger as never,
      );
      const result = await svc.reflow(makeReflowInput(), { reasoningChainId: 'rc-001' });
      const evalResult = result.results.find((r) => r.target === 'intent_eval_set');
      expect(evalResult?.success).toBe(true);
      expect(evalResult?.targetId).toBe('existing-id');
      expect(evalSetModel.create).not.toHaveBeenCalled();
    });

    it('feedback 按 msgId 去重：已存在则追加处置结论', async () => {
      const existing = {
        _id: { toString: () => 'fb-id' },
        content: '原内容',
        status: 'open',
        assignee: undefined,
        save: vi.fn().mockResolvedValue(undefined),
      };
      const feedbackModel = makeModel({
        findOne: vi.fn().mockReturnValue(chain(existing)),
        create: vi.fn(),
      });
      const svc = new LawyerAnnotationService(
        undefined,
        undefined,
        undefined,
        feedbackModel as never,
        makeLawyerReviewService() as never,
        audit as never,
        logger as never,
      );
      const result = await svc.reflow(makeReflowInput(), { reasoningChainId: 'rc-001' });
      const fbResult = result.results.find((r) => r.target === 'feedback');
      expect(fbResult?.success).toBe(true);
      expect(fbResult?.targetId).toBe('fb-id');
      expect(existing.save).toHaveBeenCalled();
      expect(feedbackModel.create).not.toHaveBeenCalled();
    });
  });

  // ===== Model 未注入 =====

  describe('Model 未注入', () => {
    it('intent_eval_set Model 未注入 → 该目标失败', async () => {
      const svc = new LawyerAnnotationService(
        undefined,
        undefined,
        undefined,
        undefined,
        makeLawyerReviewService() as never,
        audit as never,
        logger as never,
      );
      const result = await svc.reflow(makeReflowInput(), { reasoningChainId: 'rc-001' });
      const evalResult = result.results.find((r) => r.target === 'intent_eval_set');
      expect(evalResult?.success).toBe(false);
      expect(evalResult?.error).toContain('IntentEvalSet Model 未注入');
    });

    it('reasoning_chain Model 未注入但有 reasoningChainId → 失败', async () => {
      const svc = new LawyerAnnotationService(
        undefined,
        undefined,
        undefined,
        undefined,
        makeLawyerReviewService() as never,
        audit as never,
        logger as never,
      );
      const result = await svc.reflow(makeReflowInput(), { reasoningChainId: 'rc-001' });
      const rcResult = result.results.find((r) => r.target === 'reasoning_chain');
      expect(rcResult?.success).toBe(false);
      expect(rcResult?.error).toContain('ReasoningChain Model 未注入');
    });
  });

  // ===== reasoning_chain 回流 =====

  describe('reasoning_chain 回流', () => {
    it('推理链不存在 → 失败', async () => {
      const reasoningChainModel = makeModel({
        updateOne: vi.fn().mockReturnValue(chain({ matchedCount: 0 })),
      });
      const svc = new LawyerAnnotationService(
        undefined,
        reasoningChainModel as never,
        undefined,
        undefined,
        makeLawyerReviewService() as never,
        audit as never,
        logger as never,
      );
      const result = await svc.reflow(makeReflowInput(), { reasoningChainId: 'rc-999' });
      const rcResult = result.results.find((r) => r.target === 'reasoning_chain');
      expect(rcResult?.success).toBe(false);
      expect(rcResult?.error).toContain('不存在');
    });

    it('律师修正说明包含所有 reasoningFlaws', async () => {
      const reasoningChainModel = makeModel();
      const svc = new LawyerAnnotationService(
        undefined,
        reasoningChainModel as never,
        undefined,
        undefined,
        makeLawyerReviewService() as never,
        audit as never,
        logger as never,
      );
      await svc.reflow(makeReflowInput(), { reasoningChainId: 'rc-001' });
      const callArgs = reasoningChainModel.updateOne.mock.calls[0][1];
      expect(callArgs.$set.lawyerCorrectionNote).toContain('Application');
      expect(callArgs.$set.lawyerCorrectionNote).toContain('要件匹配错误');
      expect(callArgs.$set.lawyerReviewId).toBe('lr-001');
    });
  });
});
