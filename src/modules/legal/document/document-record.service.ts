/**
 * DocumentRecordService —— 文书记录持久化（A3-W3，A3 §七）。
 *
 * 职责：
 *   1. create(record)：写入 document_record，varsFilled 经 PiiService L4 加密
 *   2. findByDocId(docId)：查询并解密 varsFilled
 *   3. findByUser(userId, opts)：分页查询用户文书列表（不解密 vars，仅元数据）
 *   4. updateExport(docId, fileId, format)：导出后回填 exportFileId + status=exported
 *   5. deleteByDocId(docId)：删除记录（管理后台）
 *
 * 安全：
 *   - varsFilled 字段 L4 加密入库（PiiService.encrypt）
 *   - 查询返回时解密（PiiService.decrypt）
 *   - PiiService 注入失败时降级为 JSON.stringify（开发环境，记录 warn）
 *
 * 错误码（对齐 06-api-spec）：
 *   2002 文书不存在（NotFoundException）
 *
 * 设计依据：A3 §七 document_record schema；03 §三 L4 加密策略。
 */
import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  DocumentRecord,
  type DocumentRecordDocument,
} from '../../../infra/database/schemas/document.schema';
import type { PiiService } from '../../platform/pii/pii.service';
import type { AppLoggerService } from '../../platform/logger/logger.service';
import type { LawRef } from '../../../types/llm';
import type { ExportFormat } from '../export/export.service';

/** 文书不存在错误码（对齐 06-api-spec 2002） */
export const DOC_RECORD_NOT_FOUND_CODE = 2002;

/** 创建文书记录入参 */
export interface CreateDocumentRecordInput {
  docId: string;
  userId: string;
  caseId?: string;
  templateCode: string;
  templateTitle?: string;
  templateVersion?: number;
  varsFilled: Record<string, unknown>;
  renderedText: string;
  lawRefs: LawRef[];
}

/** 文书记录查询结果（varsFilled 已解密） */
export interface DocumentRecordDto {
  docId: string;
  userId: string;
  caseId?: string;
  templateCode: string;
  templateTitle?: string;
  templateVersion: number;
  varsFilled: Record<string, unknown>;
  renderedText: string;
  lawRefs: string[];
  exportFileId?: string;
  exportFormat?: ExportFormat;
  /** 状态：generated / exported / archived（schema 用 string 存储） */
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** 列表查询结果（不含 varsFilled / renderedText，避免敏感数据传输） */
export interface DocumentRecordListItem {
  docId: string;
  templateCode: string;
  templateTitle?: string;
  status: string;
  exportFormat?: ExportFormat;
  createdAt: Date;
}

export interface ListResult {
  items: DocumentRecordListItem[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class DocumentRecordService {
  constructor(
    @InjectModel(DocumentRecord.name) private readonly model: Model<DocumentRecordDocument>,
    @Optional() private readonly pii?: PiiService,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  /** 创建文书记录（varsFilled L4 加密入库） */
  async create(input: CreateDocumentRecordInput): Promise<DocumentRecordDto> {
    const encryptedVars = this.encryptVars(input.varsFilled, input.docId);
    const now = new Date();
    const expireAt = new Date(now.getTime() + 365 * 24 * 3600 * 1000); // TTL 1 年

    const doc = await this.model.create({
      docId: input.docId,
      userId: input.userId,
      caseId: input.caseId,
      templateCode: input.templateCode,
      templateTitle: input.templateTitle,
      templateVersion: input.templateVersion ?? 1,
      varsFilled: encryptedVars,
      renderedText: input.renderedText,
      lawRefs: input.lawRefs.map((r) => r.ref),
      status: 'generated',
      createdAt: now,
      updatedAt: now,
      expireAt,
    });

    this.logger?.debug('DocumentRecordService: 文书记录已创建', {
      docId: input.docId,
      userId: input.userId,
      templateCode: input.templateCode,
    });

    return this.toDto(doc);
  }

  /** 按 docId 查询（解密 varsFilled） */
  async findByDocId(docId: string): Promise<DocumentRecordDto> {
    const doc = await this.model.findOne({ docId }).lean<DocumentRecordDocument>().exec();
    if (!doc) {
      throw new NotFoundException({
        code: DOC_RECORD_NOT_FOUND_CODE,
        message: `文书不存在: ${docId}`,
      });
    }
    return this.toDto(doc);
  }

  /** 按 userId 分页查询（列表，不含敏感字段） */
  async findByUser(
    userId: string,
    opts: { page?: number; pageSize?: number } = {},
  ): Promise<ListResult> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.model
        .find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .select({
          docId: 1,
          templateCode: 1,
          templateTitle: 1,
          status: 1,
          exportFormat: 1,
          createdAt: 1,
        })
        .lean<DocumentRecordListItem[]>()
        .exec(),
      this.model.countDocuments({ userId }).exec(),
    ]);

    return { items, total, page, pageSize };
  }

  /** 导出后回填 exportFileId + status=exported */
  async updateExport(
    docId: string,
    fileId: string,
    format: ExportFormat,
  ): Promise<DocumentRecordDto> {
    const doc = await this.model
      .findOneAndUpdate(
        { docId },
        {
          $set: {
            exportFileId: fileId,
            exportFormat: format,
            status: 'exported',
            updatedAt: new Date(),
          },
        },
        { new: true },
      )
      .lean<DocumentRecordDocument>()
      .exec();

    if (!doc) {
      throw new NotFoundException({
        code: DOC_RECORD_NOT_FOUND_CODE,
        message: `文书不存在: ${docId}`,
      });
    }

    this.logger?.info('DocumentRecordService: 文书已标记为已导出', {
      docId,
      fileId,
      format,
    });

    return this.toDto(doc);
  }

  /** 删除文书记录 */
  async deleteByDocId(docId: string): Promise<void> {
    const res = await this.model.deleteOne({ docId }).exec();
    if (res.deletedCount === 0) {
      throw new NotFoundException({
        code: DOC_RECORD_NOT_FOUND_CODE,
        message: `文书不存在: ${docId}`,
      });
    }
  }

  // ===== 内部辅助 =====

  /** 加密 varsFilled：序列化 JSON → PiiService.encrypt */
  private encryptVars(vars: Record<string, unknown>, docId: string): string {
    const json = JSON.stringify(vars);
    if (!this.pii) {
      // 开发环境降级：明文入库，记录 warn
      this.logger?.warn(
        'DocumentRecordService: PiiService 未注入，varsFilled 明文存储（仅开发环境）',
        { docId },
      );
      return json;
    }
    return this.pii.encrypt(json);
  }

  /** 解密 varsFilled */
  private decryptVars(encrypted: string, docId: string): Record<string, unknown> {
    if (!this.pii) {
      // 开发环境：尝试直接 JSON.parse（明文降级路径）
      try {
        return JSON.parse(encrypted) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    try {
      const json = this.pii.decrypt(encrypted);
      return JSON.parse(json) as Record<string, unknown>;
    } catch (err) {
      this.logger?.error('DocumentRecordService: varsFilled 解密失败', {
        docId,
        error: err instanceof Error ? err.message : String(err),
      });
      return {};
    }
  }

  /** 转换 lean 文档为 DTO（解密 varsFilled） */
  private toDto(doc: DocumentRecordDocument): DocumentRecordDto {
    return {
      docId: doc.docId,
      userId: doc.userId,
      caseId: doc.caseId,
      templateCode: doc.templateCode,
      templateTitle: doc.templateTitle,
      templateVersion: doc.templateVersion,
      varsFilled: this.decryptVars(doc.varsFilled, doc.docId),
      renderedText: doc.renderedText,
      lawRefs: doc.lawRefs,
      exportFileId: doc.exportFileId,
      exportFormat: doc.exportFormat as ExportFormat | undefined,
      status: doc.status,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
