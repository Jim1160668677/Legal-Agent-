/**
 * PassThroughProvider 单元测试（A1-W2 默认内容安全占位适配器）。
 *
 * 覆盖：
 *   - 常规文本 → safe
 *   - 超 10000 字符 → 拒绝（too_long）
 *   - 恰好 10000 字符 → 放行
 *
 * 设计依据：A1 §6.7；A1 §十四 风险。
 */
import { describe, it, expect } from 'vitest';
import { PassThroughProvider } from '../../src/modules/platform/content-safety/passthrough.provider';

describe('PassThroughProvider', () => {
  const provider = new PassThroughProvider();

  it('常规文本 → safe', async () => {
    expect(await provider.checkText('你好，我想咨询劳动合同问题')).toEqual({ safe: true });
  });

  it('超 10000 字符 → 拒绝 too_long', async () => {
    const result = await provider.checkText('x'.repeat(10_001));
    expect(result.safe).toBe(false);
    expect(result.category).toBe('too_long');
    expect(result.reason).toContain('10000');
  });

  it('恰好 10000 字符 → 放行', async () => {
    expect(await provider.checkText('x'.repeat(10_000))).toEqual({ safe: true });
  });

  it('name = passthrough', () => {
    expect(provider.name).toBe('passthrough');
  });
});