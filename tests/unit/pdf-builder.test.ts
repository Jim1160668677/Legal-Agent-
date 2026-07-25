/**
 * pdf-builder 单元测试（A3-W3）。
 *
 * 覆盖：
 *   - 生成的 Buffer 非空且以 %PDF- 魔数开头
 *   - 以 %%EOF 结尾
 *   - 包含 xref/trailer/Catalog/Pages/Page 等关键结构
 *   - 文本内容嵌入内容流（ASCII 部分）
 *   - 多行文本生成多个 Tj 指令
 *   - 特殊字符 () \ 正确转义
 */
import { describe, it, expect } from 'vitest';
import { buildPdf, PDF_MAGIC, PDF_CONTENT_TYPE } from '../../src/infra/export/pdf-builder';

describe('pdf-builder', () => {
  describe('buildPdf', () => {
    it('生成 Buffer 非空且以 %PDF- 魔数开头', () => {
      const buf = buildPdf('hello world');
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(100);
      expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF');
      expect(buf.subarray(0, 4)).toEqual(PDF_MAGIC);
    });

    it('以 %%EOF 结尾', () => {
      const buf = buildPdf('test');
      const tail = buf.subarray(-10).toString('latin1');
      expect(tail).toContain('%%EOF');
    });

    it('包含 PDF 关键结构', () => {
      const content = buildPdf('test').toString('latin1');
      expect(content).toContain('xref');
      expect(content).toContain('trailer');
      expect(content).toContain('/Type /Catalog');
      expect(content).toContain('/Type /Pages');
      expect(content).toContain('/Type /Page');
      expect(content).toContain('/Type /Font');
      expect(content).toContain('startxref');
    });

    it('ASCII 文本嵌入内容流', () => {
      const buf = buildPdf('Hello Legal Agent');
      const content = buf.toString('latin1');
      expect(content).toContain('Hello Legal Agent');
      expect(content).toContain('Tj');
    });

    it('多行文本生成多个 Tj 指令', () => {
      const buf = buildPdf('line1\nline2\nline3');
      const content = buf.toString('latin1');
      const tjCount = (content.match(/\) Tj/g) || []).length;
      expect(tjCount).toBe(3);
    });

    it('PDF 字符串特殊字符 () \\ 正确转义', () => {
      const buf = buildPdf('a (b) c \\ d');
      const content = buf.toString('latin1');
      // 转义后应含 \( \) \\
      expect(content).toContain('\\(');
      expect(content).toContain('\\)');
      expect(content).toContain('\\\\');
    });

    it('非 ASCII 字符（中文）被丢弃（避免乱码）', () => {
      const buf = buildPdf('Hello 你好 World');
      const content = buf.toString('latin1');
      // 中文被丢弃，保留 ASCII
      expect(content).toContain('Hello');
      expect(content).toContain('World');
      // 内容流中不应出现中文（UTF-8 多字节）
      const streamMatch = content.match(/stream\n([\s\S]*?)\nendstream/);
      expect(streamMatch).not.toBeNull();
      const stream = streamMatch![1];
      expect(stream).not.toContain('你好');
    });

    it('超长文本（超过一页）截断到第一页', () => {
      const longText = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join('\n');
      const buf = buildPdf(longText);
      const content = buf.toString('latin1');
      const tjCount = (content.match(/\) Tj/g) || []).length;
      // 一页约 50 行（750/14），100 行应被截断
      expect(tjCount).toBeLessThan(100);
      expect(tjCount).toBeGreaterThan(40);
    });
  });

  describe('常量', () => {
    it('PDF_CONTENT_TYPE 正确', () => {
      expect(PDF_CONTENT_TYPE).toBe('application/pdf');
    });

    it('PDF_MAGIC 为 %PDF', () => {
      expect(PDF_MAGIC.toString('latin1')).toBe('%PDF');
    });
  });
});
