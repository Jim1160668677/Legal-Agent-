/**
 * ContentSafetyService 单元测试（A1-W2）。
 *
 * 验收点：
 *   - PassThroughProvider 默认放行
 *   - 超长输入（>10000 字符）→ safe=false
 *   - checkInput 命中违规抛 6002 + 写审计
 *   - checkOutput 返回结果不抛错（业务侧决策）
 *
 * 设计依据：A1 §6.7。
 */
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ContentSafetyService } from '../../src/modules/platform/content-safety/content-safety.service';
import { PassThroughProvider } from '../../src/modules/platform/content-safety/passthrough.provider';
import type { AuditLogService } from '../../src/modules/platform/audit/audit-log.service';

function makeAudit(): AuditLogService {
  return {
    write: vi.fn(),
    writeSync: vi.fn(),
  } as unknown as AuditLogService;
}

describe('ContentSafetyService (PassThrough)', () => {
  it('正常文本 → checkInput 不抛错', async () => {
    const svc = new ContentSafetyService(new PassThroughProvider(), makeAudit());
    await expect(svc.checkInput('你好，咨询一下离婚程序')).resolves.toBeUndefined();
  });

  it('超长输入 → checkInput 抛 6002', async () => {
    const svc = new ContentSafetyService(new PassThroughProvider(), makeAudit());
    const longText = 'a'.repeat(10_001);
    await expect(svc.checkInput(longText)).rejects.toThrow(BadRequestException);
    try {
      await svc.checkInput(longText);
    } catch (e) {
      const err = e as BadRequestException;
      const resp = err.getResponse() as { code: number };
      expect(resp.code).toBe(6002);
    }
  });

  it('checkOutput 命中违规不抛错，返回 safe=false', async () => {
    const svc = new ContentSafetyService(new PassThroughProvider(), makeAudit());
    const longText = 'a'.repeat(10_001);
    const r = await svc.checkOutput(longText);
    expect(r.safe).toBe(false);
    expect(r.category).toBe('too_long');
  });

  it('命中违规写审计 compliance_blocked', async () => {
    const audit = makeAudit();
    const svc = new ContentSafetyService(new PassThroughProvider(), audit);
    const longText = 'a'.repeat(10_001);
    await svc.checkOutput(longText);
    expect(audit.write).toHaveBeenCalledWith(
      'compliance_blocked',
      expect.objectContaining({ stage: 'output', provider: 'passthrough' }),
    );
  });

  it('正常文本不写审计', async () => {
    const audit = makeAudit();
    const svc = new ContentSafetyService(new PassThroughProvider(), audit);
    await svc.checkInput('正常文本');
    expect(audit.write).not.toHaveBeenCalled();
  });
});
