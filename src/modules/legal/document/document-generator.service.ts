/**
 * DocumentGeneratorService —— 法律文书生成（A3-W2，A3 §4.4）。
 *
 * 职责：
 *   1. 加载模板（DOCUMENT_TEMPLATES，启动时构建 Map）
 *   2. validateVars 校验变量（失败抛 BadRequestException 3001）
 *   3. renderDsl 渲染（失败抛 BadRequestException 3002）
 *   4. （可选）RagService 检索相关法条上下文
 *   5. extractLawRefs 提取法条引用
 *   6. 注入免责声明（尾部拼接 DISCLAIMER_TEXT）
 *   7. 审计 document_generate 事件
 *   8. 返回结果（exportReady=false，导出能力在后续阶段）
 *
 * 错误码（对齐 06-api-spec）：
 *   2001 模板不存在（NotFoundException）
 *   3001 变量校验失败（BadRequestException）
 *   3002 渲染失败（BadRequestException）
 *
 * 设计依据：A3 §4.4；A3-W2 实施计划阶段 6。
 */
import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DOCUMENT_TEMPLATES, type DocumentTemplate } from '../../../data/documentTemplates';
import { renderDsl, validateVars, RenderError, type ValidationResult } from './dsl-renderer';
import { extractLawRefs } from '../../../services/legal/llm/lawRefExtractor';
import { DISCLAIMER_TEXT } from '../chat/sse-frames';
import type { LawRef } from '../../../types/llm';
import type { RagService } from '../retrieval/rag.service';
import type { AuditLogService } from '../../platform/audit/audit-log.service';
import type { AppLoggerService } from '../../platform/logger/logger.service';
import type { JobService } from '../job/job.service';
import type { DocumentRecordService } from './document-record.service';

/** 文书生成入参 */
export interface DocumentGenerateDto {
  /** 模板编码（如 civil_complaint_v1） */
  templateCode: string;
  /** 模板变量 */
  vars: Record<string, unknown>;
  /** 是否启用 RAG 法条检索增强（默认 false） */
  enableRag?: boolean;
}

/** 文书生成结果 */
export interface DocumentGenerateResult {
  docId: string;
  templateCode: string;
  templateTitle: string;
  renderedText: string;
  varsFilled: Record<string, unknown>;
  lawRefs: LawRef[];
  /** RAG 检索补充的法条上下文（enableRag=true 时填充） */
  retrievedLawContext?: string;
  disclaimer: string;
  /** 是否可导出（W2 桩：始终 false，导出能力在后续阶段） */
  exportReady: boolean;
}

/** 文书模板不存在错误码（对齐 06-api-spec 2001） */
export const DOC_TEMPLATE_NOT_FOUND_CODE = 2001;
/** 变量校验失败错误码（3001） */
export const DOC_VALIDATION_FAILED_CODE = 3001;
/** 渲染失败错误码（3002） */
export const DOC_RENDER_FAILED_CODE = 3002;

@Injectable()
export class DocumentGeneratorService {
  /** 模板编码 → 模板 */
  private readonly templates = new Map<string, DocumentTemplate>();

  constructor(
    @Optional() private readonly rag?: RagService,
    @Optional() private readonly audit?: AuditLogService,
    @Optional() private readonly logger?: AppLoggerService,
    @Optional() private readonly jobService?: JobService,
    @Optional() private readonly recordService?: DocumentRecordService,
  ) {
    for (const t of DOCUMENT_TEMPLATES) {
      this.templates.set(t.code, t);
    }
  }

  /** 列出所有 active 模板（供控制器展示可选模板） */
  listTemplates(): DocumentTemplate[] {
    return Array.from(this.templates.values()).filter((t) => t.status === 'active');
  }

  /** 加载模板（不存在抛 NotFoundException 2001） */
  getTemplate(templateCode: string): DocumentTemplate {
    const tmpl = this.templates.get(templateCode);
    if (!tmpl) {
      throw new NotFoundException({
        code: DOC_TEMPLATE_NOT_FOUND_CODE,
        message: `文书模板不存在: ${templateCode}`,
      });
    }
    return tmpl;
  }

  /** 校验变量（不抛错，返回结果） */
  validateVars(templateCode: string, vars: Record<string, unknown>): ValidationResult {
    const tmpl = this.getTemplate(templateCode);
    return validateVars(tmpl.vars, vars);
  }

  /** 渲染模板（不校验、不注入免责声明，供预览/调试） */
  render(templateCode: string, vars: Record<string, unknown>): string {
    const tmpl = this.getTemplate(templateCode);
    return renderDsl(tmpl.body, vars);
  }

  /**
   * 同步生成文书（A3 §4.4 主流程）。
   *
   * @throws NotFoundException(2001) 模板不存在
   * @throws BadRequestException(3001) 变量校验失败
   * @throws BadRequestException(3002) 渲染失败
   */
  async generate(
    dto: DocumentGenerateDto,
    ctx?: { userId?: string; caseId?: string; persist?: boolean },
  ): Promise<DocumentGenerateResult> {
    const startedAt = Date.now();
    // 1. 加载模板
    const tmpl = this.getTemplate(dto.templateCode);

    // 2. 校验变量
    const validation = validateVars(tmpl.vars, dto.vars);
    if (!validation.valid) {
      throw new BadRequestException({
        code: DOC_VALIDATION_FAILED_CODE,
        message: '文书变量校验失败',
        errors: validation.issues,
      });
    }

    // 3. 渲染
    let renderedText: string;
    try {
      renderedText = renderDsl(tmpl.body, dto.vars);
    } catch (err) {
      if (err instanceof RenderError) {
        throw new BadRequestException({
          code: DOC_RENDER_FAILED_CODE,
          message: `文书渲染失败: ${err.message}`,
          renderErrorCode: err.code,
        });
      }
      throw new BadRequestException({
        code: DOC_RENDER_FAILED_CODE,
        message: `文书渲染失败: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // 4. （可选）RAG 法条检索
    let retrievedLawContext: string | undefined;
    if (dto.enableRag && this.rag) {
      try {
        const facts = String(dto.vars.facts ?? dto.vars.matter ?? dto.templateCode);
        const results = await this.rag.retrieve({ text: facts, finalTopK: 3 });
        if (results.length > 0) {
          retrievedLawContext = results.map((r) => `【${r.title}】${r.content}`).join('\n\n');
        }
      } catch (err) {
        // RAG 失败不阻塞文书生成（best-effort）
        this.logger?.warn('DocumentGenerator: RAG 检索失败，跳过法条增强', {
          templateCode: dto.templateCode,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 5. 提取法条引用
    const lawRefs: LawRef[] = extractLawRefs(renderedText).map((r) => ({
      ...r,
      verified: false,
    }));

    // 6. 注入免责声明
    const fullText = `${renderedText}\n\n${DISCLAIMER_TEXT}`;

    // 7. 生成 docId
    const docId = randomUUID();

    // 8. （可选）持久化到 document_record（A3-W3 新增）
    if (ctx?.persist && this.recordService && ctx.userId) {
      try {
        await this.recordService.create({
          docId,
          userId: ctx.userId,
          caseId: ctx.caseId,
          templateCode: dto.templateCode,
          templateTitle: tmpl.title,
          templateVersion: tmpl.version,
          varsFilled: dto.vars,
          renderedText: fullText,
          lawRefs,
        });
      } catch (err) {
        // 持久化失败不阻塞生成结果返回（best-effort）
        this.logger?.warn('DocumentGenerator: document_record 持久化失败', {
          docId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 9. 审计
    this.audit?.write('document_generate', {
      docId,
      templateCode: dto.templateCode,
      templateTitle: tmpl.title,
      lawRefCount: lawRefs.length,
      enableRag: !!dto.enableRag,
      chars: fullText.length,
      persist: !!ctx?.persist,
    });

    this.logger?.info('DocumentGenerator: 文书生成完成', {
      docId,
      templateCode: dto.templateCode,
      durationMs: Date.now() - startedAt,
      lawRefs: lawRefs.length,
    });

    // 10. 返回
    return {
      docId,
      templateCode: dto.templateCode,
      templateTitle: tmpl.title,
      renderedText: fullText,
      varsFilled: dto.vars,
      lawRefs,
      retrievedLawContext,
      disclaimer: DISCLAIMER_TEXT,
      // exportReady 由是否接入 ExportService 决定；当前 A3-W3 已接入，标记为 true
      exportReady: true,
    };
  }

  /**
   * 异步生成（A3-W4 接入 JobService）：创建任务并立即执行。
   *
   * 流程：
   *   1. JobService.create('document_generate', { dto, ctx }, userId) → jobId
   *   2. JobService.runJob(jobId, executor) 执行实际生成
   *   3. 返回 { jobId, status }
   *
   * 注：当前为同步触发（fire-and-forget）；A4 接入消息队列后改为 worker 拉取。
   *     JobService.runJob 内部已封装状态机 + 超时保护。
   */
  async generateAsync(
    dto: DocumentGenerateDto,
    ctx: { userId: string; caseId?: string },
  ): Promise<{ jobId: string; status: 'pending' | 'completed' | 'failed' }> {
    // 无 JobService 注入时回退到桩行为（保持向后兼容）
    if (!this.jobService) {
      const jobId = randomUUID();
      this.logger?.warn('DocumentGenerator: JobService 未注入，generateAsync 返回桩 jobId', {
        jobId,
        templateCode: dto.templateCode,
      });
      this.audit?.write('document_generate', {
        jobId,
        templateCode: dto.templateCode,
        async: true,
        stub: true,
      });
      return { jobId, status: 'pending' };
    }

    // 1. 创建任务
    const { jobId } = await this.jobService.create('document_generate', { dto, ctx }, ctx.userId);

    this.logger?.info('DocumentGenerator: 异步生成任务已创建', {
      jobId,
      templateCode: dto.templateCode,
      userId: ctx.userId,
    });
    this.audit?.write('document_generate', {
      jobId,
      templateCode: dto.templateCode,
      async: true,
      userId: ctx.userId,
    });

    // 2. 同步触发执行（fire-and-forget；A4 改为 worker 拉取）
    //    不 await：让调用方立即拿到 jobId，执行过程在后台进行
    void this.jobService
      .runJob(jobId, async (params) => {
        const { dto: innerDto, ctx: innerCtx } = params as {
          dto: DocumentGenerateDto;
          ctx: { userId: string; caseId?: string };
        };
        const result = await this.generate(innerDto, {
          userId: innerCtx.userId,
          caseId: innerCtx.caseId,
          persist: true,
        });
        return {
          docId: result.docId,
          templateCode: result.templateCode,
          templateTitle: result.templateTitle,
        } as Record<string, unknown>;
      })
      .catch((err: unknown) => {
        // runJob 内部已写入 failed 状态；这里仅记日志
        this.logger?.error('DocumentGenerator: 异步任务执行失败', {
          jobId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return { jobId, status: 'pending' };
  }
}
