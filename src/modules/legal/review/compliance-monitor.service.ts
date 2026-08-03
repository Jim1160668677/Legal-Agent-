/**
 * ComplianceMonitor —— 合规风险三路评分闭环（v2.3 阶段十，17 §5）。
 *
 * 三路触发评分（17 §5.2）：
 *   | 路径 | 输入 | 评分 |
 *   | ContentSafety | AI 回答文本 | 命中违法词/敏感词 → 直接 block |
 *   | 律师标记 | lawyer_review.riskFlag = high | high → block |
 *   | 法条引用失败率 | citedLaws 中 verified=false 比例 | > 30% warn；> 60% block |
 *
 * 风险等级与处置（17 §5.3）：
 *   pass：三路均无触发 → 正常返回客户端
 *   warn：法条引用失败率 30%-60% → 返回 + warnings + 审计
 *   block：ContentSafety 命中 / 律师 high / 引用失败率 > 60% → 拦截（8013）+ 写 compliance_alert + 通知律师复核
 *
 * 闭环（17 §5.4）：
 *   block → compliance_alert(state=open) → 律师复核 → 标注 → retrain 触发
 *
 * 编排集成（17 §5.4 + 11 OrchestratorAgent）：
 *   complianceMonitor.scan 在编排中调用，block 返回 8013。
 *
 * 设计依据：17 §5 合规风险评分闭环；03 §12.7 ComplianceMonitor；05 3.32 compliance_alert。
 */
import { Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import {
  ComplianceAlert,
  type ComplianceAlertDocument,
} from '../../../infra/database/schemas/compliance-alert.schema';
import { ContentSafetyService } from '../../platform/content-safety/content-safety.service';
import { AuditLogService } from '../../platform/audit/audit-log.service';
import { AppLoggerService } from '../../platform/logger/logger.service';
import { ComplianceScanResult } from './review.types';
import type { ComplianceScanInput, ComplianceLevel } from './review.types';
import { COMPLIANCE_THRESHOLDS, COMPLIANCE_ERROR_CODE } from './review.types';
import { REVIEW_ERROR_CODES } from './review.constants';

@Injectable()
export class ComplianceMonitor {
  constructor(
    @Optional()
    @InjectModel(ComplianceAlert.name)
    private readonly alertModel?: Model<ComplianceAlertDocument>,
    @Optional() private readonly contentSafety?: ContentSafetyService,
    @Optional() private readonly audit?: AuditLogService,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  /**
   * 合规风险扫描（17 §5.2 三路评分）。
   *
   * @param input 扫描输入
   * @returns ComplianceScanResult，含 level / triggers / blocked / alertId
   */
  async scan(input: ComplianceScanInput): Promise<ComplianceScanResult> {
    const { msgId, userId, answer } = input;
    const triggers: ComplianceScanResult['triggers'] = [];

    // ===== 路径 1：ContentSafety（17 §5.2）=====
    let contentSafetyBlocked = false;
    let citationFailureRate = input.citationFailureRate;

    // 若未提供 citationFailureRate 但有 contentSafetyResult，使用之
    // 否则若 ContentSafetyService 可用，实时校验
    if (input.contentSafetyResult) {
      if (!input.contentSafetyResult.safe) {
        contentSafetyBlocked = true;
        triggers.push({
          path: 'content_safety',
          detail:
            input.contentSafetyResult.reason ??
            input.contentSafetyResult.category ??
            '内容安全命中违规',
        });
      }
    } else if (this.contentSafety) {
      try {
        const result = await this.contentSafety.checkOutput(answer);
        if (!result.safe) {
          contentSafetyBlocked = true;
          triggers.push({
            path: 'content_safety',
            detail: result.reason ?? result.category ?? '内容安全命中违规',
          });
        }
      } catch (err) {
        // ContentSafety 异常不阻断主流程，仅记录
        this.logger?.warn('ContentSafety 校验异常，跳过该路径', {
          msgId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ===== 路径 2：律师标记（17 §5.2）=====
    if (input.lawyerRiskFlag === 'high') {
      triggers.push({
        path: 'lawyer_flag',
        detail: '律师标记 riskFlag=high，存在专业错误或合规风险',
      });
    }

    // ===== 路径 3：法条引用失败率（17 §5.2）=====
    // citationFailureRate 可由调用方传入，或由 AnswerTracer.computeCitationFailureRate 计算
    if (citationFailureRate === undefined) {
      citationFailureRate = 0;
    }

    // ===== 聚合判定（17 §5.3）=====
    const level = this.determineLevel(
      contentSafetyBlocked,
      input.lawyerRiskFlag,
      citationFailureRate,
    );

    // 法条引用失败率触发 warn/block 时加入 triggers
    if (citationFailureRate > COMPLIANCE_THRESHOLDS.blockCitationFailure) {
      triggers.push({
        path: 'citation_failure',
        detail: `法条引用失败率 ${(citationFailureRate * 100).toFixed(0)}% 超过 60% 阈值`,
      });
    } else if (citationFailureRate > COMPLIANCE_THRESHOLDS.warnCitationFailure) {
      triggers.push({
        path: 'citation_failure',
        detail: `法条引用失败率 ${(citationFailureRate * 100).toFixed(0)}% 超过 30% 阈值`,
      });
    }

    const blocked = level === 'block';

    // ===== block 时写 compliance_alert（17 §5.3 + §5.4）=====
    let alertId: string | undefined;
    if (blocked) {
      alertId = await this.createAlert(msgId, userId, level, triggers);
      // 写合规拦截审计（17 §9 compliance_blocked）
      this.audit?.write('compliance_blocked', {
        msgId,
        userId,
        riskLevel: level,
        triggers: triggers.map((t) => t.path),
      });
    }

    this.logger?.info('合规扫描完成', {
      msgId,
      level,
      blocked,
      triggerCount: triggers.length,
      citationFailureRate,
    });

    return {
      level,
      triggers,
      blocked,
      alertId,
    };
  }

  /**
   * 律师审核提交后触发合规复扫（17 §5.4 闭环）。
   * 律师标记 riskFlag=high 时，触发 block 并写 compliance_alert。
   */
  async scanAfterLawyerReview(
    msgId: string,
    userId: string,
    lawyerRiskFlag: 'none' | 'low' | 'high',
  ): Promise<ComplianceScanResult> {
    return this.scan({
      msgId,
      userId,
      answer: '', // 律师复扫不重新做 ContentSafety
      lawyerRiskFlag,
      citationFailureRate: 0,
    });
  }

  // ===== 内部辅助 =====

  /** 聚合判定风险等级（17 §5.3） */
  private determineLevel(
    contentSafetyBlocked: boolean,
    lawyerRiskFlag?: 'none' | 'low' | 'high',
    citationFailureRate?: number,
  ): ComplianceLevel {
    // block：ContentSafety 命中 / 律师 high / 引用失败率 > 60%
    if (contentSafetyBlocked) return 'block';
    if (lawyerRiskFlag === 'high') return 'block';
    if (
      citationFailureRate !== undefined &&
      citationFailureRate > COMPLIANCE_THRESHOLDS.blockCitationFailure
    ) {
      return 'block';
    }
    // warn：引用失败率 30%-60%
    if (
      citationFailureRate !== undefined &&
      citationFailureRate > COMPLIANCE_THRESHOLDS.warnCitationFailure
    ) {
      return 'warn';
    }
    // pass：三路均无触发
    return 'pass';
  }

  /** 写 compliance_alert（05 3.32） */
  private async createAlert(
    msgId: string,
    userId: string,
    riskLevel: ComplianceLevel,
    triggers: ComplianceScanResult['triggers'],
  ): Promise<string> {
    const alertId = `ca_${randomUUID()}`;
    const now = new Date();
    const expireAt = new Date(now.getTime() + 180 * 24 * 3600 * 1000);

    if (this.alertModel) {
      try {
        await this.alertModel.create({
          alertId,
          msgId,
          userId,
          riskLevel,
          triggers,
          state: 'open',
          expireAt,
        });
      } catch (err) {
        this.logger?.error('写入 compliance_alert 失败', {
          alertId,
          msgId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return alertId;
  }
}

/** 合规拦截业务错误（8013，供编排器/Controller 抛出） */
export class ComplianceBlockedException extends Error {
  readonly code = REVIEW_ERROR_CODES.COMPLIANCE_BLOCKED;
  readonly scanResult: ComplianceScanResult;

  constructor(scanResult: ComplianceScanResult) {
    super(`合规拦截：${scanResult.triggers.map((t) => t.path).join(', ')}`);
    this.name = 'ComplianceBlockedException';
    this.scanResult = scanResult;
  }
}

/** 合规错误码导出（对齐 06 错误码 8013） */
export { COMPLIANCE_ERROR_CODE };
