/**
 * LawyerExpertiseKnowledgeBaseService 单元测试（v3.0 新增）。
 *
 * 覆盖：
 *   - 创建专业知识（ID 生成、默认字段）
 *   - 查询（过滤条件、分页、排序、默认 approved）
 *   - issueType 过滤条件构建
 *   - getById / getByExpertiseId 别名
 *   - 更新 / 软删除
 *   - queryForScenario（场景检索 + lawId 兜底补足）
 *   - buildInjectionContext（按 IRAC 步骤检索 + 去重 + 注入文本）
 *   - recordUsage（计数 + 历史 + 可信度 EMA）
 *   - recordUsageByExternalId
 *   - Model 未注入时的内存兜底 / 抛错
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LawyerExpertiseKnowledgeBaseService } from '../../src/modules/legal/knowledge/lawyer-expertise-knowledge-base.service';
import type { CreateExpertiseInput } from '../../src/modules/legal/knowledge/lawyer-expertise-knowledge-base.service';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
}

function makeInput(overrides: Partial<CreateExpertiseInput> = {}): CreateExpertiseInput {
  return {
    expertiseType: 'case_analysis',
    title: '劳动争议仲裁时效',
    content: '劳动争议仲裁时效为一年，自知道或应当知道权利被侵害之日起计算。',
    scenarioTags: ['case_analysis'],
    conditions: { issueTypes: ['labor_dispute'], factKeywords: ['仲裁时效'] },
    contributedBy: 'lawyer-1',
    ...overrides,
  };
}

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    expertiseId: 'le_123',
    expertiseType: 'case_analysis',
    title: '劳动争议仲裁时效',
    content: '劳动争议仲裁时效为一年。',
    scenarioTags: ['case_analysis'],
    conditions: { issueTypes: ['labor_dispute'] },
    argument: undefined,
    examples: [],
    sources: [],
    relatedLawIds: [],
    relatedCaseIds: [],
    contributedBy: 'lawyer-1',
    contributorName: '张律师',
    practiceAreas: ['劳动法'],
    reliabilityScore: 0.8,
    usageCount: 3,
    reviewStatus: 'approved',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeModel() {
  const model = {
    create: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    find: vi.fn(),
    countDocuments: vi.fn(),
    updateOne: vi.fn(),
  };

  const chain = (result: unknown) => ({
    sort: () => chain(result),
    skip: () => chain(result),
    limit: () => chain(result),
    lean: () => chain(result),
    exec: () => Promise.resolve(result),
  });

  return { model, chain };
}

describe('LawyerExpertiseKnowledgeBaseService（v3.0 律师专业知识库）', () => {
  let service: LawyerExpertiseKnowledgeBaseService;
  let m: ReturnType<typeof makeModel>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    m = makeModel();
    logger = makeLogger();
    service = new LawyerExpertiseKnowledgeBaseService(m.model as never, logger as never);
  });

  // ===== CRUD =====

  it('创建：生成 le_ 前缀 ID + 默认审核通过', async () => {
    m.model.create.mockImplementation(async (d) => d);

    const result = await service.create(makeInput());

    expect(result.expertiseId).toMatch(/^le_/);
    expect(result.reviewStatus).toBe('approved');
    expect(result.reliabilityScore).toBe(0.8);
  });

  it('创建：Model 未注入抛错', async () => {
    const noModel = new LawyerExpertiseKnowledgeBaseService(undefined, logger as never);
    await expect(noModel.create(makeInput())).rejects.toThrow(/未注入/);
  });

  it('getById：返回 DTO 结果', async () => {
    m.model.findOne.mockReturnValue(m.chain(makeDoc()));

    const result = await service.getById('le_123');

    expect(result?.expertiseId).toBe('le_123');
    expect(result?.practiceAreas).toEqual(['劳动法']);
  });

  it('getById：不存在返回 null', async () => {
    m.model.findOne.mockReturnValue(m.chain(null));
    const result = await service.getById('nope');
    expect(result).toBeNull();
  });

  it('getByExpertiseId：别名等价', async () => {
    m.model.findOne.mockReturnValue(m.chain(makeDoc()));
    const result = await service.getByExpertiseId('le_123');
    expect(result?.title).toBe('劳动争议仲裁时效');
  });

  it('update：合并更新字段', async () => {
    m.model.findOneAndUpdate.mockReturnValue(
      m.chain(makeDoc({ title: '修订标题', reliabilityScore: 0.85 })),
    );

    const result = await service.update('le_123', { title: '修订标题' });

    expect(result?.title).toBe('修订标题');
    expect(m.model.findOneAndUpdate).toHaveBeenCalledWith(
      { expertiseId: 'le_123' },
      expect.objectContaining({ $set: expect.objectContaining({ title: '修订标题' }) }),
      expect.objectContaining({ new: true }),
    );
  });

  it('remove：软删除标记 rejected', async () => {
    m.model.updateOne.mockReturnValue(m.chain({ modifiedCount: 1 }));

    const ok = await service.remove('le_123');

    expect(ok).toBe(true);
    expect(m.model.updateOne).toHaveBeenCalledWith(
      { expertiseId: 'le_123' },
      expect.objectContaining({ $set: expect.objectContaining({ reviewStatus: 'rejected' }) }),
    );
  });

  // ===== 检索 =====

  it('query：默认只返回已审核通过的 + 分页限制', async () => {
    m.model.find.mockReturnValue(m.chain([makeDoc()]));
    m.model.countDocuments.mockReturnValue(m.chain(1));

    const result = await service.query({});

    expect(result.total).toBe(1);
    expect(result.items.length).toBe(1);
    // 默认 filter.reviewStatus = approved
    expect(m.model.find).toHaveBeenCalledWith(
      expect.objectContaining({ reviewStatus: 'approved' }),
    );
  });

  it('query：issueType 构建 conditions.issueTypes 过滤', async () => {
    m.model.find.mockReturnValue(m.chain([]));
    m.model.countDocuments.mockReturnValue(m.chain(0));

    await service.query({ issueType: 'labor_dispute' });

    expect(m.model.find).toHaveBeenCalledWith(
      expect.objectContaining({ 'conditions.issueTypes': 'labor_dispute' }),
    );
  });

  it('query：关键词转义为正则搜索', async () => {
    m.model.find.mockReturnValue(m.chain([]));
    m.model.countDocuments.mockReturnValue(m.chain(0));

    await service.query({ keyword: '时效(1)' });

    const filter = m.model.find.mock.calls[0][0];
    expect(filter.$or).toBeDefined();
    expect(String(filter.$or[0].title)).toContain('\\(');
  });

  it('query：降级返回空（数据库异常）', async () => {
    m.model.find.mockReturnValue({ exec: () => Promise.reject(new Error('db down')) });
    m.model.countDocuments.mockReturnValue({ exec: () => Promise.reject(new Error('db down')) });

    const result = await service.query({});

    expect(result).toEqual({ items: [], total: 0 });
  });

  it('Model 未注入时 query 返回空（内存兜底）', async () => {
    const noModel = new LawyerExpertiseKnowledgeBaseService(undefined, logger as never);
    const result = await noModel.query({});
    expect(result).toEqual({ items: [], total: 0 });
  });

  // ===== queryForScenario =====

  it('queryForScenario：命中后无需 lawId 兜底', async () => {
    // query 调用两次（主查 + 可能兜底），首次有结果
    m.model.find.mockReturnValue(m.chain([makeDoc()]));
    m.model.countDocuments.mockReturnValue(m.chain(1));

    const result = await service.queryForScenario('case_analysis', 'labor_dispute', ['law-1']);

    expect(result.length).toBe(1);
  });

  // ===== buildInjectionContext =====

  it('buildInjectionContext：无匹配返回空注入文本', async () => {
    m.model.find.mockReturnValue(m.chain([]));
    m.model.countDocuments.mockReturnValue(m.chain(0));

    const ctx = await service.buildInjectionContext('issue', { caseDescription: '劳动纠纷' });

    expect(ctx.injectedExpertise.length).toBe(0);
    expect(ctx.injectionPrompt).toBe('');
    expect(ctx.iracStep).toBe('issue');
  });

  it('buildInjectionContext：检索到知识并格式化注入文本', async () => {
    m.model.find.mockReturnValue(m.chain([makeDoc()]));
    m.model.countDocuments.mockReturnValue(m.chain(1));

    const ctx = await service.buildInjectionContext('issue', { caseDescription: '劳动纠纷仲裁' });

    expect(ctx.injectedExpertise.length).toBe(1);
    expect(ctx.injectionPrompt).toContain('劳动争议仲裁时效');
  });

  // ===== 使用追踪 =====

  it('recordUsage：递增计数 + 保留历史', async () => {
    m.model.findOneAndUpdate.mockReturnValue(m.chain(makeDoc({ usageCount: 3 })));

    await service.recordUsage('le_123', 'rc-1', 'issue');

    expect(m.model.findOneAndUpdate).toHaveBeenCalledWith(
      { expertiseId: 'le_123' },
      expect.objectContaining({ $inc: { usageCount: 1 } }),
    );
  });

  it('recordUsage：有效果评分时调整可信度', async () => {
    m.model.findOneAndUpdate.mockReturnValue(m.chain(makeDoc({ usageCount: 0, reliabilityScore: 0.8 })));
    m.model.updateOne.mockReturnValue(m.chain({ modifiedCount: 1 }));

    await service.recordUsage('le_123', 'rc-1', 'issue', 5);

    // EMA: alpha = 2/(0+1) = 2 → newRel = 1.0
    expect(m.model.updateOne).toHaveBeenCalledWith(
      { expertiseId: 'le_123' },
      expect.objectContaining({ $set: expect.objectContaining({ reliabilityScore: 1.0 }) }),
    );
  });

  it('recordUsageByExternalId：外部引用记录', async () => {
    m.model.updateOne.mockReturnValue(m.chain({ modifiedCount: 1 }));

    await service.recordUsageByExternalId('le_123', 'ppr_1', 'pre_publish_review');

    expect(m.model.updateOne).toHaveBeenCalledWith(
      { expertiseId: 'le_123' },
      expect.objectContaining({ $inc: { usageCount: 1 } }),
    );
  });

  it('recordUsage：Model 未注入静默跳过', async () => {
    const noModel = new LawyerExpertiseKnowledgeBaseService(undefined, logger as never);
    await expect(noModel.recordUsage('le_123', 'rc-1', 'issue')).resolves.toBeUndefined();
  });
});
