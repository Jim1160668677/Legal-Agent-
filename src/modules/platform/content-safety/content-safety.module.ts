/**
 * ContentSafetyModule —— 暴露 ContentSafetyService（A1-W2）。
 *
 * 默认绑定 PassThroughProvider 到 CONTENT_SAFETY_PROVIDER token。
 * 生产环境可通过覆盖 provider 切换为 TencentCloudProvider（D-5）。
 *
 * 设计依据：A1 §6.7。
 */
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PassThroughProvider } from './passthrough.provider';
import { CONTENT_SAFETY_PROVIDER } from './content-safety.service';
import { ContentSafetyService } from './content-safety.service';

@Module({
  imports: [AuditModule],
  providers: [
    PassThroughProvider,
    {
      provide: CONTENT_SAFETY_PROVIDER,
      useExisting: PassThroughProvider,
    },
    ContentSafetyService,
  ],
  exports: [ContentSafetyService],
})
export class ContentSafetyModule {}
