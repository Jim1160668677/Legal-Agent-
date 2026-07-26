/**
 * 多轮澄清会话 Schema（v2.3-W4，05 3.25 clarification_session 集合）。
 *
 * 用途：ClarificationManager 状态机持久化，支持跨轮澄清（asking→answered/timeout/give_up）。
 *
 * 字段对齐 05 3.25：
 *   - sessionId：业务 ID（唯一）
 *   - userId / msgId：触发澄清的用户与消息
 *   - intent：触发澄清的意图
 *   - requiredSlots[]：必填槽位
 *   - filledSlots{}：已填槽位
 *   - state：asking | answered | timeout | give_up
 *   - turns：已追问轮数（上限 3）
 *   - offTopicCount：答非所问次数（上限 2）
 *   - expireAt：TTL 24h（会话过期清理）
 *
 * 索引：idx_sessionId（唯一）、idx_userId_state（查活跃会话）、idx_expireAt（TTL）
 *
 * 设计依据：05 3.25 clarification_session；07 §8.2 多轮主动澄清算法。
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/** 澄清会话状态（权威源，跨 04/05/09 一致） */
export type ClarificationState = 'asking' | 'answered' | 'timeout' | 'give_up';

@Schema({
  collection: 'clarification_session',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
})
export class ClarificationSession {
  @Prop({ required: true, unique: true, index: true })
  sessionId!: string;

  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true })
  msgId!: string;

  @Prop({ required: true })
  intent!: string;

  @Prop({ type: [String], default: [] })
  requiredSlots!: string[];

  @Prop({ type: Object, default: {} })
  filledSlots!: Record<string, unknown>;

  @Prop({ required: true, default: 'asking', index: true })
  state!: string;

  @Prop({ required: true, default: 0 })
  turns!: number;

  @Prop({ required: true, default: 0 })
  offTopicCount!: number;

  /** TTL 24h（05 3.25 expireAt: createdAt + 24h） */
  @Prop({ type: Date, expires: 24 * 3600 })
  expireAt!: Date;

  @Prop()
  createdAt?: Date;

  /** 声明以便 lean() 类型包含（v2.3-W3 踩坑：timestamps 选项字段须显式声明） */
  @Prop()
  updatedAt?: Date;
}

export type ClarificationSessionDocument = HydratedDocument<ClarificationSession>;
export const ClarificationSessionSchema = SchemaFactory.createForClass(ClarificationSession);
