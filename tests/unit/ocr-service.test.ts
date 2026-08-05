/**
 * OcrServiceImpl 单元测试（v2.4 工具层 OCR 委托）。
 *
 * 覆盖：
 *   - URL 输入直接传给 VisionService
 *   - base64 输入包装为 data:image/jpeg;base64,<...>
 *   - confidence 固定 0.9
 *
 * 设计依据：图像识别系统-多模型主备切换.md §1.7。
 */
import { describe, it, expect, vi } from 'vitest';
import { OcrServiceImpl } from '../../src/modules/legal/vision/ocr-service.impl';

function makeVisionService() {
  return {
    recognize: vi.fn().mockResolvedValue({ text: '识别文本', provider: 'flash', fallbackUsed: false, durationMs: 10 }),
  };
}

describe('OcrServiceImpl（ToolOcrService 委托实现）', () => {
  it('URL 输入 → 直接传给 VisionService', async () => {
    const vision = makeVisionService();
    const ocr = new OcrServiceImpl(vision as never);

    const result = await ocr.recognize('https://example.com/img.png');

    expect(vision.recognize).toHaveBeenCalledWith({ image: 'https://example.com/img.png' });
    expect(result).toEqual({ text: '识别文本', confidence: 0.9 });
  });

  it('base64 输入 → 包装为 data:image/jpeg;base64 前缀', async () => {
    const vision = makeVisionService();
    const ocr = new OcrServiceImpl(vision as never);

    await ocr.recognize('iVBORw0KGgo=');

    expect(vision.recognize).toHaveBeenCalledWith({
      image: 'data:image/jpeg;base64,iVBORw0KGgo=',
    });
  });
});