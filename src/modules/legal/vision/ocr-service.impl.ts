/**
 * OcrServiceImpl — ToolOcrService 实现（v2.4）。
 *
 * 实现 src/services/legal/tools/types.ts 的 ToolOcrService 接口，
 * 委托 VisionService.recognize() 完成图像识别。
 *
 * 集成点：经 ToolAgent 注入 ToolContext.ocrService，供 LicenseOcrTool 调用。
 *
 * fileId 处理：
 *   - 以 'http' 开头 → 视为图片 URL
 *   - 否则 → 视为 base64，包装为 data:image/jpeg;base64,<...>
 *
 * confidence 固定返回 0.9（大模型识别置信度，非传统 OCR 概率）。
 *
 * 设计依据：.trae/documents/图像识别系统-多模型主备切换.md §1.7
 */
import { Injectable } from '@nestjs/common';
import { VisionService } from './vision.service';
import type { ToolOcrService } from '../../../services/legal/tools/types';

@Injectable()
export class OcrServiceImpl implements ToolOcrService {
  constructor(private readonly visionService: VisionService) {}

  async recognize(fileId: string): Promise<{ text: string; confidence: number }> {
    const image = fileId.startsWith('http') ? fileId : `data:image/jpeg;base64,${fileId}`;
    const result = await this.visionService.recognize({ image });
    return { text: result.text, confidence: 0.9 };
  }
}
