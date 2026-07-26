/**
 * LawValidityQuery —— 法条效力查询工具（v2.3-W1，14-tool-design.md §四）。
 *
 * 输入：lawName + articleNo 或 articleRef
 * 输出：现行有效状态 + 颁布机关 + 生效日期 + 法律位阶 + 修订历史
 *
 * 数据源：src/data/lawArticles.ts（31 条种子法条，含 legalHierarchy/status）
 *
 * 算法（14 §4.4）：
 *   1. 解析输入（articleRef → lawName + articleNo）
 *   2. 中文条号 → articleNoInt（复用 chinese-numeral.ts）
 *   3. 在 LAW_ARTICLES 中按 lawName + articleNoInt 精确查
 *   4. 未命中尝试 lawShortName 模糊匹配
 *   5. 仍未命中返回 found=false（不抛 8005）
 *
 * 设计依据：14-tool-design.md §4 工具 1。
 */
import { Injectable } from '@nestjs/common';
import { LAW_ARTICLES, type LawArticleData } from '../../../data/lawArticles';
import { parseChineseNumeral } from '../../../modules/legal/rule/chinese-numeral';
import {
  LegalToolError,
  TOOL_ERROR_CODES,
  type JsonSchema,
  type LegalTool,
  type ToolContext,
  type ToolId,
  type ToolResult,
} from './types';

/** LawValidityQuery 输入 */
export interface LawValidityInput {
  lawName?: string;
  articleNo?: string;
  articleRef?: string;
}

/** LawValidityQuery 输出 */
export interface LawValidityOutput {
  found: boolean;
  lawName?: string;
  articleNo?: string;
  title?: string;
  content?: string;
  status?: 'effective' | 'repealed' | 'amended';
  legalHierarchy?: string;
  statusBadge?: 'effective_green' | 'repealed_red' | 'amended_amber';
  sourceUrl?: string;
}

const DISCLAIMER = '⚠️ 法条效力信息仅供参考，以官方发布为准。如需正式法律意见，请咨询专业律师。';

/** 从 articleRef 解析 lawName + articleNo（如"民法典第143条"） */
function parseArticleRef(ref: string): { lawName: string; articleNo: string } | null {
  // 匹配"《xxx》第N条" 或 "xxx第N条"
  const m = ref.match(/^(?:《)?([^《》第]+?)(?:》)?第([一二三四五六七八九十百千零〇\d]+)条/);
  if (!m) return null;
  return { lawName: m[1], articleNo: `第${m[2]}条` };
}

/** 中文条号 → articleNoInt（如"第一百四十三条" → 143，"143" → 143） */
function toArticleNoInt(articleNo: string): number | null {
  const trimmed = articleNo.trim();

  // 1. 纯数字直接返回（如 "143"）
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);

  // 2. 提取"第X条"中的 X
  const m = trimmed.match(/第([一二三四五六七八九十百千零〇\d]+)条/);
  if (!m) return null;
  const s = m[1];
  // 纯数字
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  // 中文数字
  try {
    const n = parseChineseNumeral(s);
    return Number.isNaN(n) ? null : n;
  } catch {
    return null;
  }
}

@Injectable()
export class LawValidityTool implements LegalTool<LawValidityInput, LawValidityOutput> {
  readonly toolId: ToolId = 'law_validity';
  readonly name = '法条效力查询';
  readonly description = '查询法条现行有效状态、颁布机关、生效日期、修订历史、法律位阶';
  readonly category = 'general' as const;
  readonly piiLevel = 'L1' as const;
  readonly async = false;
  readonly timeout = 3_000;
  readonly cacheable = true;
  readonly cacheTtl = 7 * 24 * 3_600;
  readonly toolVersion = '1.0.0';

  readonly inputSchema: JsonSchema = {
    type: 'object',
    properties: {
      lawName: { type: 'string', description: '法律名称，如"民法典"' },
      articleNo: { type: 'string', description: '法条号，如"第一百四十三条"或"143"' },
      articleRef: { type: 'string', description: '完整引用，如"民法典第143条"' },
    },
    oneOf: [{ required: ['lawName', 'articleNo'] }, { required: ['articleRef'] }],
  };

  readonly outputSchema: JsonSchema = {
    type: 'object',
    properties: {
      found: { type: 'boolean' },
      lawName: { type: 'string' },
      articleNo: { type: 'string' },
      title: { type: 'string' },
      content: { type: 'string' },
      status: { type: 'string', enum: ['effective', 'repealed', 'amended'] },
      legalHierarchy: { type: 'string' },
      statusBadge: {
        type: 'string',
        enum: ['effective_green', 'repealed_red', 'amended_amber'],
      },
      sourceUrl: { type: 'string' },
    },
    required: ['found'],
  };

  async invoke(input: LawValidityInput, ctx: ToolContext): Promise<ToolResult<LawValidityOutput>> {
    // 1. 解析输入
    let lawName = input.lawName;
    let articleNo = input.articleNo;

    if (!lawName || !articleNo) {
      if (!input.articleRef) {
        throw new LegalToolError(
          TOOL_ERROR_CODES.INVALID_INPUT,
          '须提供 lawName+articleNo 或 articleRef',
          this.toolId,
        );
      }
      const parsed = parseArticleRef(input.articleRef);
      if (!parsed) {
        throw new LegalToolError(
          TOOL_ERROR_CODES.INVALID_INPUT,
          `articleRef 格式无法解析: ${input.articleRef}`,
          this.toolId,
          'articleRef',
        );
      }
      lawName = parsed.lawName;
      articleNo = parsed.articleNo;
    }

    const articleNoInt = toArticleNoInt(articleNo);
    if (articleNoInt === null) {
      throw new LegalToolError(
        TOOL_ERROR_CODES.INVALID_INPUT,
        `条号格式无法解析: ${articleNo}`,
        this.toolId,
        'articleNo',
      );
    }

    ctx.logger?.debug('LawValidityTool 查询', {
      lawName,
      articleNo,
      articleNoInt,
      traceId: ctx.traceId,
    });

    // 2. 精确匹配
    let article: LawArticleData | undefined = LAW_ARTICLES.find(
      (a) => a.lawName === lawName && a.articleNoInt === articleNoInt,
    );

    // 3. 模糊匹配（lawShortName：如"民法典" → "中华人民共和国民法典"）
    if (!article) {
      article = LAW_ARTICLES.find(
        (a) =>
          (a.lawName.includes(lawName!) || lawName!.includes(a.lawName)) &&
          a.articleNoInt === articleNoInt,
      );
    }

    // 4. 未命中返回 found=false（不抛 8005，由 UI 决定展示）
    if (!article) {
      return {
        success: true,
        data: { found: false, lawName, articleNo },
        lawRefs: [],
        disclaimer: DISCLAIMER,
      };
    }

    // 5. 组装输出
    const statusBadge =
      article.status === 'effective'
        ? 'effective_green'
        : article.status === 'repealed'
          ? 'repealed_red'
          : 'amended_amber';

    const title = `${article.lawName} ${article.articleNo}`;

    return {
      success: true,
      data: {
        found: true,
        lawName: article.lawName,
        articleNo: article.articleNo,
        title,
        content: article.content,
        status: article.status,
        legalHierarchy: article.legalHierarchy,
        statusBadge,
        sourceUrl: 'https://flk.npc.gov.cn',
      },
      lawRefs: [
        {
          ref: `${article.lawName}${article.articleNo}`,
          title,
          verified: true,
        },
      ],
      disclaimer: DISCLAIMER,
    };
  }
}
