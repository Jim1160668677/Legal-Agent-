/**
 * docx-builder —— 最小可用 .docx 生成器（A3-W3，A3 §5.2）。
 *
 * 设计目标：
 *   - 无外部依赖（不引入 docx-templater / officegen），用 Node 内置 zlib + 手写最小 ZIP
 *   - 生成 Word 可打开的合法 .docx（OOXML 格式）
 *   - 保留 renderedText 换行结构（每行作为一个 <w:p>）
 *
 * .docx 本质是一个 ZIP 包，含：
 *   - [Content_Types].xml
 *   - _rels/.rels
 *   - word/document.xml（核心：正文）
 *   - word/_rels/document.xml.rels
 *
 * ZIP 格式：每文件 Local File Header + Data Descriptor + Central Directory。
 * 此处采用「Stored」（无压缩）方式，避免实现 deflate 算法（zlib.deflateRawSync 也可，
 * 但 Stored 更简单且 Word 兼容）。
 *
 * 设计依据：A3 §5.2；ECMA-376 OOXML；ZIP APPNOTE 6.3.0。
 */
import { crc32 } from 'node:zlib';

/** XML 转义（& < > " '） */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 把纯文本切成段落（按 \n 分割），生成 OOXML 段落 */
function textToDocumentXml(text: string): string {
  const lines = text.split('\n');
  const paragraphs = lines
    .map((line) => {
      const escaped = escapeXml(line);
      // 空段落也保留（Word 行为一致）
      return `    <w:p><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
${paragraphs}
  </w:body>
</w:document>`;
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

interface ZipEntry {
  name: string;
  data: Buffer;
}

/**
 * 构造最小 ZIP 包（Stored，无压缩）。
 * ZIP 结构（APPNOTE 6.3.0）：
 *   每个 entry：Local File Header + 文件数据
 *   末尾：Central Directory + End Of Central Directory Record
 */
function buildZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data); // zlib.crc32 返回 number（unsigned 32-bit）
    const size = entry.data.length;

    // Local File Header（30 字节固定 + 文件名）
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version needed (2.0)
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // compression: 0 = stored
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc >>> 0, 14); // crc-32
    local.writeUInt32LE(size, 18); // compressed size
    local.writeUInt32LE(size, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26); // filename length
    local.writeUInt16LE(0, 28); // extra field length
    nameBuf.copy(local, 30);

    localParts.push(local, entry.data);

    // Central Directory Record（46 字节固定 + 文件名）
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0); // signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // compression
    central.writeUInt16LE(0, 12); // mod time
    central.writeUInt16LE(0, 14); // mod date
    central.writeUInt32LE(crc >>> 0, 16); // crc-32
    central.writeUInt32LE(size, 20); // compressed size
    central.writeUInt32LE(size, 24); // uncompressed size
    central.writeUInt16LE(nameBuf.length, 28); // filename length
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset
    nameBuf.copy(central, 46);

    centralParts.push(central);

    offset += local.length + entry.data.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const localBuf = Buffer.concat(localParts);

  // End Of Central Directory Record（22 字节固定）
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralBuf.length, 12); // central dir size
  eocd.writeUInt32LE(offset, 16); // central dir offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localBuf, centralBuf, eocd]);
}

/**
 * 把渲染后的文书文本生成 .docx 二进制。
 *
 * @param text 渲染后的文书正文（含免责声明）
 * @returns .docx 文件 Buffer（Content-Type: application/vnd.openxmlformats...）
 */
export function buildDocx(text: string): Buffer {
  const documentXml = textToDocumentXml(text);
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES_XML, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS_XML, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(DOCUMENT_RELS_XML, 'utf8') },
  ];
  return buildZip(entries);
}

/** .docx MIME 类型 */
export const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** .docx 文件魔数：ZIP 文件头 PK\x03\x04 */
export const DOCX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
