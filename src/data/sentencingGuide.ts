/**
 * 量刑指导静态数据（v2.3-W1，14-tool-design.md §10.3）。
 *
 * 用途：SentencingGuide 工具按罪名 + 情节要素输出量刑幅度 + 基准刑 + 调节比例。
 *
 * 覆盖范围：8 个常见罪名（盗窃/诈骗/抢夺/故意伤害/故意杀人/抢劫/交通肇事/敲诈勒索）
 *
 * 字段对齐 14-tool-design.md §10.2 outputSchema：
 *   - charge：罪名
 *   - tiers：量刑档次（按数额/次数/后果定位）
 *   - adjustments：情节调节比例表
 *   - lawRefs：关联法条（刑法分则条款）
 *
 * 数据来源：《最高人民法院关于常见犯罪的量刑指导意见》（法发〔2017〕7 号）
 *
 * 简化说明：
 *   - 各档次分界数值为简化版（按最高法司法解释常见区间），生产部署需以最新司法解释为准
 *   - 情节调节比例为区间中位数（如 +10% ~ +20% 取 +15%）
 *
 * 设计依据：14-tool-design.md §10.3 数据依赖；§10.4 核心算法。
 */

export interface SentencingTier {
  /** 档次名（如"数额较大"） */
  name: string;
  /** 档次定位条件（amount/times/consequence 之一） */
  condition:
    | { type: 'amount'; min: number; max: number }
    | { type: 'times'; min: number; max: number }
    | { type: 'consequence'; values: string[] }
    | { type: 'default' };
  /** 法定刑幅度（月） */
  range: { min: number; max: number };
  /** 单位：month 月 / year 年 / fixed_term 无期/死刑 */
  unit: 'month' | 'year' | 'fixed_term';
}

export interface SentencingAdjustment {
  /** 调节方向 */
  type: 'aggravating' | 'mitigating';
  /** 情节字段名（与工具入参 elements 字段对齐） */
  factor: string;
  /** 描述 */
  description: string;
  /** 调节比例（%），正为加重，负为减轻 */
  percentage: number;
}

export interface SentencingGuideEntry {
  /** 罪名（如"盗窃罪"） */
  charge: string;
  /** 量刑档次列表（按严重程度递增） */
  tiers: SentencingTier[];
  /** 情节调节比例表 */
  adjustments: SentencingAdjustment[];
  /** 关联法条（刑法分则条款） */
  lawRefs: Array<{ ref: string; title: string }>;
  /** 必填情节要素字段（缺失时抛 8007） */
  requiredElements: Array<'amount' | 'times' | 'consequence'>;
}

/**
 * 8 个常见罪名量刑指导数据。
 *
 * 单位说明：
 *   - month：刑期以月为单位
 *   - year：刑期以年为单位（5 年以下等）
 *   - fixed_term：无期徒刑/死刑（不在本工具计算范围，仅返回幅度）
 */
export const SENTENCING_GUIDE: SentencingGuideEntry[] = [
  {
    charge: '盗窃罪',
    tiers: [
      {
        name: '数额较大',
        condition: { type: 'amount', min: 1000, max: 3000 },
        range: { min: 6, max: 36 },
        unit: 'month',
      },
      {
        name: '数额巨大',
        condition: { type: 'amount', min: 3000, max: 30000 },
        range: { min: 36, max: 120 },
        unit: 'month',
      },
      {
        name: '数额特别巨大',
        condition: { type: 'amount', min: 30000, max: Number.MAX_SAFE_INTEGER },
        range: { min: 120, max: 180 },
        unit: 'month',
      },
    ],
    adjustments: [
      {
        type: 'aggravating',
        factor: 'priorConviction',
        description: '有前科累犯',
        percentage: 15,
      },
      { type: 'mitigating', factor: 'surrender', description: '自首', percentage: -25 },
      { type: 'mitigating', factor: 'merit', description: '立功', percentage: -15 },
    ],
    lawRefs: [{ ref: '刑法第二百六十四条', title: '盗窃罪' }],
    requiredElements: ['amount'],
  },
  {
    charge: '诈骗罪',
    tiers: [
      {
        name: '数额较大',
        condition: { type: 'amount', min: 3000, max: 10000 },
        range: { min: 6, max: 36 },
        unit: 'month',
      },
      {
        name: '数额巨大',
        condition: { type: 'amount', min: 10000, max: 500000 },
        range: { min: 36, max: 120 },
        unit: 'month',
      },
      {
        name: '数额特别巨大',
        condition: { type: 'amount', min: 500000, max: Number.MAX_SAFE_INTEGER },
        range: { min: 120, max: 180 },
        unit: 'month',
      },
    ],
    adjustments: [
      { type: 'aggravating', factor: 'priorConviction', description: '有前科累犯', percentage: 15 },
      { type: 'mitigating', factor: 'surrender', description: '自首', percentage: -25 },
      { type: 'mitigating', factor: 'merit', description: '立功', percentage: -15 },
    ],
    lawRefs: [{ ref: '刑法第二百六十六条', title: '诈骗罪' }],
    requiredElements: ['amount'],
  },
  {
    charge: '抢夺罪',
    tiers: [
      {
        name: '数额较大',
        condition: { type: 'amount', min: 1000, max: 3000 },
        range: { min: 6, max: 36 },
        unit: 'month',
      },
      {
        name: '数额巨大',
        condition: { type: 'amount', min: 3000, max: 30000 },
        range: { min: 36, max: 120 },
        unit: 'month',
      },
      {
        name: '数额特别巨大',
        condition: { type: 'amount', min: 30000, max: Number.MAX_SAFE_INTEGER },
        range: { min: 120, max: 180 },
        unit: 'month',
      },
    ],
    adjustments: [
      { type: 'aggravating', factor: 'priorConviction', description: '有前科累犯', percentage: 15 },
      { type: 'mitigating', factor: 'surrender', description: '自首', percentage: -25 },
      { type: 'mitigating', factor: 'merit', description: '立功', percentage: -15 },
    ],
    lawRefs: [{ ref: '刑法第二百六十七条', title: '抢夺罪' }],
    requiredElements: ['amount'],
  },
  {
    charge: '故意伤害罪',
    tiers: [
      {
        name: '轻伤',
        condition: { type: 'consequence', values: ['轻伤', '轻微伤'] },
        range: { min: 6, max: 36 },
        unit: 'month',
      },
      {
        name: '重伤',
        condition: { type: 'consequence', values: ['重伤'] },
        range: { min: 36, max: 120 },
        unit: 'month',
      },
      {
        name: '致死',
        condition: { type: 'consequence', values: ['死亡', '致死'] },
        range: { min: 120, max: 180 },
        unit: 'month',
      },
    ],
    adjustments: [
      { type: 'aggravating', factor: 'priorConviction', description: '有前科累犯', percentage: 15 },
      { type: 'mitigating', factor: 'surrender', description: '自首', percentage: -25 },
      { type: 'mitigating', factor: 'merit', description: '立功', percentage: -15 },
    ],
    lawRefs: [{ ref: '刑法第二百三十四条', title: '故意伤害罪' }],
    requiredElements: ['consequence'],
  },
  {
    charge: '故意杀人罪',
    tiers: [
      {
        name: '未遂/情节较轻',
        condition: { type: 'default' },
        range: { min: 36, max: 120 },
        unit: 'month',
      },
      {
        name: '既遂',
        condition: { type: 'consequence', values: ['死亡', '致死'] },
        range: { min: 120, max: 180 },
        unit: 'month',
      },
    ],
    adjustments: [
      { type: 'aggravating', factor: 'priorConviction', description: '有前科累犯', percentage: 15 },
      { type: 'mitigating', factor: 'surrender', description: '自首', percentage: -25 },
      { type: 'mitigating', factor: 'merit', description: '立功', percentage: -15 },
    ],
    lawRefs: [{ ref: '刑法第二百三十二条', title: '故意杀人罪' }],
    requiredElements: ['consequence'],
  },
  {
    charge: '抢劫罪',
    tiers: [
      {
        name: '一般抢劫',
        condition: { type: 'default' },
        range: { min: 36, max: 120 },
        unit: 'month',
      },
      {
        name: '加重抢劫',
        condition: { type: 'times', min: 2, max: Number.MAX_SAFE_INTEGER },
        range: { min: 120, max: 180 },
        unit: 'month',
      },
    ],
    adjustments: [
      { type: 'aggravating', factor: 'priorConviction', description: '有前科累犯', percentage: 15 },
      { type: 'mitigating', factor: 'surrender', description: '自首', percentage: -25 },
      { type: 'mitigating', factor: 'merit', description: '立功', percentage: -15 },
    ],
    lawRefs: [{ ref: '刑法第二百六十三条', title: '抢劫罪' }],
    requiredElements: ['times'],
  },
  {
    charge: '交通肇事罪',
    tiers: [
      {
        name: '一般事故',
        condition: { type: 'consequence', values: ['重伤'] },
        range: { min: 6, max: 36 },
        unit: 'month',
      },
      {
        name: '重大事故',
        condition: { type: 'consequence', values: ['死亡', '致死'] },
        range: { min: 36, max: 84 },
        unit: 'month',
      },
    ],
    adjustments: [
      { type: 'aggravating', factor: 'priorConviction', description: '有前科累犯', percentage: 15 },
      { type: 'mitigating', factor: 'surrender', description: '自首', percentage: -25 },
      { type: 'mitigating', factor: 'merit', description: '立功', percentage: -15 },
    ],
    lawRefs: [{ ref: '刑法第一百三十三条', title: '交通肇事罪' }],
    requiredElements: ['consequence'],
  },
  {
    charge: '敲诈勒索罪',
    tiers: [
      {
        name: '数额较大',
        condition: { type: 'amount', min: 2000, max: 5000 },
        range: { min: 6, max: 36 },
        unit: 'month',
      },
      {
        name: '数额巨大',
        condition: { type: 'amount', min: 5000, max: 100000 },
        range: { min: 36, max: 120 },
        unit: 'month',
      },
      {
        name: '数额特别巨大',
        condition: { type: 'amount', min: 100000, max: Number.MAX_SAFE_INTEGER },
        range: { min: 120, max: 180 },
        unit: 'month',
      },
    ],
    adjustments: [
      { type: 'aggravating', factor: 'priorConviction', description: '有前科累犯', percentage: 15 },
      { type: 'mitigating', factor: 'surrender', description: '自首', percentage: -25 },
      { type: 'mitigating', factor: 'merit', description: '立功', percentage: -15 },
    ],
    lawRefs: [{ ref: '刑法第二百七十四条', title: '敲诈勒索罪' }],
    requiredElements: ['amount'],
  },
];

/** 按罪名索引（精确匹配 + 包含匹配） */
export function findGuide(charge: string): SentencingGuideEntry | null {
  // 1. 精确匹配
  const exact = SENTENCING_GUIDE.find((g) => g.charge === charge);
  if (exact) return exact;

  // 2. 包含匹配（"盗窃" → "盗窃罪"）
  const contains = SENTENCING_GUIDE.find(
    (g) => g.charge.includes(charge) || charge.includes(g.charge.replace('罪', '')),
  );
  return contains ?? null;
}
