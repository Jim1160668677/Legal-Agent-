/**
 * BM25 中文分词器（A2-W3）。
 *
 * 无外部依赖的中文分词方案（无 jieba/nodejieba），适合开发/测试与小规模数据：
 *   1. 提取连续中文字符段与连续字母数字段
 *   2. 中文段：生成字符 unigram + 2-char bigram（滑动窗口）
 *      - bigram 捕获中文法律高频双字词（民法/诉讼/合同/时效 等）
 *   3. 字母数字段：整体小写保留（如 "民法典143" 中的数字）
 *   4. 过滤停用词（仅过滤虚词/语气词，保留否定词"不/无"等法律语义关键字符）
 *
 * 设计依据：A2 §4.2 BM25 召回；中文 IR 无词典分词通用做法（bigram 模型）。
 */

/** 停用词表（仅高频虚词/语气词，保留法律语义相关否定词） */
const STOP_WORDS = new Set<string>([
  '的',
  '了',
  '是',
  '在',
  '和',
  '与',
  '或',
  '等',
  '对',
  '为',
  '以',
  '及',
  '其',
  '之',
  '也',
  '都',
  '就',
  '个',
  '这',
  '那',
  '该',
  '本',
  '各',
  '每',
  '上',
  '下',
  '中',
  '内',
  '外',
  '前',
  '后',
  '但',
  '而',
  '且',
  '如',
  '若',
  '因',
  '由',
  '从',
  '向',
  '到',
  '于',
  '将',
  '被',
  '把',
  '给',
  '让',
  '使',
  '令',
  '得',
  '着',
  '过',
  '来',
  '去',
  '起',
  '出',
  '入',
  '进',
  '回',
  '同',
  '并',
  '则',
  '所',
  '者',
  '的',
  '地',
]);

/** 匹配连续中文字符 */
const CJK_PATTERN = /[\u4e00-\u9fff]+/g;

/** 匹配连续字母数字（含中文数字转写后的阿拉伯数字） */
const ALNUM_PATTERN = /[a-zA-Z0-9]+/g;

/**
 * 中文文本分词。
 * @param text 原始文本
 * @returns token 数组（已去停用词，含 unigram + bigram）
 */
export function tokenize(text: string): string[] {
  if (!text || typeof text !== 'string') return [];

  const tokens: string[] = [];

  // 1. 处理中文字符段：生成 unigram + bigram
  const cjkMatches = text.match(CJK_PATTERN) ?? [];
  for (const segment of cjkMatches) {
    for (let i = 0; i < segment.length; i++) {
      const char = segment[i];
      if (!STOP_WORDS.has(char)) {
        tokens.push(char); // unigram
      }
      if (i + 1 < segment.length) {
        const bigram = segment[i] + segment[i + 1];
        // bigram 不过滤停用词（"的不" rare，"无效" 保留）
        tokens.push(bigram);
      }
    }
  }

  // 2. 处理字母数字段：整体小写
  const alnumMatches = text.match(ALNUM_PATTERN) ?? [];
  for (const token of alnumMatches) {
    tokens.push(token.toLowerCase());
  }

  return tokens;
}

/**
 * 计算文档 token 频次表（用于 BM25 索引构建）。
 * @param tokens 分词后的 token 数组
 * @returns Map<token, tf>
 */
export function termFrequencies(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  return tf;
}
