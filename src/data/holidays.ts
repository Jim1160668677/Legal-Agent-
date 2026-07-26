/**
 * 法定节假日静态数据（v2.3-W1，14-tool-design.md §5.3）。
 *
 * 用途：PeriodCalculator 工具按 deductHolidays=true 扣除法定节假日。
 *
 * 覆盖范围：2024-2026 年全国法定节假日 + 调休安排（来源：国务院办公厅通知）。
 * 维护策略：每年初手动更新（年初国务院发布当年放假安排后追加）。
 *
 * 字段说明：
 *   - date：节假日日期（ISO 8601 YYYY-MM-DD）
 *   - name：节假日名称（如"国庆节"/"调休"）
 *   - type：holiday（法定节假日）/ adjusted_workday（调休上班日，需补班）
 *
 * 调休上班日（adjusted_workday）落在周末但需按工作日计算，
 * PeriodCalculator 在扣除节假日时需将这类日期"加回"工作日。
 *
 * 设计依据：14-tool-design.md §5.3 数据依赖；§5.4 核心算法步骤 3。
 */

export interface HolidayEntry {
  /** 日期 ISO 8601 */
  date: string;
  /** 节假日名称 */
  name: string;
  /** 类型：holiday 法定节假日 / adjusted_workday 调休上班日 */
  type: 'holiday' | 'adjusted_workday';
}

/**
 * 2024-2026 年法定节假日 + 调休上班日。
 *
 * 数据来源：国务院办公厅关于 2024/2025/2026 年部分节假日安排的通知。
 */
export const HOLIDAYS: HolidayEntry[] = [
  // ===== 2024 年 =====
  // 元旦
  { date: '2024-01-01', name: '元旦', type: 'holiday' },
  // 春节
  { date: '2024-02-10', name: '春节', type: 'holiday' },
  { date: '2024-02-11', name: '春节', type: 'holiday' },
  { date: '2024-02-12', name: '春节', type: 'holiday' },
  { date: '2024-02-13', name: '春节', type: 'holiday' },
  { date: '2024-02-14', name: '春节', type: 'holiday' },
  { date: '2024-02-15', name: '春节', type: 'holiday' },
  { date: '2024-02-16', name: '春节', type: 'holiday' },
  { date: '2024-02-17', name: '春节', type: 'holiday' },
  { date: '2024-02-04', name: '春节调休', type: 'adjusted_workday' },
  { date: '2024-02-18', name: '春节调休', type: 'adjusted_workday' },
  // 清明
  { date: '2024-04-04', name: '清明节', type: 'holiday' },
  { date: '2024-04-05', name: '清明节', type: 'holiday' },
  { date: '2024-04-06', name: '清明节', type: 'holiday' },
  { date: '2024-04-07', name: '清明调休', type: 'adjusted_workday' },
  // 劳动节
  { date: '2024-05-01', name: '劳动节', type: 'holiday' },
  { date: '2024-05-02', name: '劳动节', type: 'holiday' },
  { date: '2024-05-03', name: '劳动节', type: 'holiday' },
  { date: '2024-05-04', name: '劳动节', type: 'holiday' },
  { date: '2024-05-05', name: '劳动节', type: 'holiday' },
  { date: '2024-04-28', name: '劳动节调休', type: 'adjusted_workday' },
  { date: '2024-05-11', name: '劳动节调休', type: 'adjusted_workday' },
  // 端午
  { date: '2024-06-10', name: '端午节', type: 'holiday' },
  // 中秋
  { date: '2024-09-15', name: '中秋节', type: 'holiday' },
  { date: '2024-09-16', name: '中秋节', type: 'holiday' },
  { date: '2024-09-17', name: '中秋节', type: 'holiday' },
  { date: '2024-09-14', name: '中秋调休', type: 'adjusted_workday' },
  // 国庆
  { date: '2024-10-01', name: '国庆节', type: 'holiday' },
  { date: '2024-10-02', name: '国庆节', type: 'holiday' },
  { date: '2024-10-03', name: '国庆节', type: 'holiday' },
  { date: '2024-10-04', name: '国庆节', type: 'holiday' },
  { date: '2024-10-05', name: '国庆节', type: 'holiday' },
  { date: '2024-10-06', name: '国庆节', type: 'holiday' },
  { date: '2024-10-07', name: '国庆节', type: 'holiday' },
  { date: '2024-09-29', name: '国庆调休', type: 'adjusted_workday' },
  { date: '2024-10-12', name: '国庆调休', type: 'adjusted_workday' },

  // ===== 2025 年 =====
  // 元旦
  { date: '2025-01-01', name: '元旦', type: 'holiday' },
  // 春节
  { date: '2025-01-28', name: '春节', type: 'holiday' },
  { date: '2025-01-29', name: '春节', type: 'holiday' },
  { date: '2025-01-30', name: '春节', type: 'holiday' },
  { date: '2025-01-31', name: '春节', type: 'holiday' },
  { date: '2025-02-01', name: '春节', type: 'holiday' },
  { date: '2025-02-02', name: '春节', type: 'holiday' },
  { date: '2025-02-03', name: '春节', type: 'holiday' },
  { date: '2025-02-04', name: '春节', type: 'holiday' },
  { date: '2025-01-26', name: '春节调休', type: 'adjusted_workday' },
  { date: '2025-02-08', name: '春节调休', type: 'adjusted_workday' },
  // 清明
  { date: '2025-04-04', name: '清明节', type: 'holiday' },
  { date: '2025-04-05', name: '清明节', type: 'holiday' },
  { date: '2025-04-06', name: '清明节', type: 'holiday' },
  // 劳动节
  { date: '2025-05-01', name: '劳动节', type: 'holiday' },
  { date: '2025-05-02', name: '劳动节', type: 'holiday' },
  { date: '2025-05-03', name: '劳动节', type: 'holiday' },
  { date: '2025-05-04', name: '劳动节', type: 'holiday' },
  { date: '2025-05-05', name: '劳动节', type: 'holiday' },
  { date: '2025-04-27', name: '劳动节调休', type: 'adjusted_workday' },
  // 端午
  { date: '2025-05-31', name: '端午节', type: 'holiday' },
  { date: '2025-06-01', name: '端午节', type: 'holiday' },
  { date: '2025-06-02', name: '端午节', type: 'holiday' },
  // 中秋+国庆
  { date: '2025-10-01', name: '国庆节', type: 'holiday' },
  { date: '2025-10-02', name: '国庆节', type: 'holiday' },
  { date: '2025-10-03', name: '国庆节', type: 'holiday' },
  { date: '2025-10-04', name: '中秋节', type: 'holiday' },
  { date: '2025-10-05', name: '国庆节', type: 'holiday' },
  { date: '2025-10-06', name: '国庆节', type: 'holiday' },
  { date: '2025-10-07', name: '国庆节', type: 'holiday' },
  { date: '2025-10-08', name: '国庆节', type: 'holiday' },
  { date: '2025-09-28', name: '国庆调休', type: 'adjusted_workday' },
  { date: '2025-10-11', name: '国庆调休', type: 'adjusted_workday' },

  // ===== 2026 年 =====
  // 元旦
  { date: '2026-01-01', name: '元旦', type: 'holiday' },
  { date: '2026-01-02', name: '元旦', type: 'holiday' },
  { date: '2026-01-03', name: '元旦', type: 'holiday' },
  // 春节（2026-02-17 除夕）
  { date: '2026-02-17', name: '春节', type: 'holiday' },
  { date: '2026-02-18', name: '春节', type: 'holiday' },
  { date: '2026-02-19', name: '春节', type: 'holiday' },
  { date: '2026-02-20', name: '春节', type: 'holiday' },
  { date: '2026-02-21', name: '春节', type: 'holiday' },
  { date: '2026-02-22', name: '春节', type: 'holiday' },
  { date: '2026-02-23', name: '春节', type: 'holiday' },
  { date: '2026-02-15', name: '春节调休', type: 'adjusted_workday' },
  { date: '2026-02-28', name: '春节调休', type: 'adjusted_workday' },
  // 清明
  { date: '2026-04-04', name: '清明节', type: 'holiday' },
  { date: '2026-04-05', name: '清明节', type: 'holiday' },
  { date: '2026-04-06', name: '清明节', type: 'holiday' },
  // 劳动节
  { date: '2026-05-01', name: '劳动节', type: 'holiday' },
  { date: '2026-05-02', name: '劳动节', type: 'holiday' },
  { date: '2026-05-03', name: '劳动节', type: 'holiday' },
  { date: '2026-05-04', name: '劳动节', type: 'holiday' },
  { date: '2026-05-05', name: '劳动节', type: 'holiday' },
  { date: '2026-04-26', name: '劳动节调休', type: 'adjusted_workday' },
  // 端午
  { date: '2026-06-19', name: '端午节', type: 'holiday' },
  { date: '2026-06-20', name: '端午节', type: 'holiday' },
  { date: '2026-06-21', name: '端午节', type: 'holiday' },
  // 中秋
  { date: '2026-09-25', name: '中秋节', type: 'holiday' },
  { date: '2026-09-26', name: '中秋节', type: 'holiday' },
  { date: '2026-09-27', name: '中秋节', type: 'holiday' },
  // 国庆
  { date: '2026-10-01', name: '国庆节', type: 'holiday' },
  { date: '2026-10-02', name: '国庆节', type: 'holiday' },
  { date: '2026-10-03', name: '国庆节', type: 'holiday' },
  { date: '2026-10-04', name: '国庆节', type: 'holiday' },
  { date: '2026-10-05', name: '国庆节', type: 'holiday' },
  { date: '2026-10-06', name: '国庆节', type: 'holiday' },
  { date: '2026-10-07', name: '国庆节', type: 'holiday' },
  { date: '2026-10-08', name: '国庆节', type: 'holiday' },
  { date: '2026-09-27', name: '国庆调休', type: 'adjusted_workday' },
  { date: '2026-10-10', name: '国庆调休', type: 'adjusted_workday' },
];

/** 按日期索引的节假日 Map（O(1) 查询） */
export const HOLIDAY_INDEX: Map<string, HolidayEntry> = (() => {
  const m = new Map<string, HolidayEntry>();
  for (const h of HOLIDAYS) {
    // 同一日期可能既是 holiday 又是 adjusted_workday（如 2025-10-04 中秋+国庆），
    // holiday 优先（节假日当天不上班）
    if (!m.has(h.date) || h.type === 'holiday') {
      m.set(h.date, h);
    }
  }
  return m;
})();

/**
 * 判断某日期是否为法定节假日（含周末，不含调休上班日）。
 * @param dateIso ISO 8601 日期字符串
 * @returns 节假日名称（命中）/ null（非节假日）
 */
export function isHoliday(dateIso: string): string | null {
  const entry = HOLIDAY_INDEX.get(dateIso);
  if (entry && entry.type === 'holiday') {
    return entry.name;
  }
  // 周末判定
  const day = new Date(dateIso + 'T00:00:00').getUTCDay();
  if (day === 0 || day === 6) {
    // 周末若为调休上班日，则不算节假日
    if (entry?.type === 'adjusted_workday') {
      return null;
    }
    return day === 0 ? '周日' : '周六';
  }
  return null;
}

/**
 * 判断某日期是否为工作日（周一至周五非节假日，或调休上班日）。
 */
export function isWorkday(dateIso: string): boolean {
  return isHoliday(dateIso) === null;
}
