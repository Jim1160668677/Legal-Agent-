/**
 * AnswerTracer 单元测试（v2.3 阶段十，17 §4）。
 *
 * 覆盖：
 *   - record：写 answer_traceability（upsert + $set）+ 返回 TraceRecord
 *   - record：Model 未注入 → 仅本地返回，不抛错
 *   - record：Model 写入失败 → 不阻塞 + logger.error
 *   - getTrace：命中返回 / 未命中返回 null / 查询失败返回 null + warn
 *   - bindLawyerReview：回填 lawyerReviewId
 *   - listByUser：分页排序按用户查询 / 失败返回空数组
 *   - computeCitationFailureRate：法条引用失败率（0 / 部分 / 无引用）
 *
 * 设计依据：17 §4 AI 回答溯源；05 3.34 answer_traceability 集合。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnswerTracer } from '../../src/modules/legal/review/answer-tracer.service';
import type { TraceRecordInput } from '../../src/modules/legal/review/review.types';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
}

function makeModel() {
  const model = {
    updateOne: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn(),
  };
  const chain = {
    lean: () => ({ exec: () => Promise.resolve(null) }),
  };
  const listChain = (result: unknown) => ({
    sort: () => ({ limit: () => ({ lean: () => ({ exec: () => Promise.resolve(result) }) }) }),
  });
  return { model, chain, listChain };
}

function makeInput(overrides: Partial<TraceRecordInput> = {}): TraceRecordInput {
  return {
    msgId: 'm-1',
    userId: 'u-1',
    intent: 'case_reasoning',
    citedLaws: [{ ref: '民法典第143条', verified: true }],
    citedCases: [{ caseId: 'c-1' }],
    promptVersion: 'v1',
    modelVersion: 'qwen-v1',
    reasoningChainId: 'rc-1',
    ragSources: [{ docId: 'd-1', score: 0.9, collection: 'law_article' }],
    answer: '这是AI回答，仅供参考，不构成法律意见',
    ...overrides,
  };
}

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    msgId: 'm-1',
    userId: 'u-1',
    intent: 'case_reasoning',
    citedLaws: [{ ref: '民法典第143条', verified: true }],
    citedCases: [{ caseId: 'c-1' }],
    ragSources: [{ docId: 'd-1', score: 0.9, collection: 'law_article' }],
    autoScore: 4.5,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('AnswerTracer（AI 回答溯源记录，17 §4）', () => {
  let tracer: AnswerTracer;
  let m: ReturnType<typeof makeModel>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    m = makeModel();
    logger = makeLogger();
    tracer = new AnswerTracer(m.model as never, logger as never);
  });

  // ===== record =====

  it('record：upsert 写入 answer_traceability + 返回 TraceRecord', async () => {
    m.model.updateOne.mockResolvedValue({ acknowledged: true });

    const rec = await tracer.record(makeInput(), 4.5);

    // 断言 DB 写入（upsert + $set）
    const [msgId, update, opts] = m.model.updateOne.mock.calls[0];
    expect(msgId).toEqual({ msgId: 'm-1' });
    expect(update).toEqual({ $set: expect.objectContaining({ userId: 'u-1', autoScore: 4.5 }) });
    expect(opts).toEqual({ upsert: true });
    // 返回值带 expireAt / autoScore
    expect(rec.msgId).toBe('m-1');
    expect(rec.autoScore).toBe(4.5);
    expect(rec.citedLaws).toHaveLength(1);
    expect(rec.createdAt).toBeInstanceOf(Date);
  });

  it('record：Model 未注入 → 不抛错，直接返回', async () => {
    const noModel = new AnswerTracer(undefined, logger as never);
    const rec = await noModel.record(makeInput(), 3.0);
    expect(rec.msgId).toBe('m-1');
    expect(rec.autoScore).toBe(3.0);
  });

  it('record：Model 写入失败 → 不阻塞 + logger.error', async () => {
    m.model.updateOne.mockRejectedValue(new Error('DB 不可用'));

    const rec = await tracer.record(makeInput(), 2.0);

    expect(rec.msgId).toBe('m-1');
    expect(logger.error).toHaveBeenCalledWith('写入 answer_traceability 失败', expect.anything());
  });

  // ===== getTrace =====

  it('getTrace：命中返回结构化记录', async () => {
    m.model.findOne.mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve(makeDoc()) }),
    });

    const rec = await tracer.getTrace('m-1');

    expect(rec).not.toBeNull();
    expect(rec!.msgId).toBe('m-1');
    expect(rec!.autoScore).toBe(4.5);
    expect(rec!.createdAt).toBeInstanceOf(Date);
  });

  it('getTrace：未命中返回 null', async () => {
    m.model.findOne.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(null) }) });
    const rec = await tracer.getTrace('nope');
    expect(rec).toBeNull();
  });

  it('getTrace：查询失败返回 null + warn', async () => {
    m.model.findOne.mockReturnValue({
      lean: () => ({ exec: () => Promise.reject(new Error('查询失败')) }),
    });

    const rec = await tracer.getTrace('m-1');

    expect(rec).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('查询溯源记录失败', expect.anything());
  });

  // ===== bindLawyerReview =====

  it('bindLawyerReview：回填 lawyerReviewId', async () => {
    m.model.updateOne.mockReturnValue({ exec: () => Promise.resolve({ modifiedCount: 1 }) });

    await tracer.bindLawyerReview('m-1', 'rv-9');

    expect(m.model.updateOne).toHaveBeenCalledWith(
      { msgId: 'm-1' },
      { $set: { lawyerReviewId: 'rv-9' } },
    );
  });

  it('bindLawyerReview：绑定失败 → warn 不抛错', async () => {
    m.model.updateOne.mockReturnValue({ exec: () => Promise.reject(new Error('失败')) });
    await expect(tracer.bindLawyerReview('m-1', 'rv-9')).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('绑定 lawyerReviewId 失败', expect.anything());
  });

  // ===== listByUser =====

  it('listByUser：按用户倒序分页查询', async () => {
    m.model.find.mockReturnValue(
      m.listChain([makeDoc(), makeDoc({ msgId: 'm-2', autoScore: 2.0 })]),
    );

    const recs = await tracer.listByUser('u-1', 10);

    expect(recs).toHaveLength(2);
    expect(m.model.find).toHaveBeenCalledWith({ userId: 'u-1' });
  });

  it('listByUser：查询失败返回空数组 + warn', async () => {
    m.model.find.mockReturnValue({
      sort: () => ({ limit: () => ({ lean: () => ({ exec: () => Promise.reject(new Error('失败')) }) }) }),
    });

    const recs = await tracer.listByUser('u-1');
    expect(recs).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('按用户查询溯源失败', expect.anything());
  });

  // ===== computeCitationFailureRate =====

  it('computeCitationFailureRate：全部成功 → 0', () => {
    expect(
      tracer.computeCitationFailureRate([
        { ref: 'a', verified: true },
        { ref: 'b', verified: true },
      ]),
    ).toBe(0);
  });

  it('computeCitationFailureRate：部分失败 → 正确比例', () => {
    expect(
      tracer.computeCitationFailureRate([
        { ref: 'a', verified: true },
        { ref: 'b', verified: false },
        { ref: 'c', verified: false },
      ]),
    ).toBeCloseTo(2 / 3);
  });

  it('computeCitationFailureRate：无引用法条 → 0', () => {
    expect(tracer.computeCitationFailureRate([])).toBe(0);
  });
});