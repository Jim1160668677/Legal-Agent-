/**
 * ExportModule —— 文书导出模块（A3-W3，A3 §5）。
 *
 * 装配 ExportService，依赖：
 *   - StorageModule（OBJECT_STORAGE_TOKEN）
 *   - AuditModule（AuditLogService，可选）
 *   - LoggerModule（AppLoggerService，可选）
 *
 * 设计依据：A3 §5。
 */
import { Module } from '@nestjs/common';
import { StorageModule } from '../../../infra/storage/storage.module';
import { LoggerModule } from '../../platform/logger/logger.module';
import { AuditModule } from '../../platform/audit/audit.module';
import { ExportService } from './export.service';

@Module({
  imports: [StorageModule, LoggerModule, AuditModule],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
