/**
 * DocumentModule —— 法律文书生成模块（A3-W2）。
 *
 * 装配 DocumentGeneratorService，依赖：
 *   - LoggerModule（AppLoggerService）
 *   - AuditModule（AuditLogService）
 *   - RagModule（RagService，可选法条检索增强）
 *
 * 注：DocumentGeneratorService 所有依赖均 @Optional，确保单测可独立构造，
 *     且在未接入 RAG 的环境下仍能完成基础文书生成。
 *
 * 设计依据：A3-W2 实施计划阶段 6；A3 §4.1。
 */
import { Module } from '@nestjs/common';
import { LoggerModule } from '../../platform/logger/logger.module';
import { AuditModule } from '../../platform/audit/audit.module';
import { RagModule } from '../retrieval/rag.module';
import { DocumentGeneratorService } from './document-generator.service';

@Module({
  imports: [LoggerModule, AuditModule, RagModule],
  providers: [DocumentGeneratorService],
  exports: [DocumentGeneratorService],
})
export class DocumentModule {}
