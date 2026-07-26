/**
 * 人身损害赔偿标准静态数据（v2.3-W1，14-tool-design.md §8.3）。
 *
 * 用途：CompensationQuery 工具按地区 + 伤残等级 + 收入计算赔偿项目明细。
 *
 * 覆盖范围：
 *   - 北京 / 上海 / 广东 / 江苏 / 浙江 / 全国均值 6 个地区
 *   - 数据年度：2024 年度（用于 2025 年审理的案件）
 *   - 字段：城镇居民人均可支配收入 / 城镇居民人均消费支出 / 护工日薪 / 精神损害抚慰金表
 *
 * 数据来源：各省高级人民法院发布的赔偿标准通知（2024 年度）。
 * 维护策略：每年 6 月左右各省发布新标准后手动更新。
 *
 * 简化说明（与设计文档差异）：
 *   - 设计文档 §8.4 提及 60 岁以上每增 1 岁减 1 年计算，本实现简化为按 20 年计算
 *     （不输入年龄），年龄参数留 v2.4 扩展
 *   - 农村户口与城镇户口差异暂未区分（统一按城镇标准，v2.4 扩展）
 *
 * 设计依据：14-tool-design.md §8.3 数据依赖；§8.4 核心算法。
 */

export interface CompensationStandard {
  /** 地区名（省/直辖市，如"北京"） */
  region: string;
  /** 数据年度 */
  year: number;
  /** 城镇居民人均可支配收入（元/年） */
  urbanDisposableIncome: number;
  /** 城镇居民人均消费支出（元/年） */
  urbanConsumptionExpenditure: number;
  /** 护工日薪（元/天） */
  nursingDailyWage: number;
  /** 精神损害抚慰金表（按伤残等级 1-10 级，1 级最重，单位元） */
  mentalDistressScale: number[];
}

/**
 * 2024 年度各省赔偿标准。
 *
 * 数据来源：各省高院 2024 年度人身损害赔偿标准通知。
 * 注：部分数据为公开数据合理估值，生产部署前需以官方最新发布为准。
 */
export const COMPENSATION_STANDARDS: CompensationStandard[] = [
  {
    region: '北京',
    year: 2024,
    urbanDisposableIncome: 92464,
    urbanConsumptionExpenditure: 56312,
    nursingDailyWage: 280,
    mentalDistressScale: [100000, 80000, 70000, 60000, 50000, 40000, 30000, 20000, 10000, 5000],
  },
  {
    region: '上海',
    year: 2024,
    urbanDisposableIncome: 93095,
    urbanConsumptionExpenditure: 59512,
    nursingDailyWage: 300,
    mentalDistressScale: [100000, 80000, 70000, 60000, 50000, 40000, 30000, 20000, 10000, 5000],
  },
  {
    region: '广东',
    year: 2024,
    urbanDisposableIncome: 61629,
    urbanConsumptionExpenditure: 42355,
    nursingDailyWage: 240,
    mentalDistressScale: [100000, 80000, 70000, 60000, 50000, 40000, 30000, 20000, 10000, 5000],
  },
  {
    region: '江苏',
    year: 2024,
    urbanDisposableIncome: 62689,
    urbanConsumptionExpenditure: 42197,
    nursingDailyWage: 220,
    mentalDistressScale: [100000, 80000, 70000, 60000, 50000, 40000, 30000, 20000, 10000, 5000],
  },
  {
    region: '浙江',
    year: 2024,
    urbanDisposableIncome: 68149,
    urbanConsumptionExpenditure: 45437,
    nursingDailyWage: 240,
    mentalDistressScale: [100000, 80000, 70000, 60000, 50000, 40000, 30000, 20000, 10000, 5000],
  },
  {
    region: '全国',
    year: 2024,
    urbanDisposableIncome: 52882,
    urbanConsumptionExpenditure: 34557,
    nursingDailyWage: 200,
    mentalDistressScale: [80000, 64000, 56000, 48000, 40000, 32000, 24000, 16000, 8000, 4000],
  },
];

/** 按地区名索引 */
const STANDARD_INDEX = new Map<string, CompensationStandard>(
  COMPENSATION_STANDARDS.map((s) => [s.region, s]),
);

/**
 * 按地区名查询赔偿标准。
 * 优先精确匹配，其次包含匹配（如"北京市"匹配"北京"），最后回退到全国均值。
 * @returns { standard, matched } matched=false 表示回退到全国均值
 */
export function findStandard(region: string): { standard: CompensationStandard; matched: boolean } {
  // 1. 精确匹配
  const exact = STANDARD_INDEX.get(region);
  if (exact) return { standard: exact, matched: true };

  // 2. 包含匹配（"北京市" → "北京"）
  for (const [key, value] of STANDARD_INDEX) {
    if (key === '全国') continue;
    if (region.includes(key) || key.includes(region)) {
      return { standard: value, matched: true };
    }
  }

  // 3. 回退到全国均值
  return { standard: STANDARD_INDEX.get('全国')!, matched: false };
}

/** 伤残系数：1 级=1.0，10 级=0.1（线性递减） */
export function disabilityCoefficient(level: number): number {
  if (level < 1) return 1.0;
  if (level > 10) return 0.1;
  return (11 - level) / 10;
}
