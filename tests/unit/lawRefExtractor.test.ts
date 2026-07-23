import { describe, it, expect } from 'vitest';
import { extractLawRefs } from '../../src/services/legal/llm/lawRefExtractor';

describe('extractLawRefs', () => {
  it('匹配《民法典》第一百四十三条', () => {
    const refs = extractLawRefs('根据《民法典》第一百四十三条的规定...');
    expect(refs).toEqual([{ ref: '民法典第一百四十三条', verified: false }]);
  });

  it('匹配民法典第143条（无书名号 + 阿拉伯数字）', () => {
    const refs = extractLawRefs('民法典第143条规定了民事法律行为');
    expect(refs).toEqual([{ ref: '民法典第143条', verified: false }]);
  });

  it('匹配多个法条', () => {
    const text = '《民法典》第一百四十三条与《刑法》第二百六十四条均适用';
    const refs = extractLawRefs(text);
    expect(refs).toHaveLength(2);
    expect(refs[0].ref).toBe('民法典第一百四十三条');
    expect(refs[1].ref).toBe('刑法第二百六十四条');
  });

  it('去重相同引用', () => {
    const text = '民法典第143条...民法典第143条...民法典第143条';
    const refs = extractLawRefs(text);
    expect(refs).toHaveLength(1);
  });

  it('无匹配返回空数组', () => {
    expect(extractLawRefs('今天天气不错')).toEqual([]);
  });

  it('空字符串返回空数组', () => {
    expect(extractLawRefs('')).toEqual([]);
  });

  it('匹配带空格的引用', () => {
    const refs = extractLawRefs('民法典 第 一百四十三条 规定');
    // 注意：第和条号之间不能有空格（正则要求 \s* 在第之后）
    // 实际正则：第\s*articleNo\s*条，所以 "第 一百四十三条" 中间有空格也能匹配
    expect(refs).toEqual([{ ref: '民法典第一百四十三条', verified: false }]);
  });

  it('不匹配非"法"结尾的法律名', () => {
    // "公司法"是法律名，但"公司章程"不是
    const refs = extractLawRefs('公司章程第三条规定');
    expect(refs).toEqual([]);
  });

  it('匹配"婚姻法"', () => {
    const refs = extractLawRefs('《婚姻法》第二十一条');
    expect(refs).toEqual([{ ref: '婚姻法第二十一条', verified: false }]);
  });

  it('verified 字段统一为 false（MVP 阶段）', () => {
    const refs = extractLawRefs('民法典第143条');
    expect(refs[0].verified).toBe(false);
  });
});
