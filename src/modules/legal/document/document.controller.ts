/**
 * DocumentController —— 文书生成 REST 端点（A3-W3，A3 §十二）。
 *
 * 端点：
 *   GET    /v1/documents/templates                列出可用文书模板
 *   POST   /v1/documents                         同步生成文书（持久化）
 *   POST   /v1/documents/async                   异步生成文书（返回 jobId）
 *   GET    /v1/documents/:docId                  查询文书详情（解密 varsFilled）
 *   GET    /v1/documents                         列出当前用户文书
 *   POST   /v1/documents/:docId/export           导出文书（docx/pdf）
 *   GET    /v1/documents/:docId/download         获取预签名下载 URL
 *
 * 鉴权：JwtAuthGuard（所有端点需 access token）
 *
 * 设计依据：A3 §十二 交付物清单；06-api-spec 文书端点。
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { JwtPayload } from '../../auth/auth.types';
import type { DocumentGenerateDto } from './document-generator.service';
import { DocumentGeneratorService } from './document-generator.service';
import { DocumentRecordService } from './document-record.service';
import { ExportService } from '../export/export.service';
import type { ExportFormat } from '../export/export.service';

@Controller('v1/documents')
@UseGuards(JwtAuthGuard)
export class DocumentController {
  constructor(
    private readonly generator: DocumentGeneratorService,
    private readonly recordService: DocumentRecordService,
    private readonly exportService: ExportService,
  ) {}

  /** 列出可用文书模板（无需鉴权也可，但本控制器统一加 guard） */
  @Get('templates')
  listTemplates() {
    return this.generator.listTemplates();
  }

  /** 同步生成文书（持久化到 document_record） */
  @Post()
  @HttpCode(200)
  async generate(
    @Body() dto: DocumentGenerateDto,
    @CurrentUser() user: JwtPayload,
    @Query('caseId') caseId?: string,
  ) {
    if (!dto || !dto.templateCode) {
      throw new BadRequestException({ code: 1001, message: 'templateCode 不能为空' });
    }
    const result = await this.generator.generate(dto, {
      userId: user.sub,
      caseId,
      persist: true,
    });
    return result;
  }

  /** 异步生成文书（返回 jobId，客户端轮询 GET /v1/jobs/:jobId） */
  @Post('async')
  @HttpCode(202)
  async generateAsync(
    @Body() dto: DocumentGenerateDto,
    @CurrentUser() user: JwtPayload,
    @Query('caseId') caseId?: string,
  ) {
    if (!dto || !dto.templateCode) {
      throw new BadRequestException({ code: 1001, message: 'templateCode 不能为空' });
    }
    return this.generator.generateAsync(dto, { userId: user.sub, caseId });
  }

  /** 查询文书详情（解密 varsFilled） */
  @Get(':docId')
  async getDoc(@Param('docId') docId: string, @CurrentUser() user: JwtPayload) {
    // 越权校验前置：仅查 userId，通过后才解密 varsFilled（避免越权场景下无谓 PII 解密）
    await this.recordService.assertOwner(docId, user.sub, user.role === 'admin');
    return this.recordService.findByDocId(docId);
  }

  /** 列出当前用户文书 */
  @Get()
  listMine(
    @CurrentUser() user: JwtPayload,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.recordService.findByUser(user.sub, {
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    });
  }

  /** 导出文书（docx/pdf），回填 exportFileId */
  @Post(':docId/export')
  @HttpCode(200)
  async exportDoc(
    @Param('docId') docId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { format?: ExportFormat; filename?: string },
  ) {
    const format: ExportFormat = body?.format === 'pdf' ? 'pdf' : 'docx';
    // 越权校验前置：通过后再加载文书正文
    await this.recordService.assertOwner(docId, user.sub, user.role === 'admin');
    const doc = await this.recordService.findByDocId(docId);

    const result =
      format === 'docx'
        ? await this.exportService.exportDocx(docId, doc.renderedText, body?.filename)
        : await this.exportService.exportPdf(docId, doc.renderedText, body?.filename);

    // 回填 exportFileId
    await this.recordService.updateExport(docId, result.fileId, format);

    return result;
  }

  /** 获取预签名下载 URL（重新生成，默认 1 小时） */
  @Get(':docId/download')
  async getDownloadUrl(
    @Param('docId') docId: string,
    @CurrentUser() user: JwtPayload,
    @Query('expiresInSec') expiresInSec?: string,
  ) {
    // 越权校验前置：通过后再加载文书详情
    await this.recordService.assertOwner(docId, user.sub, user.role === 'admin');
    const doc = await this.recordService.findByDocId(docId);
    if (!doc.exportFileId) {
      throw new NotFoundException({
        code: 3004,
        message: '文书尚未导出，请先调用 /export 生成文件',
      });
    }
    const expires = expiresInSec ? Number(expiresInSec) : 3600;
    const downloadUrl = await this.exportService.getDownloadUrl(doc.exportFileId, expires);
    return { fileId: doc.exportFileId, downloadUrl, expires };
  }
}
