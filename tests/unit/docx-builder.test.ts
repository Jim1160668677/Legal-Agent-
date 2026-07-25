/**
 * docx-builder 单元测试（A3-W3）。
 *
 * 覆盖：
 *   - 生成的 Buffer 非空且以 ZIP 魔数 PK\x03\x04 开头
 *   - 包含 [Content_Types].xml / word/document.xml 等 OOXML 必需文件
 *   - 文本内容正确嵌入 document.xml（XML 转义）
 *   - 多行文本生成多个 <w:p> 段落
 *   - 空文本也能生成合法 docx
 *   - 特殊字符（< > & " '）正确转义
 */
import { describe, it, expect } from 'vitest';
import { buildDocx, DOCX_MAGIC, DOCX_CONTENT_TYPE } from '../../src/infra/export/docx-builder';
import { unzipSync } from 'node:zlib';

describe('docx-builder', () => {
  describe('buildDocx', () => {
    it('生成 Buffer 非空且以 ZIP 魔数开头', () => {
      const buf = buildDocx('hello world');
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(100);
      // ZIP 魔数：PK\x03\x04
      expect(buf.subarray(0, 4)).toEqual(DOCX_MAGIC);
    });

    it('包含 OOXML 必需文件', () => {
      const buf = buildDocx('test content');
      const entries = listZipEntries(buf);
      expect(entries).toContain('[Content_Types].xml');
      expect(entries).toContain('_rels/.rels');
      expect(entries).toContain('word/document.xml');
      expect(entries).toContain('word/_rels/document.xml.rels');
    });

    it('文本内容正确嵌入 document.xml', () => {
      const buf = buildDocx('Hello Legal Agent');
      const docXml = readZipEntry(buf, 'word/document.xml');
      expect(docXml).toContain('Hello Legal Agent');
      expect(docXml).toContain('<w:body>');
      expect(docXml).toContain('<w:t xml:space="preserve">');
    });

    it('多行文本生成多个段落', () => {
      const buf = buildDocx('第一行\n第二行\n第三行');
      const docXml = readZipEntry(buf, 'word/document.xml');
      const paragraphCount = (docXml.match(/<w:p>/g) || []).length;
      expect(paragraphCount).toBe(3);
    });

    it('空文本生成单个空段落', () => {
      const buf = buildDocx('');
      const docXml = readZipEntry(buf, 'word/document.xml');
      const paragraphCount = (docXml.match(/<w:p>/g) || []).length;
      expect(paragraphCount).toBe(1);
    });

    it('XML 特殊字符正确转义', () => {
      const buf = buildDocx('a < b & c > d " e \' f');
      const docXml = readZipEntry(buf, 'word/document.xml');
      // 转义后不应含原始 < > & " '
      expect(docXml).toContain('&lt;');
      expect(docXml).toContain('&gt;');
      expect(docXml).toContain('&amp;');
      expect(docXml).toContain('&quot;');
      expect(docXml).toContain('&apos;');
    });

    it('中文文本正确嵌入（UTF-8）', () => {
      const buf = buildDocx('原告：张三，被告：李四');
      const docXml = readZipEntry(buf, 'word/document.xml');
      expect(docXml).toContain('原告：张三，被告：李四');
    });
  });

  describe('常量', () => {
    it('DOCX_CONTENT_TYPE 正确', () => {
      expect(DOCX_CONTENT_TYPE).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
    });

    it('DOCX_MAGIC 为 PK\\x03\\x04', () => {
      expect(Array.from(DOCX_MAGIC)).toEqual([0x50, 0x4b, 0x03, 0x04]);
    });
  });
});

// ===== 辅助：解析 ZIP 文件名列表 =====

/** 读取 ZIP 中央目录中的文件名列表（不依赖外部 unzip 库） */
function listZipEntries(buf: Buffer): string[] {
  const entries: string[] = [];
  // 找到 End Of Central Directory Record（PK\x05\x06）
  const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.subarray(i, i + 4).equals(eocdSig)) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('EOCD not found');
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  let offset = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    entries.push(name);
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** 读取 ZIP 中指定文件的内容（Local File Header → 数据） */
function readZipEntry(buf: Buffer, name: string): string {
  const entries = listZipEntries(buf);
  const idx = entries.indexOf(name);
  if (idx < 0) throw new Error(`entry not found: ${name}`);

  // 重新遍历找 Local File Header（按顺序对应中央目录条目）
  const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.subarray(i, i + 4).equals(eocdSig)) {
      eocdOffset = i;
      break;
    }
  }
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  let cdCursor = cdOffset;
  let localOffset = 0;
  for (let i = 0; i < totalEntries; i++) {
    const nameLen = buf.readUInt16LE(cdCursor + 28);
    const extraLen = buf.readUInt16LE(cdCursor + 30);
    const commentLen = buf.readUInt16LE(cdCursor + 32);
    const localHeaderOffset = buf.readUInt32LE(cdCursor + 42);
    if (i === idx) {
      localOffset = localHeaderOffset;
      break;
    }
    cdCursor += 46 + nameLen + extraLen + commentLen;
  }

  // 解析 Local File Header
  const localNameLen = buf.readUInt16LE(localOffset + 26);
  const localExtraLen = buf.readUInt16LE(localOffset + 28);
  const compSize = buf.readUInt32LE(localOffset + 18);
  const dataStart = localOffset + 30 + localNameLen + localExtraLen;
  const data = buf.subarray(dataStart, dataStart + compSize);
  // Stored（无压缩）：直接返回
  // 注：unzipSync 仅用于类型兼容，实际 Stored 数据不需要解压
  void unzipSync;
  return data.toString('utf8');
}
