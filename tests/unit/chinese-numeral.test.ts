/**
 * chinese-numeral 单元测试（A1-W3 中文数字解析）。
 *
 * 覆盖：
 *   - 纯阿拉伯数字直通
 *   - 单/多位中文数字（一、九、二十、一百四十三、一千零六十）
 *   - "第…条" 包裹写法 extractArticleNoInt
 *   - 空/非法输入 → NaN
 *
 * 设计依据：07 §2.6 法条引用格式。
 */
import { describe, it, expect } from 'vitest';
import { parseChineseNumeral, extractArticleNoInt } from '../../src/modules/legal/rule/chinese-numeral';

describe('parseChineseNumeral（中文数字 → 整数）', () => {
  it('纯阿拉伯数字直接返回', () => {
    expect(parseChineseNumeral('143')).toBe(143);
    expect(parseChineseNumeral('0')).toBe(0);
    expect(parseChineseNumeral(' 42 ')).toBe(42);
  });

  it('单位以内基础数字', () => {
    expect(parseChineseNumeral('一')).toBe(1);
    expect(parseChineseNumeral('九')).toBe(9);
    expect(parseChineseNumeral('零')).toBe(0);
    expect(parseChineseNumeral('十')).toBe(10);
    expect(parseChineseNumeral('二十')).toBe(20);
    expect(parseChineseNumeral('一百')).toBe(100);
    expect(parseChineseNumeral('一千')).toBe(1000);
  });

  it('组合数字', () => {
    expect(parseChineseNumeral('一百四十三')).toBe(143);
    expect(parseChineseNumeral('一千零六十')).toBe(1060);
    expect(parseChineseNumeral('两')).toBe(2);
    expect(parseChineseNumeral('一百二十三')).toBe(123);
    expect(parseChineseNumeral('九千九百九十九')).toBe(9999);
  });

  it('空/非法输入 → NaN', () => {
    expect(parseChineseNumeral('')).toBeNaN();
    expect(parseChineseNumeral('  ')).toBeNaN();
    expect(parseChineseNumeral('abc')).toBeNaN();
    expect(parseChineseNumeral('一x二')).toBeNaN();
  });
});

describe('extractArticleNoInt（法条引用 → 条号整数）', () => {
  it('"第…条" 包裹写法', () => {
    expect(extractArticleNoInt('第一百四十三条')).toBe(143);
    expect(extractArticleNoInt('第一百四十三')).toBe(143);
    expect(extractArticleNoInt('第143条')).toBe(143);
  });

  it('裸数字/中文', () => {
    expect(extractArticleNoInt('143')).toBe(143);
    expect(extractArticleNoInt('一百四十三')).toBe(143);
  });

  it('无"第/条"包裹的纯数字', () => {
    expect(extractArticleNoInt('二十条')).toBe(20);
  });

  it('空/非法 → NaN', () => {
    expect(extractArticleNoInt('')).toBeNaN();
    expect(extractArticleNoInt('第x条')).toBeNaN();
  });
});