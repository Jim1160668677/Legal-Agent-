/**
 * MemoryModule —— 会话/记忆模块（A4-W2 抽出，A1-W3 原服务）。
 *
 * 装配 MemoryManagerService（dialog_record 读写 + user_profile 偏好 + 相关记忆召回）。
 * 依赖：
 *   - MongooseModule.forFeature：DialogRecord + UserProfile（@InjectModel 注入）
 *   - LoggerModule：AppLoggerService（可选）
 *
 * A4-W2 抽出动机：AgentsModule 需注入 MemoryManagerService 给 MemoryAgent，
 * 原先 MemoryManagerService 内联在 LegalModule providers 中无法被 AgentsModule 独立导入。
 *
 * 设计依据：A1 §三 NestJS 工程结构；06 §八 MemoryManager；A4 §五 5.3 横切注入。
 */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LoggerModule } from '../../platform/logger/logger.module';
import { DialogRecord, DialogRecordSchema } from '../../../infra/database/schemas/dialog.schema';
import { UserProfile, UserProfileSchema } from '../../../infra/database/schemas/user.schema';
import { MemoryManagerService } from './memory-manager.service';

@Module({
  imports: [
    LoggerModule,
    MongooseModule.forFeature([
      { name: DialogRecord.name, schema: DialogRecordSchema },
      { name: UserProfile.name, schema: UserProfileSchema },
    ]),
  ],
  providers: [MemoryManagerService],
  exports: [MemoryManagerService],
})
export class MemoryModule {}
