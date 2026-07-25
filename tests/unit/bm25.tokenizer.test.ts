/**
 * BM25 中文分词器单元测试（A2-W3）。
 *
 * 覆盖：
 *   - 中文 unigram + bigram 生成
 *   - 字母数字提取
 *   - 停用词过滤
 *   - 边界场景：空输入 / 纯英文 / 纯数字 / 混合
 *   - termFrequencies 词频统计
 */
import { describe, it, expect } from 'vitest';
import { tokenize, termFrequencies } from '../../src/modules/legal/retrieval/bm25.tokenizer';

describe('tokenize', () => {
  describe('中文分词', () => {
    it('生成 unigram + bigram', () => {
      const tokens = tokenize('民法典');
      // unigram: 民, 法, 典（无停用词）
      // bigram: 民法, 法典
      expect(tokens).toContain('民');
      expect(tokens).toContain('法');
      expect(tokens).toContain('典');
      expect(tokens).toContain('民法');
      expect(tokens).toContain('法典');
    });

    it('过滤停用词 unigram 但保留含停用词的 bigram', () => {
      const tokens = tokenize('合同的有效性');
      // "的" 是停用词，unigram 中不出现
      expect(tokens).not.toContain('的');
      // 但 bigram "有效" 保留（含法律语义，"的"未被过滤出现在 bigram 中）
      expect(tokens).toContain('有效');
      expect(tokens).toContain('的有');
    });

    it('长文本生成正确的 bigram 数量', () => {
      const text = '诉讼时效'; // 4 个中文字符
      const tokens = tokenize(text);
      // unigram: 4 个（诉, 讼, 时, 效）
      // bigram: 3 个（诉讼, 讼时, 时效）
      const unigrams = tokens.filter((t) => t.length === 1);
      const bigrams = tokens.filter((t) => t.length === 2);
      expect(unigrams).toHaveLength(4);
      expect(bigrams).toHaveLength(3);
    });
  });

  describe('字母数字提取', () => {
    it('提取连续字母数字段并小写', () => {
      const tokens = tokenize('Article 143 of Civil Code');
      expect(tokens).toContain('article');
      expect(tokens).toContain('143');
      expect(tokens).toContain('of');
      expect(tokens).toContain('civil');
      expect(tokens).toContain('code');
    });

    it('提取纯数字', () => {
      const tokens = tokenize('第143条');
      expect(tokens).toContain('143');
    });
  });

  describe('混合文本', () => {
    it('中文 + 字母数字混合', () => {
      const tokens = tokenize('民法典第143条 Article');
      expect(tokens).toContain('民');
      expect(tokens).toContain('民法');
      expect(tokens).toContain('143');
      expect(tokens).toContain('article');
    });
  });

  describe('边界场景', () => {
    it('空字符串返回空数组', () => {
      expect(tokenize('')).toEqual([]);
    });

    it('null/undefined 返回空数组', () => {
      expect(tokenize(null as unknown as string)).toEqual([]);
      expect(tokenize(undefined as unknown as string)).toEqual([]);
    });

    it('纯标点返回空数组', () => {
      expect(tokenize('，。！？')).toEqual([]);
    });

    it('纯英文返回小写 token', () => {
      const tokens = tokenize('Hello World');
      expect(tokens).toContain('hello');
      expect(tokens).toContain('world');
    });
  });
});

describe('termFrequencies', () => {
  it('统计各 token 出现次数', () => {
    const tf = termFrequencies(['民法', '法典', '民法', '诉讼']);
    expect(tf.get('民法')).toBe(2);
    expect(tf.get('法典')).toBe(1);
    expect(tf.get('诉讼')).toBe(1);
  });

  it('空数组返回空 Map', () => {
    const tf = termFrequencies([]);
    expect(tf.size).toBe(0);
  });

  it('重复 token 正确计数', () => {
    const tf = termFrequencies(['a', 'a', 'a', 'b']);
    expect(tf.get('a')).toBe(3);
    expect(tf.get('b')).toBe(1);
  });
});
