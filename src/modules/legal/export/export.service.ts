/**
 * ExportService —— 文书导出（A3-W3，A3 §5）。
 *
 * 职责：
 *   1. exportDocx(docId, renderedText)：渲染 docx → 上传对象存储 → 返回 fileId + 下载 URL
 *   2. exportPdf(docId, renderedText)：渲染 pdf → 上传 → 返回 fileId + 下载 URL
 *   3. getDownloadUrl(fileId, expiresInSec)：生成预签名 URL（默认 1 小时）
 *
 * 依赖：
 *   - ObjectStorage（OBJECT_STORAGE_TOKEN，A3-W3 抽象）
 *   - buildDocx / buildPdf（infra/export，纯函数）
 *   - AuditLogService（document_export 审计，可选）
 *   - AppLoggerService（可选）
 *
 * 错误码（对齐 06-api-spec）：
 *   3003 导出失败（渲染或上传异常）
 *   3004 下载文件不存在
 *
 * 设计依据：A3 §5；A3-W3 实施计划阶段 4。
 */
import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { OBJECT_STORAGE_TOKEN } from '../../../infra/storage/object-storage.interface';
import type { ObjectStorage } from '../../../infra/storage/object-storage.interface';
import { buildDocx, DOCX_CONTENT_TYPE } from '../../../infra/export/docx-builder';
import { buildPdf, PDF_CONTENT_TYPE } from '../../../infra/export/pdf-builder';
import type { AuditLogService } from '../../platform/audit/audit-log.service';
import type { AppLoggerService } from '../../platform/logger/logger.service';

/** 导出格式 */
export type ExportFormat = 'docx' | 'pdf';

/** 导出结果 */
export interface ExportResult {
  /** 对象存储 key（持久化到 document_record.exportFileId） */
  fileId: string;
  /** 预签名下载 URL（限时访问，默认 1 小时） */
  downloadUrl: string;
  /** 导出格式 */
  format: ExportFormat;
  /** 文件大小（字节） */
  size: number;
}

/** 导出失败错误码（3003） */
export const DOC_EXPORT_FAILED_CODE = 3003;
/** 下载文件不存在错误码（3004） */
export const DOC_DOWNLOAD_NOT_FOUND_CODE = 3004;

/** 默认预签名 URL 有效期：1 小时（A3 §5.1） */
const DEFAULT_URL_EXPIRES_SEC = 3600;

@Injectable()
export class ExportService {
  constructor(
    @Inject(OBJECT_STORAGE_TOKEN) private readonly storage: ObjectStorage,
    @Optional() private readonly audit?: AuditLogService,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  /**
   * 导出 docx。
   * @param docId 文书 ID（用于组织对象存储 key）
   * @param renderedText 渲染后的正文（含免责声明）
   * @param filename 文件名（可选，默认 `${docId}.docx`）
   */
  async exportDocx(docId: string, renderedText: string, filename?: string): Promise<ExportResult> {
    return this.export(docId, renderedText, 'docx', filename);
  }

  /**
   * 导出 pdf。
   * @param docId 文书 ID
   * @param renderedText 渲染后的正文
   * @param filename 文件名（可选）
   */
  async exportPdf(docId: string, renderedText: string, filename?: string): Promise<ExportResult> {
    return this.export(docId, renderedText, 'pdf', filename);
  }

  /**
   * 获取下载 URL（重新生成预签名）。
   * @param fileId 对象存储 key
   * @param expiresInSec 过期秒数（默认 1 小时）
   */
  async getDownloadUrl(fileId: string, expiresInSec = DEFAULT_URL_EXPIRES_SEC): Promise<string> {
    const exists = await this.storage.exists(fileId).catch((err: unknown) => {
      throw new NotFoundException({
        code: DOC_DOWNLOAD_NOT_FOUND_CODE,
        message: `下载文件不存在: ${fileId}`,
        cause: err instanceof Error ? err.message : String(err),
      });
    });
    if (!exists) {
      throw new NotFoundException({
        code: DOC_DOWNLOAD_NOT_FOUND_CODE,
        message: `下载文件不存在: ${fileId}`,
      });
    }
    return this.storage.getSignedUrl(fileId, expiresInSec);
  }

  // ===== 内部 =====

  /** 通用导出流程：渲染 → 上传 → 审计 → 返回 */
  private async export(
    docId: string,
    renderedText: string,
    format: ExportFormat,
    filename?: string,
  ): Promise<ExportResult> {
    const startedAt = Date.now();
    const fname = filename ?? `${docId}.${format}`;
    const key = `documents/${docId}/${fname}`;

    // 1. 渲染
    let buffer: Buffer;
    let contentType: string;
    try {
      if (format === 'docx') {
        buffer = buildDocx(renderedText);
        contentType = DOCX_CONTENT_TYPE;
      } else {
        buffer = buildPdf(renderedText);
        contentType = PDF_CONTENT_TYPE;
      }
    } catch (err) {
      this.logger?.error('ExportService: 渲染失败', {
        docId,
        format,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new NotFoundException({
        code: DOC_EXPORT_FAILED_CODE,
        message: `文书渲染失败: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // 2. 上传
    try {
      await this.storage.upload(key, buffer, {
        contentType,
        filename: fname,
        private: true,
      });
    } catch (err) {
      this.logger?.error('ExportService: 对象存储上传失败', {
        docId,
        format,
        key,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new NotFoundException({
        code: DOC_EXPORT_FAILED_CODE,
        message: `对象存储上传失败: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // 3. 生成下载 URL
    const downloadUrl = await this.storage.getSignedUrl(key, DEFAULT_URL_EXPIRES_SEC);

    // 4. 审计
    this.audit?.write('document_export', {
      docId,
      format,
      fileId: key,
      size: buffer.length,
      durationMs: Date.now() - startedAt,
    });

    this.logger?.info('ExportService: 导出完成', {
      docId,
      format,
      key,
      size: buffer.length,
      durationMs: Date.now() - startedAt,
    });

    return {
      fileId: key,
      downloadUrl,
      format,
      size: buffer.length,
    };
  }
}
