/**
 * PiiService —— PII 分级 + 脱敏 + L4 加密（A1-W2）。
 *
 * 职责（A1 §6.2）：
 *   1. classify(text)：识别文本中 PII 等级（L1 公开 / L2 一般 / L3 敏感 / L4 高敏）
 *   2. mask(text, level)：按等级脱敏（手机号 → 138****1234，身份证 → 110***********1234）
 *   3. encrypt(plain) / decrypt(cipher)：L4 字段 AES-256-GCM 加密入库
 *   4. assertBoundary(inputLevel, allowedLevel)：超界抛 7004
 *   5. detectAndMask(text)：自动检测并脱敏文本中的 PII（用于 LLM prompt 注入前）
 *
 * 设计依据：A1 §6.2；03 §二 数据分级；03 §三 加密策略；03 §四 PII 识别与脱敏。
 */
import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export type PiiLevel = 'L1' | 'L2' | 'L3' | 'L4';

export interface DetectResult {
  level: PiiLevel;
  /** 脱敏后的文本 */
  masked: string;
  /** 命中的 PII 类型列表 */
  hits: PiiHit[];
}

export interface PiiHit {
  type: 'phone' | 'idcard' | 'bankcard' | 'email' | 'name';
  value: string;
  start: number;
  end: number;
}

const LEVEL_RANK: Record<PiiLevel, number> = { L1: 1, L2: 2, L3: 3, L4: 4 };

// 正则：宽松匹配，命中后由 mask 统一脱敏
const PATTERNS: Array<{ type: PiiHit['type']; re: RegExp; level: PiiLevel }> = [
  // 身份证 18 位（含末位 X）— L4（优先于银行卡，避免 18 位身份证被银行卡误匹配）
  { type: 'idcard', re: /\b\d{17}[\dXx]\b/g, level: 'L4' },
  // 银行卡 16-17 或 19 位（排除 18 位，因 18 位几乎都是身份证）— L4
  { type: 'bankcard', re: /\b(?:\d{16,17}|\d{19})\b/g, level: 'L4' },
  // 手机号 11 位（1 开头）— L3
  { type: 'phone', re: /\b1[3-9]\d{9}\b/g, level: 'L3' },
  // 邮箱 — L3
  { type: 'email', re: /[\w.+-]+@[\w-]+\.[\w.-]+/g, level: 'L3' },
];

@Injectable()
export class PiiService {
  private readonly encryptionKey: Buffer;

  constructor(config: ConfigService) {
    // 密钥来源：环境变量 PII_ENCRYPTION_KEY（32 字节 hex 或 base64）；缺失则用 jwt.secret 派生
    const raw = config.get<string>('app.pii.encryptionKey');
    if (raw && raw.length >= 32) {
      this.encryptionKey = Buffer.from(raw.slice(0, 32), 'utf8');
    } else {
      // 派生：SHA-256(jwt.secret) 截 32 字节，确保 dev 环境可用
      const seed = config.get<string>('app.jwt.secret') ?? 'legal-agent-pii-seed';
      this.encryptionKey = createHash('sha256').update(seed).digest();
    }
  }

  // ===== 分级 =====

  /** 识别文本中最高 PII 等级；无命中返回 L1 */
  classify(text: string): PiiLevel {
    const hits = this.detect(text);
    if (hits.length === 0) return 'L1';
    return hits.reduce((max, h) => {
      const lv = PATTERNS.find((p) => p.type === h.type)?.level ?? 'L1';
      return LEVEL_RANK[lv] > LEVEL_RANK[max] ? lv : max;
    }, 'L1' as PiiLevel);
  }

  // ===== 脱敏 =====

  /**
   * 按指定等级脱敏整段文本。
   * L1：原样；L2：仅打码命中项的中段；L3/L4：全量 detectAndMask。
   */
  mask(text: string, level: PiiLevel): string {
    if (level === 'L1') return text;
    return this.detectAndMask(text).masked;
  }

  /** 自动检测并脱敏文本中的 PII，返回脱敏结果 + 命中明细 */
  detectAndMask(text: string): DetectResult {
    const hits: PiiHit[] = [];
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = p.re.exec(text)) !== null) {
        hits.push({
          type: p.type,
          value: m[0],
          start: m.index,
          end: m.index + m[0].length,
        });
      }
    }
    if (hits.length === 0) {
      return { level: 'L1', masked: text, hits: [] };
    }

    // 按起始位置倒序替换，避免索引偏移
    const sorted = [...hits].sort((a, b) => b.start - a.start);
    let masked = text;
    for (const h of sorted) {
      masked = masked.slice(0, h.start) + this.maskValue(h.value, h.type) + masked.slice(h.end);
    }

    const level = hits.reduce((max, h) => {
      const lv = PATTERNS.find((p) => p.type === h.type)?.level ?? 'L1';
      return LEVEL_RANK[lv] > LEVEL_RANK[max] ? lv : max;
    }, 'L1' as PiiLevel);

    return { level, masked, hits };
  }

  // ===== 边界校验 =====

  /**
   * PII 边界校验：inputLevel 超过 allowedLevel 抛 7004。
   * 用于外部 agent 调用入口（03 §2.1）。
   */
  assertBoundary(inputLevel: PiiLevel, allowedLevel: PiiLevel): void {
    if (LEVEL_RANK[inputLevel] > LEVEL_RANK[allowedLevel]) {
      throw new BadRequestException({
        code: 7004,
        message: `PII 边界违规：输入 ${inputLevel} 超过允许 ${allowedLevel}`,
      });
    }
  }

  // ===== L4 字段加密 =====

  /**
   * AES-256-GCM 加密。
   * @returns base64(iv|authTag|ciphertext)，decrypt 可还原
   */
  encrypt(plain: string): string {
    const iv = randomBytes(12); // GCM 推荐 12 字节
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
  }

  /** 解密 encrypt 的输出 */
  decrypt(cipherText: string): string {
    let buf: Buffer;
    try {
      buf = Buffer.from(cipherText, 'base64');
    } catch {
      throw new BadRequestException({ code: 1001, message: '密文非合法 base64' });
    }
    if (buf.length < 12 + 16) {
      throw new BadRequestException({ code: 1001, message: '密文长度不足' });
    }
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    } catch {
      throw new InternalServerErrorException({
        code: 5001,
        message: 'PII 解密失败（密钥/标签不匹配）',
      });
    }
  }

  // ===== 私有辅助 =====

  /** 单值脱敏：按类型保留首尾，中段打码 */
  private maskValue(value: string, type: PiiHit['type']): string {
    switch (type) {
      case 'phone':
        // 138****1234
        return value.length === 11
          ? `${value.slice(0, 3)}****${value.slice(7)}`
          : `${value.slice(0, 2)}****`;
      case 'idcard':
        // 110***********1234
        return `${value.slice(0, 3)}${'*'.repeat(Math.max(value.length - 7, 4))}${value.slice(-4)}`;
      case 'bankcard':
        // **** **** **** 1234
        return `**** **** **** ${value.slice(-4)}`;
      case 'email': {
        const [name, domain] = value.split('@');
        if (!domain) return '****';
        const maskedName = name.length <= 2 ? '****' : `${name.slice(0, 2)}****`;
        return `${maskedName}@${domain}`;
      }
      case 'name':
        return value.length <= 1 ? '*' : `${value[0]}${'*'.repeat(value.length - 1)}`;
      default:
        return '****';
    }
  }

  /** 检测命中（不脱敏），供 classify 复用 */
  private detect(text: string): PiiHit[] {
    const hits: PiiHit[] = [];
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = p.re.exec(text)) !== null) {
        hits.push({
          type: p.type,
          value: m[0],
          start: m.index,
          end: m.index + m[0].length,
        });
      }
    }
    return hits;
  }
}
