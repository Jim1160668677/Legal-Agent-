/**
 * CitationGraphModule —— 法条引用图谱模块（v2.3-W3，14 §14.7）。
 *
 * 注册 CitationGraphBuilderService，导入所需 Mongoose schema：
 *   - LawCitationGraph（图谱输出）
 *   - CasePrecedent（全量重建输入）
 *   - DocumentRecord（全量重建输入）
 *
 * 设计依据：14 §14.7 模块实现；04 1.10 采集域。
 */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  LawCitationGraph,
  LawCitationGraphSchema,
} from '../../../infra/database/schemas/citation-graph.schema';
import { CasePrecedent, CasePrecedentSchema } from '../../../infra/database/schemas/legal.schema';
import {
  DocumentRecord,
  DocumentRecordSchema,
} from '../../../infra/database/schemas/document.schema';
import { LoggerModule } from '../../platform/logger/logger.module';
import { CitationGraphBuilderService } from './citation-graph-builder.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LawCitationGraph.name, schema: LawCitationGraphSchema },
      { name: CasePrecedent.name, schema: CasePrecedentSchema },
      { name: DocumentRecord.name, schema: DocumentRecordSchema },
    ]),
    LoggerModule,
  ],
  providers: [CitationGraphBuilderService],
  exports: [CitationGraphBuilderService],
})
export class CitationGraphModule {}
