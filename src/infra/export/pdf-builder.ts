/**
 * pdf-builder —— 最小可用 PDF 1.4 生成器（A3-W3，A3 §5.2）。
 *
 * 设计目标：
 *   - 无外部依赖（不引入 puppeteer / pdfkit），用纯字符串拼接
 *   - 生成 PDF 阅读器可打开的合法 PDF（PDF 1.4 spec）
 *   - 中文支持：用 WinAnsiEncoding 仅支持 ASCII + Latin-1；中文字符 fallback 到 Helvetica
 *     丢弃非 ASCII 字符（避免乱码）。生产可接入 pdfkit + 字体子集化。
 *
 * PDF 结构：
 *   %PDF-1.4
 *   1 0 obj ...（Catalog）
 *   2 0 obj ...（Pages）
 *   3 0 obj ...（Page）
 *   4 0 obj ...（Content stream）
 *   5 0 obj ...（Font）
 *   xref
 *   trailer
 *   %%EOF
 *
 * 文本布局：按 \n 切行，每行 BT ... Td (text) Tj ET。
 * 行高 14pt，起始 y 从页顶 750 递减；超出页面（y<50）分页（简化版不实现分页，
 * 超长文本仅截断到第一页）。
 *
 * 设计依据：A3 §5.2；PDF Reference 1.7。
 */

/** PDF 对象（编号 + 内容） */
interface PdfObject {
  num: number;
  content: string;
}

/** PDF 内容流：把文本编码为绘制指令 */
function buildContentStream(text: string): string {
  const lines = text.split('\n');
  const startY = 750;
  const lineHeight = 14;
  const commands: string[] = [];

  let y = startY;
  for (const line of lines) {
    if (y < 50) break; // 简化：超出第一页截断
    // 转义 PDF 字符串特殊字符：() \
    const escaped = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    // 丢弃非 Latin-1 字符（避免乱码；生产应接入字体子集化）
    const safe = escaped.replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
    commands.push(`BT 1 0 0 1 50 ${y} Tm (${safe}) Tj ET`);
    y -= lineHeight;
  }
  return commands.join('\n');
}

/**
 * 把渲染后的文书文本生成 PDF 二进制。
 *
 * @param text 渲染后的文书正文（含免责声明）
 * @returns PDF 文件 Buffer
 */
export function buildPdf(text: string): Buffer {
  const contentStream = buildContentStream(text);

  const objects: PdfObject[] = [
    // 1: Catalog
    { num: 1, content: '<< /Type /Catalog /Pages 2 0 R >>' },
    // 2: Pages
    { num: 2, content: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    // 3: Page
    {
      num: 3,
      content:
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
        '/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    },
    // 4: Content stream
    {
      num: 4,
      content: `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`,
    },
    // 5: Font
    {
      num: 5,
      content: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    },
  ];

  // 拼装 body
  const parts: string[] = ['%PDF-1.4\n'];
  const offsets: number[] = []; // 每个对象的字节偏移
  let offset = 0;

  // 头
  const header = '%PDF-1.4\n';
  parts.push(header);
  offset += header.length;

  // 对象
  for (const obj of objects) {
    offsets[obj.num - 1] = offset;
    const objStr = `${obj.num} 0 obj\n${obj.content}\nendobj\n`;
    parts.push(objStr);
    offset += objStr.length;
  }

  // xref
  const xrefStart = offset;
  const xrefLines: string[] = [];
  xrefLines.push(`xref`);
  xrefLines.push(`0 ${objects.length + 1}`);
  xrefLines.push(`0000000000 65535 f `);
  for (let i = 0; i < objects.length; i++) {
    xrefLines.push(`${String(offsets[i]).padStart(10, '0')} 00000 n `);
  }
  const xrefStr = xrefLines.join('\n') + '\n';
  parts.push(xrefStr);

  // trailer
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  parts.push(trailer);

  return Buffer.from(parts.join(''), 'latin1');
}

/** PDF MIME 类型 */
export const PDF_CONTENT_TYPE = 'application/pdf';

/** PDF 文件魔数：%PDF- */
export const PDF_MAGIC = Buffer.from('%PDF', 'latin1');
