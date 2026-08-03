/**
 * 合规告警 Schema（v2.3 阶段十，05 3.32 compliance_alert 集合）。
 *
 * 用途：ComplianceMonitor 三路评分触发 block 时写入告警，
 * 支持律师复核 → 标注 → retrain 闭环。
 *
 * 字段对齐 05 3.32 + 17 第五节：
 *   - alertId：业务 ID（唯一）
 *   - msgId / userId：关联消息与用户
 *   - riskLevel：warn / block
 *   - triggers[]：触发路径列表（content_safety / lawyer_flag / citation_failure）
 *   - state：open / reviewing / resolved
 *   - claimedBy / resolvedBy / resolvedAt：处理信息
 *   - expireAt：TTL 180 天
 *
 * 索引：idx_state_createdAt（待处理告警查询）、idx_msgId、TTL 180 天
 *
 * 设计依据：05 3.32 compliance_alert；17 §5 合规风险评分闭环；17 §5.3 风险等级与处置。
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

// ===== 子文档类型 =====

/** 合规触发路径 */
export interface ComplianceTrigger {
  /** 触发路径：content_safety / lawyer_flag / citation_failure */
  path: 'content_safety' | 'lawyer_flag' | 'citation_failure';
  /** 触发详情（如命中违规词、律师 riskFlag=high、引用失败率 65%） */
  detail: string;
}

/** 合规告警状态 */
export type ComplianceAlertState = 'open' | 'reviewing' | 'resolved';

/** 合规风险等级 */
export type ComplianceRiskLevel = 'warn' | 'block';

@Schema({
  collection: 'compliance_alert',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
})
export class ComplianceAlert {
  /** 业务 ID（唯一，ca_<uuid>） */
  @Prop({ required: true, unique: true, index: true })
  alertId!: string;

  @Prop({ required: true, index: true })
  msgId!: string;

  @Prop({ required: true })
  userId!: string;

  /** 风险等级：warn（警告）/ block（拦截） */
  @Prop({ required: true })
  riskLevel!: string;

  /** 触发路径列表 */
  @Prop({ type: Array, default: [] })
  triggers!: ComplianceTrigger[];

  /** 状态：open / reviewing / resolved */
  @Prop({ required: true, default: 'open' })
  state!: string;

  /** 领取处理人 userId */
  @Prop()
  claimedBy?: string;

  /** 解决人 userId */
  @Prop()
  resolvedBy?: string;

  @Prop({ type: Date })
  resolvedAt?: Date;

  /** TTL 180 天（05 3.32 expireAt: createdAt + 180 天） */
  @Prop({ type: Date, expires: 180 * 24 * 3600 })
  expireAt!: Date;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export type ComplianceAlertDocument = HydratedDocument<ComplianceAlert>;
export const ComplianceAlertSchema = SchemaFactory.createForClass(ComplianceAlert);

// 复合索引：待处理告警查询（state + createdAt）
ComplianceAlertSchema.index({ state: 1, createdAt: -1 }, { name: 'idx_state_createdAt' });
