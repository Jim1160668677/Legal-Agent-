/**
 * CompensationQuery —— 赔偿标准查询工具（v2.3-W1，14-tool-design.md §八）。
 *
 * 输入：案由 + 地区 + 伤残等级（可选）+ 收入（可选）+ 被扶养人数（可选）+ 医疗费（可选）
 * 输出：赔偿项目明细（医疗费/误工费/护理费/残疾赔偿金/被扶养人生活费/精神损害抚慰金）+ 总额
 *
 * 算法（14 §8.4）：
 *   1. 按 region 加载赔偿标准（缺失回退全国均值，warnings 提示）
 *   2. 残疾赔偿金 = 城镇居民人均可支配收入 × 20 年 × 伤残系数
 *   3. 误工费 = 日工资 × 误工天数（默认 90 天）
 *   4. 护理费 = 护工日薪 × 护理天数（默认 30 天）
 *   5. 被扶养人生活费 = 城镇居民人均消费支出 × 扶养年限 × 伤残系数 ÷ 扶养人数
 *   6. 精神损害抚慰金（按伤残等级查表）
 *   7. 医疗费直传
 *
 * 法条依据：
 *   - 民法典第一千一百七十九条（人身损害赔偿范围）
 *   - 民法典第一千一百八十三条（精神损害赔偿）
 *
 * 设计依据：14-tool-design.md §八工具 5。
 */
import { Injectable } from '@nestjs/common';
import { disabilityCoefficient, findStandard } from '../../../data/compensationStandards';
import {
  LegalToolError,
  TOOL_ERROR_CODES,
  type JsonSchema,
  type LegalTool,
  type ToolContext,
  type ToolId,
  type ToolResult,
} from './types';

export interface CompensationInput {
  causeOfAction: string;
  region: string;
  disabilityLevel?: number;
  income?: { monthlySalary?: number; annualBonus?: number };
  dependents?: number;
  medicalFee?: number;
}

export interface CompensationItem {
  name: string;
  formula: string;
  amount: number;
  basis?: string;
}

export interface CompensationOutput {
  items: CompensationItem[];
  totalAmount: number;
  calculationTrace: string;
}

const DISCLAIMER =
  '⚠️ 赔偿金额仅供参考，具体数额以法院判决为准。各地区赔偿标准可能调整，请核对最新数据。如涉及重大索赔，请咨询专业律师。';

/** 默认误工天数 */
const DEFAULT_LOSS_DAYS = 90;
/** 默认护理天数 */
const DEFAULT_NURSING_DAYS = 30;
/** 默认扶养年限 */
const DEFAULT_SUPPORT_YEARS = 18;

@Injectable()
export class CompensationQueryTool implements LegalTool<CompensationInput, CompensationOutput> {
  readonly toolId: ToolId = 'compensation_query';
  readonly name = '赔偿标准查询';
  readonly description = '按地区+伤残等级+收入计算人身损害赔偿项目明细';
  readonly category = 'civil' as const;
  readonly piiLevel = 'L2' as const;
  readonly async = false;
  readonly timeout = 5_000;
  readonly cacheable = true;
  readonly cacheTtl = 24 * 3_600;
  readonly toolVersion = '1.0.0';

  readonly inputSchema: JsonSchema = {
    type: 'object',
    properties: {
      causeOfAction: { type: 'string' },
      region: { type: 'string' },
      disabilityLevel: { type: 'integer', minimum: 1, maximum: 10 },
      income: {
        type: 'object',
        properties: {
          monthlySalary: { type: 'number', minimum: 0 },
          annualBonus: { type: 'number', minimum: 0 },
        },
      },
      dependents: { type: 'integer', minimum: 0, maximum: 10 },
      medicalFee: { type: 'number', minimum: 0 },
    },
    required: ['causeOfAction', 'region'],
  };

  readonly outputSchema: JsonSchema = {
    type: 'object',
    properties: {
      items: { type: 'array' },
      totalAmount: { type: 'number' },
      calculationTrace: { type: 'string' },
    },
    required: ['items', 'totalAmount'],
  };

  async invoke(
    input: CompensationInput,
    ctx: ToolContext,
  ): Promise<ToolResult<CompensationOutput>> {
    // 0. 入参范围校验（disabilityLevel 1-10）
    if (input.disabilityLevel !== undefined) {
      if (
        typeof input.disabilityLevel !== 'number' ||
        !Number.isInteger(input.disabilityLevel) ||
        input.disabilityLevel < 1 ||
        input.disabilityLevel > 10
      ) {
        throw new LegalToolError(
          TOOL_ERROR_CODES.INVALID_INPUT,
          `disabilityLevel 应为 1-10 的整数（实际: ${input.disabilityLevel}）`,
          this.toolId,
          'disabilityLevel',
        );
      }
    }

    // 1. 加赔偿标准
    const { standard, matched } = findStandard(input.region);
    const warnings: string[] = [];
    if (!matched) {
      warnings.push(`该地区标准未覆盖，按全国均值计算（${standard.year} 年度）`);
    }

    const items: CompensationItem[] = [];
    const traceParts: string[] = [`【${standard.region}·${standard.year}年度标准】`];

    // 2. 医疗费
    if (input.medicalFee && input.medicalFee > 0) {
      items.push({
        name: '医疗费',
        formula: '按实际发生金额',
        amount: Math.round(input.medicalFee),
        basis: '民法典第一千一百七十九条',
      });
      traceParts.push(`医疗费：${input.medicalFee} 元`);
    }

    // 3. 误工费
    if (input.income?.monthlySalary && input.income.monthlySalary > 0) {
      const annual = input.income.monthlySalary * 12 + (input.income.annualBonus ?? 0);
      const dailyWage = annual / 365;
      const lossDays = DEFAULT_LOSS_DAYS;
      const amount = Math.round(dailyWage * lossDays);
      items.push({
        name: '误工费',
        formula: `(${input.income.monthlySalary}×12 + ${input.income.annualBonus ?? 0}) / 365 × ${lossDays} 天`,
        amount,
        basis: '民法典第一千一百七十九条',
      });
      traceParts.push(`误工费：${amount} 元`);
    }

    // 4. 护理费
    const nursingDays = DEFAULT_NURSING_DAYS;
    const nursingFee = Math.round(standard.nursingDailyWage * nursingDays);
    items.push({
      name: '护理费',
      formula: `${standard.nursingDailyWage} 元/天 × ${nursingDays} 天`,
      amount: nursingFee,
      basis: '民法典第一千一百七十九条',
    });
    traceParts.push(`护理费：${nursingFee} 元`);

    // 5. 残疾赔偿金
    if (input.disabilityLevel && input.disabilityLevel >= 1 && input.disabilityLevel <= 10) {
      const coef = disabilityCoefficient(input.disabilityLevel);
      const amount = Math.round(standard.urbanDisposableIncome * 20 * coef);
      items.push({
        name: '残疾赔偿金',
        formula: `${standard.urbanDisposableIncome} × 20 年 × ${coef.toFixed(1)}（${input.disabilityLevel} 级伤残系数）`,
        amount,
        basis: '民法典第一千一百七十九条',
      });
      traceParts.push(`残疾赔偿金：${amount} 元`);

      // 6. 被扶养人生活费
      if (input.dependents && input.dependents > 0) {
        const supportFee = Math.round(
          (standard.urbanConsumptionExpenditure * DEFAULT_SUPPORT_YEARS * coef) / input.dependents,
        );
        items.push({
          name: '被扶养人生活费',
          formula: `${standard.urbanConsumptionExpenditure} × ${DEFAULT_SUPPORT_YEARS} 年 × ${coef.toFixed(1)} ÷ ${input.dependents} 人`,
          amount: supportFee,
          basis: '民法典第一千一百七十九条',
        });
        traceParts.push(`被扶养人生活费：${supportFee} 元`);
      }

      // 7. 精神损害抚慰金
      const mentalAmount = standard.mentalDistressScale[input.disabilityLevel - 1];
      items.push({
        name: '精神损害抚慰金',
        formula: `${input.disabilityLevel} 级伤残精神损害抚慰金（${standard.region}标准）`,
        amount: mentalAmount,
        basis: '民法典第一千一百八十三条',
      });
      traceParts.push(`精神损害抚慰金：${mentalAmount} 元`);
    }

    // 8. 汇总
    const totalAmount = items.reduce((sum, it) => sum + it.amount, 0);
    traceParts.push(`合计：${totalAmount} 元`);

    ctx.logger?.debug('CompensationQuery 计算', {
      region: input.region,
      disabilityLevel: input.disabilityLevel,
      itemCount: items.length,
      totalAmount,
      traceId: ctx.traceId,
    });

    return {
      success: true,
      data: {
        items,
        totalAmount,
        calculationTrace: traceParts.join('\n'),
      },
      lawRefs: [
        { ref: '民法典第一千一百七十九条', title: '人身损害赔偿范围', verified: true },
        { ref: '民法典第一千一百八十三条', title: '精神损害赔偿', verified: true },
      ],
      warnings: warnings.length > 0 ? warnings : undefined,
      disclaimer: DISCLAIMER,
    };
  }
}
