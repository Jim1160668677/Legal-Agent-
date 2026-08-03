/**
 * ComplianceMonitor 单元测试（v2.3 阶段十，17 §5）。
 *
 * 覆盖：
 *   - 三路触发评分（17 §5.2）：
 *     · ContentSafety 命中 → block
 *     · 律师 riskFlag=high → block
 *     · 法条引用失败率 > 30% → warn；> 60% → block
 *   - 风险等级判定（17 §5.3）：pass / warn / block
 *   - block 时写 compliance_alert + compliance_blocked 审计
 *   - scanAfterLawyerReview 律师复扫
 *   - ContentSafetyService 异常不阻断主流程
 *
 * 设计依据：17 §5 合规风险评分闭环；05 3.32 compliance_alert。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComplianceMonitor } from '../../src/modules/legal/review/compliance-monitor.service';
import type { ComplianceScanInput } from '../../src/modules/legal/review/review.types';

function makeAudit() {
  return { write: vi.fn(), writeSync: vi.fn() };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
}

function makeContentSafeResult(safe: boolean, reason?: string) {
  return { safe, reason, category: safe ? undefined : 'sensitive', matchedFragment: undefined };
}

function makeContentSafety(checkOutputResult: ReturnType<typeof makeContentSafeResult>) {
  return {
    checkOutput: vi.fn().mockResolvedValue(checkOutputResult),
    checkInput: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ComplianceMonitor（合规风险三路评分，17 §5）', () => {
  let audit: ReturnType<typeof makeAudit>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    audit = makeAudit();
    logger = makeLogger();
  });

  // ===== 路径 1：ContentSafety（17 §5.2）=====

  describe('路径1 ContentSafety', () => {
    it('ContentSafety 命中违规 → block + 写 alert + 审计', async () => {
      const cs = makeContentSafety(makeContentSafeResult(false, '命中敏感词'));
      const monitor = new ComplianceMonitor(
        undefined,
        cs as never,
        audit as never,
        logger as never,
      );
      const input: ComplianceScanInput = {
        msgId: 'msg-cs-1',
        userId: 'user-1',
        answer: '违规内容',
      };
      const result = await monitor.scan(input);
      expect(result.level).toBe('block');
      expect(result.blocked).toBe(true);
      expect(result.alertId).toMatch(/^ca_/);
      expect(result.triggers).toContainEqual({
        path: 'content_safety',
        detail: '命中敏感词',
      });
      expect(audit.write).toHaveBeenCalledWith(
        'compliance_blocked',
        expect.objectContaining({
          msgId: 'msg-cs-1',
          riskLevel: 'block',
        }),
      );
    });

    it('ContentSafety 通过 → 不触发该路径', async () => {
      const cs = makeContentSafety(makeContentSafeResult(true));
      const monitor = new ComplianceMonitor(
        undefined,
        cs as never,
        audit as never,
        logger as never,
      );
      const result = await monitor.scan({
        msgId: 'msg-cs-2',
        userId: 'user-1',
        answer: '正常内容',
      });
      expect(result.level).toBe('pass');
      expect(result.blocked).toBe(false);
    });

    it('使用外部传入的 contentSafetyResult 而非调用 ContentSafetyService', async () => {
      const cs = makeContentSafety(makeContentSafeResult(true));
      const monitor = new ComplianceMonitor(
        undefined,
        cs as never,
        audit as never,
        logger as never,
      );
      const result = await monitor.scan({
        msgId: 'msg-cs-3',
        userId: 'user-1',
        answer: '内容',
        contentSafetyResult: { safe: false, reason: '外部判定违规' },
      });
      expect(result.level).toBe('block');
      expect(cs.checkOutput).not.toHaveBeenCalled();
    });
  });

  // ===== 路径 2：律师标记（17 §5.2）=====

  describe('路径2 律师标记', () => {
    it('lawyerRiskFlag=high → block', async () => {
      const monitor = new ComplianceMonitor(undefined, undefined, audit as never, logger as never);
      const result = await monitor.scan({
        msgId: 'msg-lawyer-1',
        userId: 'user-1',
        answer: '',
        lawyerRiskFlag: 'high',
      });
      expect(result.level).toBe('block');
      expect(result.triggers).toContainEqual({
        path: 'lawyer_flag',
        detail: expect.stringContaining('riskFlag=high'),
      });
    });

    it('lawyerRiskFlag=low → 不触发该路径', async () => {
      const monitor = new ComplianceMonitor(undefined, undefined, audit as never, logger as never);
      const result = await monitor.scan({
        msgId: 'msg-lawyer-2',
        userId: 'user-1',
        answer: '',
        lawyerRiskFlag: 'low',
      });
      expect(result.level).toBe('pass');
    });
  });

  // ===== 路径 3：法条引用失败率（17 §5.2）=====

  describe('路径3 法条引用失败率', () => {
    it('失败率 40%（>30%）→ warn', async () => {
      const monitor = new ComplianceMonitor(undefined, undefined, audit as never, logger as never);
      const result = await monitor.scan({
        msgId: 'msg-cite-1',
        userId: 'user-1',
        answer: '',
        citationFailureRate: 0.4,
      });
      expect(result.level).toBe('warn');
      expect(result.blocked).toBe(false);
      expect(result.triggers).toContainEqual({
        path: 'citation_failure',
        detail: expect.stringContaining('40%'),
      });
    });

    it('失败率 65%（>60%）→ block', async () => {
      const monitor = new ComplianceMonitor(undefined, undefined, audit as never, logger as never);
      const result = await monitor.scan({
        msgId: 'msg-cite-2',
        userId: 'user-1',
        answer: '',
        citationFailureRate: 0.65,
      });
      expect(result.level).toBe('block');
      expect(result.blocked).toBe(true);
      expect(result.alertId).toMatch(/^ca_/);
    });

    it('失败率 20%（<30%）→ pass', async () => {
      const monitor = new ComplianceMonitor(undefined, undefined, audit as never, logger as never);
      const result = await monitor.scan({
        msgId: 'msg-cite-3',
        userId: 'user-1',
        answer: '',
        citationFailureRate: 0.2,
      });
      expect(result.level).toBe('pass');
    });

    it('失败率 = 30%（边界）→ pass（> 30% 才 warn）', async () => {
      const monitor = new ComplianceMonitor(undefined, undefined, audit as never, logger as never);
      const result = await monitor.scan({
        msgId: 'msg-cite-4',
        userId: 'user-1',
        answer: '',
        citationFailureRate: 0.3,
      });
      expect(result.level).toBe('pass');
    });

    it('失败率 = 60%（边界）→ warn（> 60% 才 block）', async () => {
      const monitor = new ComplianceMonitor(undefined, undefined, audit as never, logger as never);
      const result = await monitor.scan({
        msgId: 'msg-cite-5',
        userId: 'user-1',
        answer: '',
        citationFailureRate: 0.6,
      });
      expect(result.level).toBe('warn');
    });
  });

  // ===== scanAfterLawyerReview（17 §5.4）=====

  describe('scanAfterLawyerReview 律师复扫', () => {
    it('riskFlag=high 触发 block', async () => {
      const monitor = new ComplianceMonitor(undefined, undefined, audit as never, logger as never);
      const result = await monitor.scanAfterLawyerReview('msg-re-1', 'user-1', 'high');
      expect(result.level).toBe('block');
      expect(result.blocked).toBe(true);
    });

    it('riskFlag=none 不触发', async () => {
      const monitor = new ComplianceMonitor(undefined, undefined, audit as never, logger as never);
      const result = await monitor.scanAfterLawyerReview('msg-re-2', 'user-1', 'none');
      expect(result.level).toBe('pass');
    });
  });

  // ===== 容错 =====

  describe('容错', () => {
    it('ContentSafetyService 异常不阻断主流程', async () => {
      const cs = {
        checkOutput: vi.fn().mockRejectedValue(new Error('服务不可用')),
        checkInput: vi.fn(),
      };
      const monitor = new ComplianceMonitor(
        undefined,
        cs as never,
        audit as never,
        logger as never,
      );
      const result = await monitor.scan({
        msgId: 'msg-err-1',
        userId: 'user-1',
        answer: '内容',
      });
      // ContentSafety 异常跳过，无其他触发 → pass
      expect(result.level).toBe('pass');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('无 ContentSafetyService 注入 → 跳过该路径', async () => {
      const monitor = new ComplianceMonitor(undefined, undefined, audit as never, logger as never);
      const result = await monitor.scan({
        msgId: 'msg-err-2',
        userId: 'user-1',
        answer: '内容',
      });
      expect(result.level).toBe('pass');
    });
  });
});
