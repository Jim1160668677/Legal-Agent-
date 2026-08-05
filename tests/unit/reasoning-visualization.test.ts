/**
 * ReasoningVisualizationService 单元测试（v3.0 新增）。
 *
 * 覆盖：
 *   - 生成可视化图（IRAC 四步节点 + 连线）
 *   - 专业判断影响图节点（expertise_influence）
 *   - 推理追踪节点（trace）
 *   - 法条引用图节点（rule/application）
 *   - 推理链不存在返回 null
 *   - 配置开关（includeExpertise=false 跳过）
 *   - generateJudgmentExplanation（专业判断说明）
 *   - generateSummaryView（摘要视图）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReasoningVisualizationService } from '../../src/modules/legal/reasoning/reasoning-visualization.service';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
}

function makeChain() {
  return {
    chainId: 'rc-1',
    msgId: 'msg-1',
    issues: [{ id: 'i1', issueType: 'contract_dispute', relatedLaws: ['民法典第143条'] }],
    rules: [
      {
        articleId: '民法典第143条',
        articleText: '具备下列条件的民事法律行为有效…',
        conditions: [],
        legalConsequences: [],
        status: 'effective',
      },
    ],
    applications: [
      { ruleId: '民法典第143条', factMatch: '符合', matchedFacts: ['事实1'], conditionsMet: true },
    ],
    conclusion: { summary: '结论', lawRefs: ['民法典第143条'], confidence: 0.8 },
    lawyerExpertiseApplied: [
      {
        expertiseId: 'le-1',
        expertiseTitle: '合同审查实务',
        expertiseType: 'case_analysis',
        iracStep: 'issue',
        applicationNote: '补充争议点',
        influenceScore: 0.8,
        source: 'auto_matched',
      },
    ],
    professionalJudgmentNote: {
      summary: '显著影响',
      stepDetails: [{ step: 'issue', expertiseIds: ['le-1'], influenceDescription: '补充' }],
      significantlyInfluenced: true,
    },
    reasoningTrace: [
      {
        nodeId: 't1',
        nodeType: 'expertise_injected',
        title: '注入节点',
        content: '内容',
        expertiseIds: ['le-1'],
        order: 0,
      },
    ],
  };
}

function makeModel() {
  return { findOne: vi.fn() };
}

describe('ReasoningVisualizationService（v3.0 推理可视化）', () => {
  let service: ReasoningVisualizationService;
  let logger: ReturnType<typeof makeLogger>;
  let chainModel: ReturnType<typeof makeModel>;

  beforeEach(() => {
    logger = makeLogger();
    chainModel = makeModel();
    service = new ReasoningVisualizationService(chainModel as never, undefined, logger as never);
  });

  // ===== 生成可视化图 =====

  it('生成完整 IRAC 流程图：4 个步骤节点 + 流转连线', async () => {
    chainModel.findOne.mockResolvedValue(makeChain());

    const graph = await service.generateVisualization('rc-1');

    expect(graph).not.toBeNull();
    expect(graph!.nodes.filter((n) => n.type === 'irac_step').length).toBe(4);
    // IRAC 3 条 + 法条应用 1 条 flows 连线
    expect(graph!.edges.filter((e) => e.type === 'flows').length).toBe(4);
    expect(graph!.metadata.reasoningChainId).toBe('rc-1');
  });

  it('包含专业知识影响节点', async () => {
    chainModel.findOne.mockResolvedValue(makeChain());

    const graph = await service.generateVisualization('rc-1');

    const expertiseNodes = graph!.nodes.filter((n) => n.type === 'expertise');
    expect(expertiseNodes.length).toBe(1);
    expect(graph!.edges.some((e) => e.type === 'influences')).toBe(true);
  });

  it('包含推理追踪节点', async () => {
    chainModel.findOne.mockResolvedValue(makeChain());

    const graph = await service.generateVisualization('rc-1');

    expect(graph!.nodes.some((n) => n.type === 'trace')).toBe(true);
  });

  it('包含法条引用与应用节点', async () => {
    chainModel.findOne.mockResolvedValue(makeChain());

    const graph = await service.generateVisualization('rc-1');

    expect(graph!.nodes.some((n) => n.type === 'rule')).toBe(true);
    expect(graph!.nodes.some((n) => n.type === 'application')).toBe(true);
  });

  it('推理链不存在返回 null', async () => {
    chainModel.findOne.mockResolvedValue(null);

    const graph = await service.generateVisualization('nope');

    expect(graph).toBeNull();
  });

  it('includeExpertise=false 时跳过专业知识节点', async () => {
    chainModel.findOne.mockResolvedValue(makeChain());

    const graph = await service.generateVisualization('rc-1', { includeExpertise: false });

    expect(graph!.nodes.some((n) => n.type === 'expertise')).toBe(false);
  });

  it('includeTrace=false 时跳过推理追踪节点', async () => {
    chainModel.findOne.mockResolvedValue(makeChain());

    const graph = await service.generateVisualization('rc-1', { includeTrace: false });

    expect(graph!.nodes.some((n) => n.type === 'trace')).toBe(false);
  });

  it('includeLawRefs=false 时跳过法条引用节点', async () => {
    chainModel.findOne.mockResolvedValue(makeChain());

    const graph = await service.generateVisualization('rc-1', { includeLawRefs: false });

    expect(graph!.nodes.some((n) => n.type === 'rule')).toBe(false);
    expect(graph!.nodes.some((n) => n.type === 'application')).toBe(false);
  });

  it('无 lawyerExpertiseApplied 时生成基础 IRAC 图（无专业知识/追踪节点）', async () => {
    const chain = makeChain();
    delete (chain as Record<string, unknown>).lawyerExpertiseApplied;
    delete (chain as Record<string, unknown>).reasoningTrace;
    chainModel.findOne.mockResolvedValue(chain);

    const graph = await service.generateVisualization('rc-1');

    expect(graph!.nodes.some((n) => n.type === 'expertise')).toBe(false);
    expect(graph!.nodes.some((n) => n.type === 'trace')).toBe(false);
    expect(graph!.nodes.filter((n) => n.type === 'irac_step').length).toBe(4);
  });

  it('Model 未注入抛错', async () => {
    const noModel = new ReasoningVisualizationService(undefined, undefined, logger as never);
    await expect(noModel.generateVisualization('rc-1')).rejects.toThrow(/未注入/);
  });

  // ===== 注入 lawyerExpertiseService =====

  it('注入专业知识服务 → generateJudgmentExplanation 拉取知识详情', async () => {
    const expertiseSvc = { getById: vi.fn().mockResolvedValue({ content: '实务经验内容' }) };
    const injected = new ReasoningVisualizationService(
      chainModel as never,
      expertiseSvc as never,
      logger as never,
    );
    chainModel.findOne.mockResolvedValue(makeChain());

    const explanation = await injected.generateJudgmentExplanation('rc-1');

    expect(explanation).not.toBeNull();
    expect(expertiseSvc.getById).toHaveBeenCalledWith('le-1');
  });

  it('专业知识服务查询失败 → 降级不报错 + warning', async () => {
    const expertiseSvc = { getById: vi.fn().mockRejectedValue(new Error('DB 不可用')) };
    const injected = new ReasoningVisualizationService(
      chainModel as never,
      expertiseSvc as never,
      logger as never,
    );
    chainModel.findOne.mockResolvedValue(makeChain());

    const explanation = await injected.generateJudgmentExplanation('rc-1');

    expect(explanation).not.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('获取专业知识详情失败', expect.anything());
  });

  it('专业知识详情不存在 → 跳过，不影响说明生成', async () => {
    const expertiseSvc = { getById: vi.fn().mockResolvedValue(null) };
    const injected = new ReasoningVisualizationService(
      chainModel as never,
      expertiseSvc as never,
      logger as never,
    );
    chainModel.findOne.mockResolvedValue(makeChain());

    const explanation = await injected.generateJudgmentExplanation('rc-1');

    expect(explanation!.stepByStepBreakdown.length).toBe(1);
  });

  it('无 professionalJudgmentNote → 使用兜底说明文案', async () => {
    const chain = makeChain();
    delete (chain as Record<string, unknown>).professionalJudgmentNote;
    chainModel.findOne.mockResolvedValue(chain);

    const explanation = await service.generateJudgmentExplanation('rc-1');

    expect(explanation!.summary).toContain('本次推理融合了 1 条律师专业知识');
  });

  // ===== 专业判断说明 =====

  it('generateJudgmentExplanation：生成步骤分解', async () => {
    chainModel.findOne.mockResolvedValue(makeChain());

    const explanation = await service.generateJudgmentExplanation('rc-1');

    expect(explanation).not.toBeNull();
    expect(explanation!.stepByStepBreakdown.length).toBe(1);
    expect(explanation!.overallAssessment).toContain('显著影响');
  });

  it('generateJudgmentExplanation：推理链不存在返回 null', async () => {
    chainModel.findOne.mockResolvedValue(null);
    const explanation = await service.generateJudgmentExplanation('nope');
    expect(explanation).toBeNull();
  });

  // ===== 摘要视图 =====

  it('generateSummaryView：按 IRAC 步骤统计专业知识', async () => {
    chainModel.findOne.mockResolvedValue(makeChain());

    const view = await service.generateSummaryView('rc-1');

    expect(view).not.toBeNull();
    expect(view!.iracSteps.length).toBe(4);
    expect(view!.totalExpertiseApplied).toBe(1);
    expect(view!.keyInsights.length).toBeGreaterThan(0);
  });

  it('generateSummaryView：推理链不存在返回 null', async () => {
    chainModel.findOne.mockResolvedValue(null);
    const view = await service.generateSummaryView('nope');
    expect(view).toBeNull();
  });
});
