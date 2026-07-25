/**
 * AgentInvocationLog Mongoose Schema（A4-W1 新增，A4 §九）。
 *
 * agent_invocation_log 集合：跨 agent 调用快查日志。
 *   - 每次 Agent.invoke 调用写一条（traceId/callerAgentId/targetAgentId/capability/result/durationMs）
 *   - TTL 30 天（自动清理，避免长期堆积）
 *   - 供运维排查调用链、性能分析、降级审计
 *
 * 与 audit_log 的关系：
 *   - audit_log 记录业务事件（agent_invoke / agent_degradation / agent_pii_violation）
 *   - agent_invocation_log 记录技术调用链（每次 invoke 一条，含 caller/target 索引）
 *   - 两者通过 traceId 关联，互为补充
 *
 * 设计依据：A4 §九；05 数据模型 agent_invocation_log；13-agent-governance.md。
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/** Agent 调用结果状态（与 types.ts AgentInvokeStatus 对齐，schema 用 string 存储） */
export type InvocationResult = 'success' | 'degraded' | 'failed' | 'blocked';

@Schema({ collection: 'agent_invocation_log' })
export class AgentInvocationLog {
  /** 请求级追踪 ID（贯穿日志/审计，索引便于按请求聚合调用链） */
  @Prop({ required: true, index: true }) traceId!: string;
  /** 调用方 agentId（外部调用形如 'external:<agentKey>'） */
  @Prop({ index: true }) callerAgentId?: string;
  /** 调用方用户 ID */
  @Prop({ index: true }) callerUserId!: string;
  /** 被调用的 agentId */
  @Prop({ required: true, index: true }) targetAgentId!: string;
  /** 调用的 capability */
  @Prop({ required: true, index: true }) capability!: string;
  /** 调用结果：success / degraded / failed / blocked（string 存储） */
  @Prop({ required: true, default: 'success' }) result!: string;
  /** 执行耗时（ms） */
  @Prop({ required: true, default: 0 }) durationMs!: number;
  /** 输入 token 数（LLM 类 agent 填充） */
  @Prop({ default: 0 }) tokensIn!: number;
  /** 输出 token 数（LLM 类 agent 填充） */
  @Prop({ default: 0 }) tokensOut!: number;
  /** 缓存命中标记（如 'L3:agnes-2.0-flash'） */
  @Prop() cacheHit?: string;
  /** 降级目标 agentId（result=degraded 时填充） */
  @Prop() fallbackAgentId?: string;
  /** 错误码（failed 时填充） */
  @Prop() errorCode?: number;
  /** 错误消息（failed 时填充，截断 500 字符避免超长） */
  @Prop() errorMessage?: string;
  /** 入参摘要（用于排查，不含完整 PII，截断 1000 字符） */
  @Prop() paramsPreview?: string;
  @Prop({ default: Date.now, index: true }) ts!: Date;
  /** TTL 30 天 */
  @Prop({ type: Date, expires: 30 * 24 * 3600 }) expireAt!: Date;
}
export type AgentInvocationLogDocument = HydratedDocument<AgentInvocationLog>;
export const AgentInvocationLogSchema = SchemaFactory.createForClass(AgentInvocationLog);
