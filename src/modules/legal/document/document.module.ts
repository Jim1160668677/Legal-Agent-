/**
 * DocumentModule —— 法律文书生成模块（A3-W2 + A3-W3 扩展）。
 *
 * 装配：
 *   - DocumentGeneratorService（A3-W2：DSL 渲染 + 模板加载）
 *   - DocumentRecordService（A3-W3：document_record 持久化 + L4 加密）
 *
 * 依赖：
 *   - LoggerModule（AppLoggerService）
 *   - AuditModule（AuditLogService）
 *   - RagModule（RagService，可选法条检索增强）
 *   - PiiModule（PiiService，L4 加密 varsFilled）
 *   - ExportModule（ExportService，A3-W3 文书导出）
 *
 * 注：DocumentGeneratorService 所有依赖均 @Optional，确保单测可独立构造，
 *     且在未接入 RAG 的环境下仍能完成基础文书生成。
 *
 * 设计依据：A3-W2 实施计划阶段 6；A3 §4.1；A3 §5；A3 §七。
 */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LoggerModule } from '../../platform/logger/logger.module';
import { AuditModule } from '../../platform/audit/audit.module';
import { PiiModule } from '../../platform/pii/pii.module';
import { RagModule } from '../retrieval/rag.module';
import { ExportModule } from '../export/export.module';
import { JobModule } from '../job/job.module';
import {
  DocumentRecord,
  DocumentRecordSchema,
} from '../../../infra/database/schemas/document.schema';
import { DocumentGeneratorService } from './document-generator.service';
import { DocumentRecordService } from './document-record.service';
import { DocumentController } from './document.controller';

@Module({
  imports: [
    LoggerModule,
    AuditModule,
    PiiModule,
    RagModule,
    ExportModule,
    JobModule,
    MongooseModule.forFeature([{ name: DocumentRecord.name, schema: DocumentRecordSchema }]),
  ],
  controllers: [DocumentController],
  providers: [DocumentGeneratorService, DocumentRecordService],
  exports: [DocumentGeneratorService, DocumentRecordService],
})
export class DocumentModule {}
