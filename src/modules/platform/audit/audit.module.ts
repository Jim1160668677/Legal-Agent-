/**
 * AuditModule —— 暴露 AuditLogService（A1-W2）。
 *
 * 依赖 AuditLog Model（DatabaseModule 已注册）+ AppLoggerService。
 *
 * 设计依据：A1 §6.3。
 */
import { Module } from '@nestjs/common';
import { LoggerModule } from '../logger/logger.module';
import { AuditLogService } from './audit-log.service';

@Module({
  imports: [LoggerModule],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
