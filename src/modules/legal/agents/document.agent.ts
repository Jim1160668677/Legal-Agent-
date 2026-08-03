/**
 * DocumentAgent —— 文书生成与导出 Agent（A4-W2，A4 §五 5.1 #5）。
 *
 * capabilities: document.generate / document.export
 * 包装：DocumentGeneratorService（DSL 渲染）+ ExportService（docx/pdf 导出）
 * exposure: L-Write-Limited（对外受限写）
 * async: true（文书生成为异步长任务）
 * fallback: 无
 *
 * 职责：
 *   1. document.generate：调用 DocumentGenerator.generate（同步）或 generateAsync（异步 jobId）
 *   2. document.export：调用 ExportService.exportDocx/exportPdf 生成下载文件
 *   3. capability 路由：根据 input.capability 决定生成还是导出
 *
 * 编排计划（A4 §6.2）：
 *   - document_generate 意图：并行召回（law-lookup // process-guide）→ 串行生成（document）
 *   - 异步任务：返回 jobId，客户端轮询 GET /v1/jobs/:jobId
 *
 * 设计依据：A4 §五 5.1；A3 §4.4 DocumentGenerator；A3 §十二 ExportService。
 */
import { Injectable, Optional } from '@nestjs/common';
import { BaseAgent } from './base.agent';
import type { AgentCard, AgentContext, AgentInvokeInput, AgentInvokeOutput } from './types';
import { PiiService } from '../../platform/pii/pii.service';
import { AuditLogService } from '../../platform/audit/audit-log.service';
import { AppLoggerService } from '../../platform/logger/logger.service';
import type {
  DocumentGeneratorService,
  DocumentGenerateDto,
} from '../document/document-generator.service';
import { ExportService } from '../export/export.service';
import type { ExportFormat } from '../export/export.service';
import { DISCLAIMER_TEXT } from '../chat/sse-frames';

const CARD: AgentCard = {
  agentId: 'document',
  name: '文书生成',
  description: '法律文书生成（DSL 渲染）+ 导出（docx/pdf）',
  version: '1.0.0',
  capabilities: ['document.generate', 'document.export'],
  inputSchema: {
    type: 'object',
    properties: {
      templateCode: { type: 'string', description: '模板编码（document.generate）' },
      vars: { type: 'object', description: '模板变量（document.generate）' },
      docId: { type: 'string', description: '文书 ID（document.export）' },
      format: { type: 'string', enum: ['docx', 'pdf'], description: '导出格式' },
      async: { type: 'boolean', description: '是否异步生成（返回 jobId）', default: false },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      docId: { type: 'string' },
      renderedText: { type: 'string' },
      fileId: { type: 'string' },
      downloadUrl: { type: 'string' },
      jobId: { type: 'string' },
      disclaimer: { type: 'string' },
      lawRefs: { type: 'array' },
      traceId: { type: 'string' },
    },
    required: ['disclaimer', 'lawRefs', 'traceId'],
  },
  piiLevel: 'L3', // 文书可能含当事人姓名/身份证等敏感信息
  exposure: 'L-Write-Limited',
  async: true,
  timeout: 60_000, // 异步任务 60s
};

@Injectable()
export class DocumentAgent extends BaseAgent {
  readonly card = CARD;

  constructor(
    @Optional() private readonly generator?: DocumentGeneratorService,
    @Optional() private readonly exportService?: ExportService,
    @Optional() pii?: PiiService,
    @Optional() audit?: AuditLogService,
    @Optional() logger?: AppLoggerService,
  ) {
    super(pii, audit, logger);
  }

  protected async execute(input: AgentInvokeInput, ctx: AgentContext): Promise<AgentInvokeOutput> {
    if (input.capability === 'document.export') {
      return this.executeExport(input, ctx);
    }
    return this.executeGenerate(input, ctx);
  }

  /** 文书生成 */
  private async executeGenerate(
    input: AgentInvokeInput,
    ctx: AgentContext,
  ): Promise<AgentInvokeOutput> {
    if (!this.generator) {
      return this.fail(5001, 'DocumentGeneratorService 未注入', ctx);
    }

    const templateCode = String(input.params.templateCode ?? '').trim();
    if (!templateCode) {
      return this.fail(1001, 'templateCode 不能为空', ctx);
    }

    const dto: DocumentGenerateDto = {
      templateCode,
      vars: (input.params.vars as Record<string, unknown>) ?? {},
      enableRag: Boolean(input.params.enableRag),
    };

    // 异步生成：返回 jobId
    if (input.params.async === true) {
      const jobResult = await this.generator.generateAsync(dto, {
        userId: ctx.callerUserId,
      });
      return {
        ok: true,
        data: { jobId: jobResult.jobId, status: jobResult.status, async: true },
        lawRefs: [],
        disclaimer: DISCLAIMER_TEXT,
        verified: false,
        jobId: jobResult.jobId,
        usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
      };
    }

    // 同步生成
    const result = await this.generator.generate(dto, {
      userId: ctx.callerUserId,
      persist: true,
    });

    return {
      ok: true,
      data: {
        docId: result.docId,
        templateCode: result.templateCode,
        templateTitle: result.templateTitle,
        renderedText: result.renderedText,
        exportReady: result.exportReady,
      },
      lawRefs: result.lawRefs,
      disclaimer: result.disclaimer || DISCLAIMER_TEXT,
      verified: false,
      usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
    };
  }

  /** 文书导出 */
  private async executeExport(
    input: AgentInvokeInput,
    ctx: AgentContext,
  ): Promise<AgentInvokeOutput> {
    if (!this.exportService) {
      return this.fail(5001, 'ExportService 未注入', ctx);
    }

    const docId = String(input.params.docId ?? '').trim();
    if (!docId) {
      return this.fail(1001, 'docId 不能为空', ctx);
    }

    const format: ExportFormat = input.params.format === 'pdf' ? 'pdf' : 'docx';
    const renderedText = String(input.params.renderedText ?? '').trim();
    if (!renderedText) {
      return this.fail(1001, 'renderedText 不能为空（导出需提供已渲染文本）', ctx);
    }

    const filename = input.params.filename ? String(input.params.filename) : undefined;
    const result =
      format === 'docx'
        ? await this.exportService.exportDocx(docId, renderedText, filename)
        : await this.exportService.exportPdf(docId, renderedText, filename);

    return {
      ok: true,
      data: {
        docId,
        fileId: result.fileId,
        downloadUrl: result.downloadUrl,
        format: result.format,
        size: result.size,
      },
      lawRefs: [],
      disclaimer: DISCLAIMER_TEXT,
      verified: false,
      usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
    };
  }

  private fail(code: number, message: string, _ctx: AgentContext): AgentInvokeOutput {
    return {
      ok: false,
      data: {},
      lawRefs: [],
      disclaimer: DISCLAIMER_TEXT,
      verified: false,
      usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
      errorCode: code,
      errorMessage: message,
    };
  }
}
