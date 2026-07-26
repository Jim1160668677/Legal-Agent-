/**
 * LicenseOcr —— 证照 OCR 工具（v2.3-W1 骨架，14-tool-design.md §六）。
 *
 * 输入：fileId + licenseType（auto/business_license/id_card/lawyer_license/organization_code）
 * 输出：证照类型 + 结构化字段 + 校验结果 + 置信度
 *
 * 算法（14 §6.4）：
 *   1. 调用 OcrService.recognize(fileId) 获取 OCR 文本
 *   2. 若 licenseType=auto：关键词匹配判断证照类型
 *   3. 按证照类型应用模板提取字段
 *   4. 校验：统一社会信用代码 18 位校验位 / 身份证 18 位校验位 / 有效期
 *
 * v2.3-W1 骨架说明：
 *   - OcrService 通过 ToolContext 注入，缺失时抛 8004
 *   - 完整字段提取模板与校验位算法留 v2.4 实现（接 OcrService 后）
 *   - 本骨架实现：OcrService 存在时执行基础识别 + 类型自动判定
 *
 * 设计依据：14-tool-design.md §六工具 3。
 */
import { Injectable } from '@nestjs/common';
import {
  LegalToolError,
  TOOL_ERROR_CODES,
  type JsonSchema,
  type LegalTool,
  type ToolContext,
  type ToolId,
  type ToolResult,
} from './types';

export interface LicenseOcrInput {
  fileId: string;
  licenseType?: 'auto' | 'business_license' | 'id_card' | 'lawyer_license' | 'organization_code';
}

export interface LicenseOcrOutput {
  licenseType: 'business_license' | 'id_card' | 'lawyer_license' | 'organization_code';
  fields: Record<string, unknown>;
  validation: {
    checksumValid: boolean;
    notExpired: boolean;
    issues: string[];
  };
  confidence: number;
  rawOcrText?: string;
}

const DISCLAIMER =
  '⚠️ 证照识别结果仅供参考，请与原件核对。统一社会信用代码/身份证校验位通过不代表证照真实有效。';

@Injectable()
export class LicenseOcrTool implements LegalTool<LicenseOcrInput, LicenseOcrOutput> {
  readonly toolId: ToolId = 'license_ocr';
  readonly name = '证照 OCR';
  readonly description = '营业执照/身份证/律师证等证照结构化识别与校验';
  readonly category = 'general' as const;
  readonly piiLevel = 'L3' as const;
  readonly async = false;
  readonly timeout = 10_000;
  readonly cacheable = false;
  readonly toolVersion = '0.1.0';

  readonly inputSchema: JsonSchema = {
    type: 'object',
    properties: {
      fileId: { type: 'string' },
      licenseType: {
        type: 'string',
        enum: ['auto', 'business_license', 'id_card', 'lawyer_license', 'organization_code'],
      },
    },
    required: ['fileId'],
  };

  readonly outputSchema: JsonSchema = {
    type: 'object',
    properties: {
      licenseType: {
        type: 'string',
        enum: ['business_license', 'id_card', 'lawyer_license', 'organization_code'],
      },
      fields: { type: 'object' },
      validation: { type: 'object' },
      confidence: { type: 'number' },
      rawOcrText: { type: 'string' },
    },
    required: ['licenseType', 'fields', 'validation'],
  };

  async invoke(input: LicenseOcrInput, ctx: ToolContext): Promise<ToolResult<LicenseOcrOutput>> {
    // 1. OcrService 必须存在
    if (!ctx.ocrService) {
      throw new LegalToolError(
        TOOL_ERROR_CODES.RECOGNIZE_FAILED,
        'OcrService 未注入，证照 OCR 不可用（v2.4 接入）',
        this.toolId,
      );
    }

    // 2. 调用 OCR
    let ocrResult: { text: string; confidence: number };
    try {
      ocrResult = await ctx.ocrService.recognize(input.fileId);
    } catch (err) {
      throw new LegalToolError(
        TOOL_ERROR_CODES.RECOGNIZE_FAILED,
        `OCR 识别失败: ${err instanceof Error ? err.message : String(err)}`,
        this.toolId,
      );
    }

    if (!ocrResult.text || ocrResult.text.trim().length === 0) {
      throw new LegalToolError(
        TOOL_ERROR_CODES.RECOGNIZE_FAILED,
        'OCR 返回空文本，可能图像质量过低或非证照',
        this.toolId,
      );
    }

    // 3. 证照类型判定
    const licenseType = this.resolveLicenseType(ocrResult.text, input.licenseType ?? 'auto');
    if (!licenseType) {
      throw new LegalToolError(
        TOOL_ERROR_CODES.RECOGNIZE_FAILED,
        '无法识别证照类型，请显式传入 licenseType',
        this.toolId,
        'licenseType',
      );
    }

    // 4. 字段提取（基础实现，完整模板留 v2.4）
    const fields = this.extractFields(licenseType, ocrResult.text);

    // 5. 校验
    const validation = this.validate(licenseType, fields);

    // 6. 是否返回 rawOcrText（受 featureFlag 控制）
    const includeRawText = ctx.featureFlags?.['tool.license_ocr.raw_text'] === true;

    ctx.logger?.debug('LicenseOcr 识别', {
      fileId: input.fileId,
      licenseType,
      confidence: ocrResult.confidence,
      fieldCount: Object.keys(fields).length,
      traceId: ctx.traceId,
    });

    return {
      success: true,
      data: {
        licenseType,
        fields,
        validation,
        confidence: ocrResult.confidence,
        ...(includeRawText ? { rawOcrText: ocrResult.text } : {}),
      },
      disclaimer: DISCLAIMER,
    };
  }

  /** 证照类型自动判定 */
  private resolveLicenseType(
    text: string,
    hint: LicenseOcrInput['licenseType'],
  ): LicenseOcrOutput['licenseType'] | null {
    if (hint && hint !== 'auto') return hint;
    if (text.includes('营业执照') || text.includes('统一社会信用代码')) return 'business_license';
    if (text.includes('中华人民共和国居民身份证')) return 'id_card';
    if (text.includes('律师执业证')) return 'lawyer_license';
    if (text.includes('组织机构代码证')) return 'organization_code';
    return null;
  }

  /** 字段提取（基础实现，正则匹配关键字段） */
  private extractFields(
    type: LicenseOcrOutput['licenseType'],
    text: string,
  ): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    switch (type) {
      case 'business_license': {
        const code = text.match(/统一社会信用代码[:：\s]*([0-9A-Z]{18})/);
        if (code) fields.unifiedSocialCreditCode = code[1];
        const name = text.match(/名称[:：\s]*([^\n\r,，。]+)/);
        if (name) fields.enterpriseName = name[1].trim();
        const legal = text.match(/法定代表人[:：\s]*([^\n\r,，。]+)/);
        if (legal) fields.legalRepresentative = legal[1].trim();
        const capital = text.match(/注册资本[:：\s]*([^\n\r,，。]+)/);
        if (capital) fields.registeredCapital = capital[1].trim();
        break;
      }
      case 'id_card': {
        const name = text.match(/姓名[:：\s]*([^\n\r,，。]+)/);
        if (name) fields.name = name[1].trim();
        const gender = text.match(/性别[:：\s]*(男|女)/);
        if (gender) fields.gender = gender[1];
        const ethnicity = text.match(/民族[:：\s]*([^\n\r,，。]+)/);
        if (ethnicity) fields.ethnicity = ethnicity[1].trim();
        const id = text.match(/(\d{17}[\dXx])/);
        if (id) fields.idNumber = id[1];
        break;
      }
      case 'lawyer_license': {
        const name = text.match(/姓名[:：\s]*([^\n\r,，。]+)/);
        if (name) fields.lawyerName = name[1].trim();
        const no = text.match(/执业证号[:：\s]*([0-9A-Z]+)/);
        if (no) fields.licenseNumber = no[1];
        const firm = text.match(/律师事务所[:：\s]*([^\n\r,，。]+)/);
        if (firm) fields.lawFirm = firm[1].trim();
        break;
      }
      case 'organization_code': {
        const code = text.match(/代码[:：\s]*([0-9A-Z]{8,9})/);
        if (code) fields.organizationCode = code[1];
        const name = text.match(/机构名称[:：\s]*([^\n\r,，。]+)/);
        if (name) fields.organizationName = name[1].trim();
        break;
      }
    }
    return fields;
  }

  /** 校验 */
  private validate(
    type: LicenseOcrOutput['licenseType'],
    fields: Record<string, unknown>,
  ): LicenseOcrOutput['validation'] {
    const issues: string[] = [];
    let checksumValid = true;

    if (type === 'business_license' && fields.unifiedSocialCreditCode) {
      checksumValid = this.validateUscc(fields.unifiedSocialCreditCode as string);
      if (!checksumValid) issues.push('统一社会信用代码校验位不匹配');
    }
    if (type === 'id_card' && fields.idNumber) {
      checksumValid = this.validateIdCard(fields.idNumber as string);
      if (!checksumValid) issues.push('身份证号校验位不匹配');
    }

    // notExpired 简化：未提取到有效期字段时默认 true（v2.4 完整实现）
    const notExpired = true;

    return { checksumValid, notExpired, issues };
  }

  /** 统一社会信用代码校验位（GB 32100-2015，简化版） */
  private validateUscc(code: string): boolean {
    if (!/^[0-9A-Z]{18}$/.test(code)) return false;
    // 简化校验：仅检查长度与字符集，完整校验位算法留 v2.4
    return true;
  }

  /** 身份证号校验位（GB 11643-1999） */
  private validateIdCard(id: string): boolean {
    if (!/^\d{17}[\dXx]$/.test(id)) return false;
    // 完整校验位算法
    const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    const checkCodes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
    let sum = 0;
    for (let i = 0; i < 17; i++) {
      sum += parseInt(id[i], 10) * weights[i];
    }
    const expected = checkCodes[sum % 11];
    return id[17].toUpperCase() === expected;
  }
}
