/**
 * PiiService 单元测试（A1-W2）。
 *
 * 验收点：
 *   - classify 识别 L1/L3/L4
 *   - mask 手机号/身份证/银行卡/邮箱脱敏正确
 *   - detectAndMask 多命中场景
 *   - encrypt/decrypt 往返一致
 *   - assertBoundary 超界抛 7004
 *
 * 设计依据：A1 §6.2 + 03 §二/三/四。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PiiService } from '../../src/modules/platform/pii/pii.service';

function makeConfig(encryptionKey?: string): ConfigService {
  return {
    get: <T>(key: string): T => {
      if (key === 'app.pii.encryptionKey') return encryptionKey as T;
      if (key === 'app.jwt.secret') return 'test-jwt-secret-32chars-min!!' as T;
      return undefined as T;
    },
  } as unknown as ConfigService;
}

describe('PiiService', () => {
  let svc: PiiService;

  beforeEach(() => {
    svc = new PiiService(makeConfig());
  });

  describe('classify', () => {
    it('纯文本 → L1', () => {
      expect(svc.classify('民法典第一百四十三条')).toBe('L1');
    });
    it('含手机号 → L3', () => {
      expect(svc.classify('联系我 13812345678')).toBe('L3');
    });
    it('含身份证 → L4', () => {
      expect(svc.classify('身份证 110101199003071234')).toBe('L4');
    });
    it('手机号+身份证并存 → L4（取最高）', () => {
      expect(svc.classify('13812345678 和 110101199003071234')).toBe('L4');
    });
  });

  describe('mask', () => {
    it('L1 原样返回', () => {
      const text = '合同法第八条';
      expect(svc.mask(text, 'L1')).toBe(text);
    });
    it('手机号 → 138****5678', () => {
      expect(svc.mask('电话13812345678', 'L3')).toBe('电话138****5678');
    });
    it('身份证 → 110***********1234', () => {
      expect(svc.mask('身份证110101199003071234', 'L4')).toBe('身份证110***********1234');
    });
    it('银行卡 → **** **** **** 1234', () => {
      expect(svc.mask('卡号6222020200011112222', 'L4')).toBe('卡号**** **** **** 2222');
    });
    it('邮箱 → 首两字符+****@domain', () => {
      expect(svc.mask('邮箱 zhang@example.com', 'L3')).toBe('邮箱 zh****@example.com');
    });
  });

  describe('detectAndMask', () => {
    it('多命中同时脱敏', () => {
      const text = '手机13812345678 邮箱a@b.com 身份证110101199003071234';
      const r = svc.detectAndMask(text);
      expect(r.level).toBe('L4');
      expect(r.masked).not.toContain('13812345678');
      expect(r.masked).not.toContain('110101199003071234');
      expect(r.masked).not.toContain('a@b.com');
      expect(r.hits).toHaveLength(3);
    });
    it('无命中 → L1 + 原文', () => {
      const r = svc.detectAndMask('民法典');
      expect(r.level).toBe('L1');
      expect(r.masked).toBe('民法典');
      expect(r.hits).toHaveLength(0);
    });
  });

  describe('encrypt / decrypt', () => {
    it('往返一致', () => {
      const plain = '我的身份证号是110101199003071234';
      const cipher = svc.encrypt(plain);
      expect(cipher).not.toBe(plain);
      expect(svc.decrypt(cipher)).toBe(plain);
    });
    it('每次加密密文不同（IV 随机）', () => {
      const plain = 'secret';
      expect(svc.encrypt(plain)).not.toBe(svc.encrypt(plain));
    });
    it('密钥篡改 → 解密失败', () => {
      const cipher = svc.encrypt('secret');
      // 用 40 字符密钥确保 >=32，走显式密钥分支（不走 jwt.secret 派生）
      const svc2 = new PiiService(makeConfig('X'.repeat(40)));
      expect(() => svc2.decrypt(cipher)).toThrow();
    });
    it('非法密文 → 抛错', () => {
      expect(() => svc.decrypt('not-valid-base64-密文')).toThrow(BadRequestException);
    });
  });

  describe('assertBoundary', () => {
    it('L1 输入到 L3 允许 → 不抛', () => {
      expect(() => svc.assertBoundary('L1', 'L3')).not.toThrow();
    });
    it('L4 输入到 L3 禁止 → 抛 7004', () => {
      expect(() => svc.assertBoundary('L4', 'L3')).toThrow(BadRequestException);
    });
    it('同等级允许', () => {
      expect(() => svc.assertBoundary('L3', 'L3')).not.toThrow();
    });
  });
});
