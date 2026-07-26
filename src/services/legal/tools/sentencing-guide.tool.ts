/**
 * SentencingGuide —— 量刑指导工具（v2.3-W1，14-tool-design.md §十）。
 *
 * 输入：罪名 + 情节要素（数额/次数/后果/前科/自首/立功）
 * 输出：量刑幅度 + 基准刑 + 调节比例 + 法条依据
 *
 * 算法（14 §10.4）：
 *   1. 按 charge 加载量刑指导数据
 *   2. 必填情节要素校验（缺失抛 8007）
 *   3. 量刑档次定位（按 amount/times/consequence）
 *   4. 基准刑 = (min + max) / 2
 *   5. 情节调节（前科加重 +15%、自首减轻 -25%、立功减轻 -15%）
 *   6. 最终刑期 = baseSentence × (1 + Σ percentage / 100)，clamp 到 [min, max]
 *
 * 法条依据：刑法分则各罪名条款 + 最高法《关于常见犯罪的量刑指导意见》
 *
 * 设计依据：14-tool-design.md §十工具 7。
 */
import { Injectable } from '@nestjs/common';
import {
  findGuide,
  type SentencingGuideEntry,
  type SentencingTier,
} from '../../../data/sentencingGuide';
import {
  LegalToolError,
  TOOL_ERROR_CODES,
  type JsonSchema,
  type LegalTool,
  type ToolContext,
  type ToolId,
  type ToolResult,
} from './types';

export interface SentencingElements {
  amount?: number;
  times?: number;
  consequence?: string;
  priorConviction?: boolean;
  surrender?: boolean;
  merit?: boolean;
}

export interface SentencingGuideInput {
  charge: string;
  elements: SentencingElements;
}

export interface SentencingRange {
  min: number;
  max: number;
  unit: 'month' | 'year' | 'fixed_term';
}

export interface SentencingAdjustmentResult {
  type: 'aggravating' | 'mitigating';
  factor: string;
  description: string;
  percentage: number;
}

export interface SentencingGuideOutput {
  sentencingRange: SentencingRange;
  baseSentence: number | null;
  adjustments: SentencingAdjustmentResult[];
  finalSentence?: number;
  calculationTrace: string;
}

const DISCLAIMER =
  '⚠️ 量刑指导仅供参考，不构成法律意见。最终量刑由法院根据全案情况决定，本工具仅基于常见情节估算，未考虑全部量刑因素。如涉及刑事案件，请务必咨询专业刑事辩护律师。';

@Injectable()
export class SentencingGuideTool implements LegalTool<SentencingGuideInput, SentencingGuideOutput> {
  readonly toolId: ToolId = 'sentencing_guide';
  readonly name = '量刑指导';
  readonly description = '罪名+情节要素→量刑幅度+基准刑+调节比例';
  readonly category = 'criminal' as const;
  readonly piiLevel = 'L2' as const;
  readonly async = false;
  readonly timeout = 5_000;
  readonly cacheable = true;
  readonly cacheTtl = 7 * 24 * 3_600;
  readonly toolVersion = '1.0.0';

  readonly inputSchema: JsonSchema = {
    type: 'object',
    properties: {
      charge: { type: 'string' },
      elements: {
        type: 'object',
        properties: {
          amount: { type: 'number', minimum: 0 },
          times: { type: 'integer', minimum: 1 },
          consequence: { type: 'string' },
          priorConviction: { type: 'boolean' },
          surrender: { type: 'boolean' },
          merit: { type: 'boolean' },
        },
      },
    },
    required: ['charge', 'elements'],
  };

  readonly outputSchema: JsonSchema = {
    type: 'object',
    properties: {
      sentencingRange: { type: 'object' },
      baseSentence: { type: 'number' },
      adjustments: { type: 'array' },
      calculationTrace: { type: 'string' },
    },
    required: ['sentencingRange', 'baseSentence', 'adjustments'],
  };

  async invoke(
    input: SentencingGuideInput,
    ctx: ToolContext,
  ): Promise<ToolResult<SentencingGuideOutput>> {
    // 1. 加载量刑指导数据
    const guide = findGuide(input.charge);
    if (!guide) {
      // 罪名未覆盖 → 抛 8007（情节要素不足语义扩展为罪名未覆盖）
      throw new LegalToolError(
        TOOL_ERROR_CODES.INSUFFICIENT_ELEMENTS,
        `罪名「${input.charge}」暂未覆盖量刑指导数据`,
        this.toolId,
        'charge',
      );
    }

    // 2. 必填情节要素校验
    for (const req of guide.requiredElements) {
      if (
        req === 'amount' &&
        (input.elements.amount === undefined || input.elements.amount === null)
      ) {
        throw new LegalToolError(
          TOOL_ERROR_CODES.INSUFFICIENT_ELEMENTS,
          `${guide.charge} 须提供 elements.amount（涉案数额）`,
          this.toolId,
          'elements.amount',
        );
      }
      if (
        req === 'times' &&
        (input.elements.times === undefined || input.elements.times === null)
      ) {
        throw new LegalToolError(
          TOOL_ERROR_CODES.INSUFFICIENT_ELEMENTS,
          `${guide.charge} 须提供 elements.times（次数）`,
          this.toolId,
          'elements.times',
        );
      }
      if (req === 'consequence' && !input.elements.consequence) {
        throw new LegalToolError(
          TOOL_ERROR_CODES.INSUFFICIENT_ELEMENTS,
          `${guide.charge} 须提供 elements.consequence（后果描述）`,
          this.toolId,
          'elements.consequence',
        );
      }
    }

    // 3. 量刑档次定位
    const tier = this.locateTier(guide, input.elements);
    if (!tier) {
      // 不构成犯罪（如盗窃 amount < 1000）
      throw new LegalToolError(
        TOOL_ERROR_CODES.INSUFFICIENT_ELEMENTS,
        `${guide.charge} 情节要素未达犯罪门槛（如数额过低）`,
        this.toolId,
      );
    }

    // 4. 基准刑 = (min + max) / 2
    const baseSentence = Math.round((tier.range.min + tier.range.max) / 2);

    // 5. 情节调节
    const adjustments: SentencingAdjustmentResult[] = [];
    const traceParts: string[] = [];
    traceParts.push(`罪名：${guide.charge}`);
    traceParts.push(`档次：${tier.name}（${tier.range.min}-${tier.range.max} ${tier.unit}）`);
    traceParts.push(`基准刑：${baseSentence} ${tier.unit}`);

    for (const adj of guide.adjustments) {
      const flag = this.getAdjustmentFlag(input.elements, adj.factor);
      if (flag) {
        adjustments.push({
          type: adj.type,
          factor: adj.factor,
          description: adj.description,
          percentage: adj.percentage,
        });
        traceParts.push(`${adj.description}：${adj.percentage > 0 ? '+' : ''}${adj.percentage}%`);
      }
    }

    // 6. 计算最终刑期
    const sumPct = adjustments.reduce((s, a) => s + a.percentage, 0);
    let finalSentence = Math.round(baseSentence * (1 + sumPct / 100));
    // clamp 到 [min, max]
    if (finalSentence < tier.range.min) finalSentence = tier.range.min;
    if (finalSentence > tier.range.max) finalSentence = tier.range.max;
    traceParts.push(`最终刑期：${finalSentence} ${tier.unit}（已 clamp 至档次范围）`);

    ctx.logger?.debug('SentencingGuide 计算', {
      charge: input.charge,
      tier: tier.name,
      baseSentence,
      finalSentence,
      adjustmentCount: adjustments.length,
      traceId: ctx.traceId,
    });

    return {
      success: true,
      data: {
        sentencingRange: {
          min: tier.range.min,
          max: tier.range.max,
          unit: tier.unit,
        },
        baseSentence,
        adjustments,
        finalSentence,
        calculationTrace: traceParts.join('\n'),
      },
      lawRefs: guide.lawRefs.map((r) => ({ ...r, verified: true })),
      disclaimer: DISCLAIMER,
    };
  }

  /** 定位量刑档次 */
  private locateTier(
    guide: SentencingGuideEntry,
    elements: SentencingElements,
  ): SentencingTier | null {
    for (const tier of guide.tiers) {
      const c = tier.condition;
      if (c.type === 'amount' && elements.amount !== undefined) {
        if (elements.amount >= c.min && elements.amount < c.max) return tier;
      } else if (c.type === 'times' && elements.times !== undefined) {
        if (elements.times >= c.min && elements.times < c.max) return tier;
      } else if (c.type === 'consequence' && elements.consequence) {
        if (c.values.some((v) => elements.consequence!.includes(v))) return tier;
      } else if (c.type === 'default') {
        // default 档次：仅当前序档次都未匹配时返回
        // 注意：default 应放在 tiers 最后
      }
    }
    // 检查 default 档次
    const defaultTier = guide.tiers.find((t) => t.condition.type === 'default');
    return defaultTier ?? null;
  }

  /** 获取情节调节开关 */
  private getAdjustmentFlag(elements: SentencingElements, factor: string): boolean {
    switch (factor) {
      case 'priorConviction':
        return elements.priorConviction === true;
      case 'surrender':
        return elements.surrender === true;
      case 'merit':
        return elements.merit === true;
      default:
        return false;
    }
  }
}
