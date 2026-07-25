/**
 * JobModule —— 异步任务模块（A3-W4，A3 §八）。
 *
 * 装配 JobService，依赖：
 *   - MongooseModule（AgentJob model）
 *   - PiiModule（PiiService，L4 加密 params）
 *   - LoggerModule（AppLoggerService）
 *
 * 注：JobController 在 LegalModule 中声明（避免在 DocumentModule + LegalModule
 *     双重导入 JobModule 时 controller 路由被重复注册）。
 *
 * 设计依据：A3 §八。
 */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LoggerModule } from '../../platform/logger/logger.module';
import { PiiModule } from '../../platform/pii/pii.module';
import { AgentJob, AgentJobSchema } from '../../../infra/database/schemas/job.schema';
import { JobService } from './job.service';

@Module({
  imports: [
    LoggerModule,
    PiiModule,
    MongooseModule.forFeature([{ name: AgentJob.name, schema: AgentJobSchema }]),
  ],
  providers: [JobService],
  exports: [JobService],
})
export class JobModule {}
