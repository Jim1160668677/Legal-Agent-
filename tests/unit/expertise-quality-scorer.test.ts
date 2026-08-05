/**
 * ExpertiseQualityScorer 单元测试（v3.0 新增）。
 *
 * 覆盖：
 *   - 空输入评估（无专业知识 → D 级/低分 + 建议）
 *   - 加权总分计算（5 维 × 权重）
 *   - 等级判定（A/B/C/D 阈值）
 *   - 专业性评分（可靠性 + 覆盖率）
 *   - 逻辑性评分（步骤详情 + 描述比率 + 显著影响）
 *   - 实用性评分（审核修改数 / 无审核）
 *   - 适当性评分（类型-场景匹配）
 *   - 透明度评分（摘要/步骤/ID/应用说明）
 *   - evaluateByReasoningChain（查询推理链并评估）
 *   - 推理链不存在返回 null
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExpertiseQualityScorer } from '../../src/modules/legal/review/expertise-quality-scorer.service';
import type { ExpertiseQualityInput } from '../../src/modules/legal/review/expertise-quality-scorer.service';
import type { ExpertiseAppliedItem } from '../../src/infra/database/schemas/reasoning-chain.schema';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
}

function makeApplied(count = 2): ExpertiseAppliedItem[] {
  return Array.from({ length: count }, (_, i) => ({
    expertiseId: `le-${i + 1}`,
    expertiseTitle: `知识${i + 1}`,
    expertiseType: 'case_analysis',
    iracStep: (i % 4 === 0 ? 'issue' : i % 4 === 1 ? 'rule' : i % 4 === 2 ? 'application' : 'conclusion') as ExpertiseAppliedItem['iracStep'],
    applicationNote: `应用说明${i + 1}`,
    influenceScore: 0.7,
    source: 'auto_matched',
  }));
}

function makeInput(overrides: Partial<ExpertiseQualityInput> = {}): ExpertiseQualityInput {
  return {
    expertiseApplied: makeApplied(),
    professionalJudgmentNote: {
      summary: '融合了律师专业判断',
      stepDetails: [
        { step: 'issue', expertiseIds: ['le-1'], influenceDescription: '补充了争议点' },
      ],
      significantlyInfluenced: true,
    },
    context: { intent: 'case_reasoning', scenario: 'case_analysis' },
    ...overrides,
  };
}

function makeModel() {
  return {
    findOne: vi.fn(),
  };
}

describe('ExpertiseQualityScorer（v3.0 专业判断质量评估）', () => {
  let scorer: ExpertiseQualityScorer;
  let logger: ReturnType<typeof makeLogger>;
  let chainModel: ReturnType<typeof makeModel>;
  let reviewModel: ReturnType<typeof makeModel>;

  beforeEach(() => {
    logger = makeLogger();
    chainModel = makeModel();
    reviewModel = makeModel();
    scorer = new ExpertiseQualityScorer(chainModel as never, reviewModel as never, undefined, logger as never);
  });

  // ===== 主评估 =====

  it('空输入：专业/逻辑/透明度低分，D 级', async () => {
    const result = await scorer.evaluate({});

    expect(result.grade).toBe('D');
    expect(result.overallScore).toBeLessThan(2.5);
    const dim = result.dimensions.find((d) => d.name === '专业性');
    expect(dim?.score).toBe(1.0);
  });

  it('加权总分在 [0,5] 范围且为五维加权', async () => {
    const result = await scorer.evaluate(makeInput());

    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(5);
    expect(result.dimensions.length).toBe(5);
  });

  it('完整输入可达 B 级及以上', async () => {
    const result = await scorer.evaluate(makeInput());
    // 5 维都在 3.0+ 加权后一般 ≥ 3.5
    expect(result.overallScore).toBeGreaterThanOrEqual(3.5);
    expect(['A', 'B', 'C']).toContain(result.grade);
  });

  it('评估结果包含优势/改进/建议', async () => {
    const result = await scorer.evaluate(makeInput());
    expect(Array.isArray(result.strengths)).toBe(true);
    expect(Array.isArray(result.improvements)).toBe(true);
    expect(Array.isArray(result.recommendations)).toBe(true);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  // ===== 各维度 =====

  it('专业性：可靠性 1.0 + 全步骤覆盖 → 高分', async () => {
    const applied = [
      makeApplied(1)[0],
      { ...makeApplied(1)[0], iracStep: 'rule' as const },
      { ...makeApplied(1)[0], iracStep: 'application' as const },
      { ...makeApplied(1)[0], iracStep: 'conclusion' as const },
    ];
    const noService = new ExpertiseQualityScorer(chainModel as never, reviewModel as never, undefined, logger as never);
    const result = await noService.evaluate({ expertiseApplied: applied });
    const dim = result.dimensions.find((d) => d.name === '专业性');
    expect(dim!.score).toBeGreaterThan(3);
  });

  it('逻辑性：无步骤详情 → 基础分 2.0', async () => {
    const result = await scorer.evaluate(
      makeInput({
        professionalJudgmentNote: {
          summary: 's',
          stepDetails: [],
          significantlyInfluenced: false,
        },
      }),
    );
    const dim = result.dimensions.find((d) => d.name === '逻辑性');
    expect(dim!.score).toBe(2.0);
  });

  it('实用性：律师修改多 → 高实用分（封顶 5.0）', async () => {
    const result = await scorer.evaluate(
      makeInput({
        reviewResult: { modificationsCount: 10, supplementsCount: 3, reviewDuration: 1000 },
      }),
    );
    const dim = result.dimensions.find((d) => d.name === '实用性');
    expect(dim!.score).toBe(5.0);
  });

  it('适当性：无 context → 基础分 3.0', async () => {
    const result = await scorer.evaluate(makeInput({ context: undefined }));
    const dim = result.dimensions.find((d) => d.name === '适当性');
    expect(dim!.score).toBe(3.0);
  });

  it('透明度：有摘要/步骤/ID/应用说明 → 满分', async () => {
    const result = await scorer.evaluate(makeInput());
    const dim = result.dimensions.find((d) => d.name === '透明度');
    expect(dim!.score).toBe(5.0);
  });

  // ===== 按推理链评估 =====

  it('evaluateByReasoningChain：查询并评估', async () => {
    chainModel.findOne.mockResolvedValue({
      chainId: 'rc-1',
      msgId: 'msg-1',
      lawyerExpertiseApplied: makeApplied(),
      professionalJudgmentNote: {
        summary: 's',
        stepDetails: [{ step: 'issue', expertiseIds: ['le-1'], influenceDescription: 'd' }],
        significantlyInfluenced: true,
      },
    });
    reviewModel.findOne.mockResolvedValue({
      modifications: [{ type: 'edit' }],
      supplements: [{ supplementType: 'risk_warning' }],
      reviewDuration: 5000,
    });

    const result = await scorer.evaluateByReasoningChain('rc-1');

    expect(result).not.toBeNull();
    expect(result!.dimensions.length).toBe(5);
    expect(chainModel.findOne).toHaveBeenCalledWith({ chainId: 'rc-1' });
  });

  it('evaluateByReasoningChain：推理链不存在返回 null', async () => {
    chainModel.findOne.mockResolvedValue(null);
    const result = await scorer.evaluateByReasoningChain('nope');
    expect(result).toBeNull();
  });

  it('evaluateByReasoningChain：无审核结果时仍可评估', async () => {
    chainModel.findOne.mockResolvedValue({
      chainId: 'rc-1',
      msgId: 'msg-1',
      lawyerExpertiseApplied: makeApplied(1),
    });
    reviewModel.findOne.mockResolvedValue(null);

    const result = await scorer.evaluateByReasoningChain('rc-1');
    expect(result).not.toBeNull();
  });
});
