/**
 * 中文数字 → 阿拉伯数字解析（A1-W3）。
 *
 * 用途：RuleEngine 按"民法典第一百四十三条"做精确匹配时，
 * 需将条号统一为整数键，兼容"第一百四十三""第143""143"等写法。
 *
 * 支持范围：0 - 9999（覆盖现行法律条号上限，刑法 452 条、民法典 1260 条）。
 *
 * 设计依据：07 §2.6 法条引用格式；《民法典》《刑法》条号命名约定。
 */

const DIGIT_MAP: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const UNIT_MAP: Record<string, number> = {
  十: 10,
  百: 100,
  千: 1000,
};

/**
 * 解析中文数字字符串为整数。
 * @param s 形如 "一百四十三" / "二十" / "九" / "一千零六十"
 * @returns 整数；无法解析返回 NaN
 */
export function parseChineseNumeral(s: string): number {
  if (!s) return NaN;

  const trimmed = s.trim();
  if (!trimmed) return NaN;

  // 纯阿拉伯数字直接返回
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  let total = 0;
  let current = 0; // 当前段累积的数字（千/百/十单位前的系数）

  for (const ch of trimmed) {
    if (ch in DIGIT_MAP) {
      current = DIGIT_MAP[ch];
    } else if (ch in UNIT_MAP) {
      const unit = UNIT_MAP[ch];
      // 系数为 0 时（如"十"单独出现表示 10），按 1 处理
      if (current === 0) current = 1;
      total += current * unit;
      current = 0;
    } else {
      // 非法字符
      return NaN;
    }
  }

  // 末尾剩余的个位（如 "一百四十三" 的 "三"）
  total += current;

  return total;
}

/**
 * 从法条引用字符串中提取条号整数。
 * @param articleNo 形如 "第一百四十三条" / "第143条" / "143" / "一百四十三"
 * @returns 整数；无法解析返回 NaN
 */
export function extractArticleNoInt(articleNo: string): number {
  if (!articleNo) return NaN;
  // 去掉"第"和"条"
  const cleaned = articleNo.replace(/^第/, '').replace(/条$/, '').trim();
  return parseChineseNumeral(cleaned);
}
