/**
 * DocumentReviewer —— 文书审核工具（v2.3-W1 骨架，14-tool-design.md §七）。
 *
 * 输入：文书全文文本 + 文书类型
 * 输出：四类问题（必填项缺失/法条引用错误/格式问题/当事人信息不全）+ summary
 *
 * 算法（14 §7.4）：
 *   1. 入参长度校验（≤ 50000 字符）
 *   2. 按 docType 加载文书模板（必填项 varsSchema）
 *   3. 必填项检测（正则提取）
 *   4. 法条引用检测（正则提取 + RuleEngine 核实，v2.3-W1 简化为存在性检查）
 *   5. 格式检测（标题/此致/落款/日期格式）
 *   6. 当事人信息完整性
 *
 * v2.3-W1 骨架说明：
 *   - 不依赖 RuleEngine（法条引用核实改为正则 + LAW_ARTICLES 集合存在性检查）
 *   - 完整 LLM 辅助与精细化模板规则留 v2.4 实现
 *
 * 法条依据：
 *   - 民事诉讼法第一百二十一条（起诉状必要记载事项）
 *   - 民事诉讼法第一百二十二条（起诉条件）
 *
 * 设计依据：14-tool-design.md §七工具 4。
 */
import { Injectable } from '@nestjs/common';
import { LAW_ARTICLES } from '../../../data/lawArticles';
import {
  LegalToolError,
  TOOL_ERROR_CODES,
  type JsonSchema,
  type LegalTool,
  type ToolContext,
  type ToolId,
  type ToolResult,
} from './types';

export interface DocumentReviewerInput {
  documentText: string;
  docType: '起诉状' | '答辩状' | '合同' | '律师函' | '申请书' | '其他';
}

export interface ReviewIssue {
  type: 'missing_required' | 'invalid_law_ref' | 'format_issue' | 'incomplete_party_info';
  severity: 'error' | 'warning';
  location?: string;
  message: string;
  suggestion: string;
}

export interface DocumentReviewerOutput {
  issues: ReviewIssue[];
  summary: {
    errorCount: number;
    warningCount: number;
    passRate: number;
  };
}

const DISCLAIMER =
  '⚠️ 文书审核结果仅供参考，不构成法律意见。审核未检出问题不代表文书完全合规，请在提交前由专业律师审核。';

/** 法条引用正则：匹配"《xxx》第N条" 或 "xxx第N条" */
const LAW_REF_PATTERN =
  /(?:《)?([^《》第，。、,\s]{2,12})(?:》)?第([一二三四五六七八九十百千零〇\d]+)条/g;

/** 必填项模板（按文书类型） */
const REQUIRED_FIELDS: Record<string, Array<{ field: string; pattern: RegExp; label: string }>> = {
  起诉状: [
    { field: 'plaintiff', pattern: /原告[:：\s]*([^\n\r,，]+)/, label: '原告' },
    { field: 'defendant', pattern: /被告[:：\s]*([^\n\r,，]+)/, label: '被告' },
    { field: 'claim', pattern: /诉讼请求[:：\s]*([\s\S]+?)(?=事实和理由|$)/, label: '诉讼请求' },
    { field: 'facts', pattern: /事实和理由[:：\s]*([\s\S]+?)(?=此致|$)/, label: '事实和理由' },
    { field: 'court', pattern: /此致[\s\n]*([^\n\r,，。]+)/, label: '此致法院' },
  ],
  答辩状: [
    { field: 'respondent', pattern: /答辩人[:：\s]*([^\n\r,，]+)/, label: '答辩人' },
    { field: 'opinion', pattern: /答辩意见[:：\s]*([\s\S]+?)(?=此致|$)/, label: '答辩意见' },
    { field: 'court', pattern: /此致[\s\n]*([^\n\r,，。]+)/, label: '此致法院' },
  ],
  律师函: [
    { field: 'recipient', pattern: /(?:致|送)[:：\s]*([^\n\r,，]+)/, label: '收件人' },
    { field: 'matter', pattern: /(?:关于|就)[:：\s]*([^\n\r,，。]+)/, label: '事由' },
    {
      field: 'demand',
      pattern: /(?:要求|请求)[:：\s]*([\s\S]+?)(?=此致|特此|$)/,
      label: '要求事项',
    },
  ],
  申请书: [
    { field: 'applicant', pattern: /申请人[:：\s]*([^\n\r,，]+)/, label: '申请人' },
    { field: 'request', pattern: /申请事项[:：\s]*([\s\S]+?)(?=事实和理由|$)/, label: '申请事项' },
  ],
  合同: [
    { field: 'partyA', pattern: /甲方[:：\s]*([^\n\r,，]+)/, label: '甲方' },
    { field: 'partyB', pattern: /乙方[:：\s]*([^\n\r,，]+)/, label: '乙方' },
  ],
};

@Injectable()
export class DocumentReviewerTool implements LegalTool<
  DocumentReviewerInput,
  DocumentReviewerOutput
> {
  readonly toolId: ToolId = 'document_review';
  readonly name = '文书审核';
  readonly description = '反向校验文书必填项/法条引用/格式/当事人信息';
  readonly category = 'procedural' as const;
  readonly piiLevel = 'L3' as const;
  readonly async = false;
  readonly timeout = 8_000;
  readonly cacheable = false;
  readonly toolVersion = '0.1.0';

  readonly inputSchema: JsonSchema = {
    type: 'object',
    properties: {
      documentText: { type: 'string', maxLength: 50000 },
      docType: {
        type: 'string',
        enum: ['起诉状', '答辩状', '合同', '律师函', '申请书', '其他'],
      },
    },
    required: ['documentText', 'docType'],
  };

  readonly outputSchema: JsonSchema = {
    type: 'object',
    properties: {
      issues: { type: 'array' },
      summary: { type: 'object' },
    },
    required: ['issues', 'summary'],
  };

  async invoke(
    input: DocumentReviewerInput,
    ctx: ToolContext,
  ): Promise<ToolResult<DocumentReviewerOutput>> {
    if (input.documentText.length > 50000) {
      throw new LegalToolError(
        TOOL_ERROR_CODES.INVALID_INPUT,
        `documentText 长度超限（${input.documentText.length} > 50000）`,
        this.toolId,
        'documentText',
      );
    }

    const issues: ReviewIssue[] = [];
    const text = input.documentText;
    const docType = input.docType;

    // 1. 必填项检测
    const requiredTemplate = REQUIRED_FIELDS[docType];
    if (requiredTemplate) {
      for (const field of requiredTemplate) {
        const m = text.match(field.pattern);
        if (!m || !m[1] || m[1].trim().length === 0) {
          issues.push({
            type: 'missing_required',
            severity: 'error',
            location: field.field,
            message: `缺失必填项：${field.label}`,
            suggestion: `请补充${field.label}信息`,
          });
        }
      }
    }

    // 2. 法条引用检测
    const lawRefs = this.extractLawRefs(text);
    for (const ref of lawRefs) {
      const exists = LAW_ARTICLES.some(
        (a) => a.lawName.includes(ref.lawName) || ref.lawName.includes(a.lawName),
      );
      if (!exists) {
        issues.push({
          type: 'invalid_law_ref',
          severity: 'error',
          location: ref.raw,
          message: `法条引用可能无效：${ref.raw}`,
          suggestion: '请核实法条号或引用现行有效版本',
        });
      }
    }

    // 3. 格式检测
    if (docType === '起诉状' && !/民事起诉状/.test(text)) {
      issues.push({
        type: 'format_issue',
        severity: 'warning',
        location: '标题',
        message: '起诉状标题应含"民事起诉状"',
        suggestion: '请在文书首行添加"民事起诉状"标题',
      });
    }
    // 日期格式：YYYY年MM月DD日
    const dateMatch = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (!dateMatch) {
      issues.push({
        type: 'format_issue',
        severity: 'warning',
        location: '落款日期',
        message: '未找到标准日期格式（YYYY年MM月DD日）',
        suggestion: '请在落款处补充标准日期格式',
      });
    }
    // 落款签名
    if (
      !/签名|盖章|签章/.test(text) &&
      (docType === '起诉状' || docType === '答辩状' || docType === '申请书')
    ) {
      issues.push({
        type: 'format_issue',
        severity: 'warning',
        location: '落款',
        message: '落款未含签名/盖章',
        suggestion: '请在落款处添加"签名/盖章"提示',
      });
    }

    // 4. 当事人信息完整性
    if (docType === '起诉状' || docType === '答辩状' || docType === '申请书') {
      // 身份信息：身份证号/住所/联系方式
      const hasIdInfo = /身份证|住所|住址|联系方式|电话/.test(text);
      if (!hasIdInfo) {
        issues.push({
          type: 'incomplete_party_info',
          severity: 'warning',
          location: '当事人信息',
          message: '当事人身份信息不全（缺失身份证号/住所/联系方式）',
          suggestion: '请补充当事人身份信息（身份证号/住所/联系方式至少一项）',
        });
      }
    }
    // 法人信息：统一社会信用代码/法定代表人
    if (/有限公司|股份有限公司|企业|公司/.test(text)) {
      const hasLegalEntityInfo = /统一社会信用代码|法定代表人/.test(text);
      if (!hasLegalEntityInfo) {
        issues.push({
          type: 'incomplete_party_info',
          severity: 'warning',
          location: '法人信息',
          message: '法人当事人信息不全（缺失统一社会信用代码/法定代表人）',
          suggestion: '请补充法人统一社会信用代码与法定代表人信息',
        });
      }
    }

    // 5. 汇总
    const errorCount = issues.filter((i) => i.severity === 'error').length;
    const warningCount = issues.filter((i) => i.severity === 'warning').length;
    const totalChecks = (requiredTemplate?.length ?? 0) + lawRefs.length + 3 + 2;
    const passRate = Math.max(0, 1 - errorCount / Math.max(totalChecks, 1));

    ctx.logger?.debug('DocumentReviewer 审核', {
      docType,
      textLength: text.length,
      issueCount: issues.length,
      errorCount,
      warningCount,
      traceId: ctx.traceId,
    });

    return {
      success: true,
      data: {
        issues,
        summary: {
          errorCount,
          warningCount,
          passRate: Math.round(passRate * 100) / 100,
        },
      },
      lawRefs: [
        { ref: '民事诉讼法第一百二十一条', title: '起诉状必要记载事项', verified: true },
        { ref: '民事诉讼法第一百二十二条', title: '起诉条件', verified: true },
      ],
      disclaimer: DISCLAIMER,
    };
  }

  /** 提取文书中的法条引用 */
  private extractLawRefs(text: string): Array<{ raw: string; lawName: string; articleNo: string }> {
    const refs: Array<{ raw: string; lawName: string; articleNo: string }> = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    LAW_REF_PATTERN.lastIndex = 0;
    while ((m = LAW_REF_PATTERN.exec(text)) !== null) {
      const raw = m[0];
      if (seen.has(raw)) continue;
      seen.add(raw);
      refs.push({ raw, lawName: m[1], articleNo: `第${m[2]}条` });
    }
    return refs;
  }
}
