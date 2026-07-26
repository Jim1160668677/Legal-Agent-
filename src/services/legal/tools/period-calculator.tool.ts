/**
 * PeriodCalculator —— 期间计算器（v2.3-W1，14-tool-design.md §五）。
 *
 * 输入：起算日 + 期间类型（法定/指定）+ 期间长度 + 单位（日/月/年）+ 是否扣除节假日
 * 输出：截止日 + 实际天数 + 节假日扣除明细 + 计算过程
 *
 * 算法（14 §5.4）：
 *   1. 按 unit 计算初始截止日（日/月/年）
 *   2. 法定期间 deductHolidays=true：扣除周末 + 法定节假日，调休上班日加回
 *   3. 期间届满日为节假日时顺延至节后第一个工作日
 *   4. 降级：holidays 数据缺失该期间时仅扣周末
 *
 * 法条依据：
 *   - 民事诉讼法第九十二条（期间计算通则）
 *   - 民法总则第二百条（按日/月/年计算）
 *   - 民事诉讼法第九十二条第四款（届满日为节假日顺延）
 *
 * 设计依据：14-tool-design.md §五工具 2。
 */
import { Injectable } from '@nestjs/common';
import { HOLIDAY_INDEX, isHoliday } from '../../../data/holidays';
import {
  LegalToolError,
  TOOL_ERROR_CODES,
  type JsonSchema,
  type LegalTool,
  type ToolContext,
  type ToolId,
  type ToolResult,
} from './types';

export interface PeriodCalculatorInput {
  startDate: string;
  periodType: 'statutory' | 'designated';
  duration: number;
  unit: 'day' | 'month' | 'year';
  deductHolidays?: boolean;
  jurisdiction?: string;
}

export interface HolidayDeduction {
  date: string;
  reason: string;
}

export interface PeriodCalculatorOutput {
  deadline: string;
  deadlineWeekday: string;
  actualDays: number;
  holidayDeductions: HolidayDeduction[];
  calculationTrace: string;
}

const DISCLAIMER =
  '⚠️ 本计算结果仅供参考，具体以法院通知为准。如涉及重大期限，请咨询专业律师核实。';

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** ISO 日期字符串 → Date（UTC 零点，避免时区偏差） */
function parseDate(iso: string): Date {
  return new Date(iso + 'T00:00:00Z');
}

/** Date → ISO 日期字符串 */
function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 加 N 天 */
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

/** 加 N 月（保留日，月末自动顺延至当月最后一天） */
function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  const targetMonth = r.getUTCMonth() + n;
  r.setUTCMonth(targetMonth);
  // 处理月末顺延（如 1.31 + 1 月 → 2.28/29）
  if (r.getUTCMonth() !== ((targetMonth % 12) + 12) % 12) {
    r.setUTCDate(0); // 回退到上月最后一天
  }
  return r;
}

/** 加 N 年（处理闰年） */
function addYears(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCFullYear(r.getUTCFullYear() + n);
  // 2.29 + 1 年 → 2.28（非闰年）
  if (d.getUTCMonth() === 1 && d.getUTCDate() === 29 && r.getUTCMonth() !== 1) {
    r.setUTCMonth(1, 28);
  }
  return r;
}

@Injectable()
export class PeriodCalculatorTool implements LegalTool<
  PeriodCalculatorInput,
  PeriodCalculatorOutput
> {
  readonly toolId: ToolId = 'period_calculator';
  readonly name = '期间计算器';
  readonly description = '法定/指定期限推算，支持日/月/年单位与节假日扣除';
  readonly category = 'procedural' as const;
  readonly piiLevel = 'L1' as const;
  readonly async = false;
  readonly timeout = 3_000;
  readonly cacheable = true;
  readonly cacheTtl = 30 * 24 * 3_600;
  readonly toolVersion = '1.0.0';

  readonly inputSchema: JsonSchema = {
    type: 'object',
    properties: {
      startDate: { type: 'string', format: 'date', description: '起算日 ISO 8601' },
      periodType: { type: 'string', enum: ['statutory', 'designated'] },
      duration: { type: 'number', minimum: 1, maximum: 3650 },
      unit: { type: 'string', enum: ['day', 'month', 'year'] },
      deductHolidays: { type: 'boolean', default: true },
      jurisdiction: { type: 'string', default: '全国' },
    },
    required: ['startDate', 'periodType', 'duration', 'unit'],
  };

  readonly outputSchema: JsonSchema = {
    type: 'object',
    properties: {
      deadline: { type: 'string', format: 'date' },
      deadlineWeekday: { type: 'string' },
      actualDays: { type: 'number' },
      holidayDeductions: { type: 'array' },
      calculationTrace: { type: 'string' },
    },
    required: ['deadline', 'actualDays'],
  };

  async invoke(
    input: PeriodCalculatorInput,
    ctx: ToolContext,
  ): Promise<ToolResult<PeriodCalculatorOutput>> {
    const start = parseDate(input.startDate);
    if (Number.isNaN(start.getTime())) {
      throw new LegalToolError(
        TOOL_ERROR_CODES.INVALID_INPUT,
        `startDate 格式非法: ${input.startDate}`,
        this.toolId,
        'startDate',
      );
    }

    // 1. 按 unit 计算初始截止日
    let deadline: Date;
    switch (input.unit) {
      case 'day':
        deadline = addDays(start, input.duration);
        break;
      case 'month':
        deadline = addMonths(start, input.duration);
        break;
      case 'year':
        deadline = addYears(start, input.duration);
        break;
    }

    const deductions: HolidayDeduction[] = [];
    const shouldDeduct = input.deductHolidays ?? true;

    // 2. 法定期间 + 扣除节假日
    if (shouldDeduct && input.periodType === 'statutory' && input.unit === 'day') {
      // 遍历 start+1 至 deadline 区间，扣除节假日
      let cursor = addDays(start, 1);
      while (cursor.getTime() <= deadline.getTime()) {
        const reason = isHoliday(toIso(cursor));
        if (reason) {
          deductions.push({ date: toIso(cursor), reason });
          deadline = addDays(deadline, 1); // 顺延一天
        }
        cursor = addDays(cursor, 1);
      }

      // 3. 期间届满日为节假日时顺延至节后第一个工作日
      let extended = 0;
      while (true) {
        const r = isHoliday(toIso(deadline));
        if (!r) break;
        deductions.push({ date: toIso(deadline), reason: `${r}（届满日顺延）` });
        deadline = addDays(deadline, 1);
        extended++;
        if (extended > 30) break; // 防御性兜底
      }
    }

    // 4. 检查 holidays 数据是否覆盖该期间
    const holidaysCovered = this.checkHolidaysCoverage(start, deadline);
    const warnings: string[] = [];
    if (!holidaysCovered && shouldDeduct && input.periodType === 'statutory') {
      warnings.push('节假日数据未完全覆盖该期间，请核对最新放假安排');
    }

    // 5. 计算实际天数
    const actualDays = Math.round((deadline.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));

    // 6. 组装计算过程
    const trace = this.buildTrace(input, start, deadline, deductions);

    ctx.logger?.debug('PeriodCalculator 计算', {
      startDate: input.startDate,
      duration: input.duration,
      unit: input.unit,
      deadline: toIso(deadline),
      actualDays,
      deductions: deductions.length,
      traceId: ctx.traceId,
    });

    return {
      success: true,
      data: {
        deadline: toIso(deadline),
        deadlineWeekday: WEEKDAY_NAMES[deadline.getUTCDay()],
        actualDays,
        holidayDeductions: deductions,
        calculationTrace: trace,
      },
      lawRefs: [
        { ref: '民事诉讼法第九十二条', title: '期间计算通则', verified: true },
        { ref: '民法总则第二百条', title: '按日/月/年计算', verified: true },
      ],
      warnings: warnings.length > 0 ? warnings : undefined,
      disclaimer: DISCLAIMER,
    };
  }

  /** 检查 holidays 数据是否覆盖该期间 */
  private checkHolidaysCoverage(start: Date, end: Date): boolean {
    const yearStart = start.getUTCFullYear();
    const yearEnd = end.getUTCFullYear();
    // 检查每年的节假日是否都有数据
    for (let y = yearStart; y <= yearEnd; y++) {
      const hasYearData = Array.from(HOLIDAY_INDEX.values()).some(
        (h) => parseInt(h.date.slice(0, 4), 10) === y && h.type === 'holiday',
      );
      if (!hasYearData) return false;
    }
    return true;
  }

  /** 构建可读的计算过程 */
  private buildTrace(
    input: PeriodCalculatorInput,
    start: Date,
    deadline: Date,
    deductions: HolidayDeduction[],
  ): string {
    const parts: string[] = [];
    parts.push(`起算日 ${toIso(start)}`);
    parts.push(
      `+ ${input.duration} ${input.unit === 'day' ? '日' : input.unit === 'month' ? '月' : '年'}`,
    );
    if (deductions.length > 0) {
      parts.push(`- ${deductions.length} 节假日扣除`);
    }
    parts.push(`= 截止日 ${toIso(deadline)}`);
    return parts.join(' ');
  }
}
