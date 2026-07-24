/**
 * PiiModule —— 暴露 PiiService（A1-W2）。
 *
 * 设计依据：A1 §6.2。
 */
import { Module } from '@nestjs/common';
import { PiiService } from './pii.service';

@Module({
  providers: [PiiService],
  exports: [PiiService],
})
export class PiiModule {}
