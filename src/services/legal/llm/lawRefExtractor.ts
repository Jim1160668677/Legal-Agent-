import type { LawRef } from '../../../types/llm';

/**
 * 法条引用提取（对齐设计文档 07 §2.6）。
 *
 * 匹配模式：`《民法典》第一百四十三条` / `民法典第143条` / `婚姻法第二十一条`
 * 命中后返回 `{ ref: '民法典第一百四十三条' }` 形式。
 *
 * MVP 阶段：仅正则提取，不查 law_article 集合校验。
 * verified 字段统一 false，待法律知识库接入后由 LlmService.validateLawRefs 补全。
 */

// 法律名：含"法"字的汉字序列（允许"民法典"等"法"不在末尾的法律名），
//        右侧由 `》?\s*第` 边界约束，避免贪婪吞掉"第"。
// 条号：汉字数字（零一二三四五六七八九十百千万）或阿拉伯数字（不含"条"字，避免吞"条"）。
const LAW_REF_PATTERN =
  /(?:《?(?<lawName>[\u4e00-\u9fa5]*法[\u4e00-\u9fa5]*)》?\s*第\s*(?<articleNo>[零一二三四五六七八九十百千万0-9]+)\s*条)/g;

export function extractLawRefs(text: string): LawRef[] {
  const refs: LawRef[] = [];
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  // 重置 lastIndex（全局正则复用）
  LAW_REF_PATTERN.lastIndex = 0;
  while ((m = LAW_REF_PATTERN.exec(text)) !== null) {
    const lawName = m.groups?.lawName;
    const articleNo = m.groups?.articleNo;
    if (!lawName || !articleNo) continue;

    const ref = `${lawName}第${articleNo}条`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    refs.push({ ref, verified: false });
  }

  return refs;
}
