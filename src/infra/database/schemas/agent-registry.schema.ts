/**
 * AgentRegistry Mongoose Schema（A4-W1 新增，A4 §九）。
 *
 * agent_registry 集合：12 个 Agent 的 AgentCard 持久化注册。
 *   - 启动时由 AgentRegistry 单例内存加载（进程级），DB 为镜像源
 *   - 字段对齐 AgentCard 接口（agentId/capabilities/inputSchema/outputSchema/piiLevel/exposure/status）
 *   - 支持运维动态启停 agent（status: enabled/disabled）
 *
 * 注：union type 字段（piiLevel/exposure/status）统一用 string 存储，
 *     避免 @nestjs/mongoose 无法推断 design:type（项目约定）。
 *
 * 设计依据：A4 §九；05 数据模型 agent_registry；13-agent-governance.md。
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/** Agent 暴露层级（与 types.ts AgentExposure 对齐，schema 用 string 存储） */
export type AgentExposure = 'L-Read' | 'L-Write-Limited' | 'L-Internal';

/** Agent 状态（运维管理用） */
export type AgentRegistryStatus = 'enabled' | 'disabled';

@Schema({ collection: 'agent_registry' })
export class AgentRegistryRecord {
  /** Agent ID（如 'law-lookup'），全局唯一 */
  @Prop({ required: true, unique: true, index: true }) agentId!: string;
  @Prop({ required: true }) name!: string;
  @Prop({ required: true }) description!: string;
  /** 语义化版本 '1.0.0' */
  @Prop({ required: true, default: '1.0.0' }) version!: string;
  /** 能力列表（如 ['law.lookup']） */
  @Prop({ required: true, type: [String], default: [] }) capabilities!: string[];
  /** 入参 JSONSchema（对象形式存储） */
  @Prop({ required: true, type: Object }) inputSchema!: Record<string, unknown>;
  /** 出参 JSONSchema（强制含 disclaimer / lawRefs / traceId） */
  @Prop({ required: true, type: Object }) outputSchema!: Record<string, unknown>;
  /** PII 级别：L1/L2/L3/L4（string 存储） */
  @Prop({ required: true, default: 'L1' }) piiLevel!: string;
  /** 暴露层级：L-Read / L-Write-Limited / L-Internal（string 存储） */
  @Prop({ required: true, default: 'L-Read' }) exposure!: string;
  /** 是否异步长任务 */
  @Prop({ required: true, default: false }) async!: boolean;
  /** 默认超时（ms） */
  @Prop({ required: true, default: 30_000 }) timeout!: number;
  /** 降级目标 agentId */
  @Prop() fallbackAgentId?: string;
  /** 运维状态：enabled / disabled（disabled 的 agent 不参与调度） */
  @Prop({ default: 'enabled', index: true }) status!: string;
  @Prop({ default: Date.now }) registeredAt!: Date;
  @Prop({ default: Date.now }) updatedAt!: Date;
}
export type AgentRegistryDocument = HydratedDocument<AgentRegistryRecord>;
export const AgentRegistrySchema = SchemaFactory.createForClass(AgentRegistryRecord);
