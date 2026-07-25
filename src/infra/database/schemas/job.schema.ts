/**
 * 异步任务 Mongoose Schema（A3-W4 新增，A3 §八）。
 *
 * agent_job 集合：异步文书生成任务持久化。
 *   - 简单轮询模式：客户端 GET /v1/jobs/{jobId} 查状态
 *   - A4 扩展为完整 JobService + 回调/webhook
 *
 * 关键字段：
 *   - params：L4 加密（含 varsFilled 等敏感字段）
 *   - status：pending / running / completed / failed
 *   - progress：0-100
 *   - resultFileId：完成后的产物对象 key（如导出的 docx）
 *   - expireAt：TTL 30 天（任务记录清理）
 *
 * 注：status / capability 用 string 类型存储（避免 union type 导致
 *     @nestjs/mongoose 无法推断 design:type）。
 *
 * 设计依据：A3 §八；05 数据模型 agent_job。
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';
export type JobCapability = 'document_generate' | 'document_export' | 'case_analysis';

@Schema({ collection: 'agent_job' })
export class AgentJob {
  @Prop({ required: true, unique: true, index: true }) jobId!: string;
  @Prop({ required: true, index: true }) userId!: string;
  /** 任务能力（document_generate / document_export / case_analysis） */
  @Prop({ required: true, index: true }) capability!: string;
  /** L4 加密后的 params JSON（PiiService.encrypt） */
  @Prop({ required: true }) params!: string;
  /** 状态：pending / running / completed / failed（union type 用 string 存储） */
  @Prop({ default: 'pending', index: true }) status!: string;
  @Prop({ default: 0 }) progress!: number;
  /** 任务结果（completed 时填充；如 docId / downloadUrl） */
  @Prop({ type: Object, default: {} }) result!: Record<string, unknown>;
  /** 失败原因（failed 时填充） */
  @Prop() errorMessage?: string;
  @Prop({ default: 0 }) durationMs!: number;
  @Prop({ default: Date.now, index: true }) createdAt!: Date;
  @Prop() startedAt?: Date;
  @Prop() completedAt?: Date;
  /** TTL 30 天 */
  @Prop({ type: Date, expires: 30 * 24 * 3600 }) expireAt!: Date;
}
export type AgentJobDocument = HydratedDocument<AgentJob>;
export const AgentJobSchema = SchemaFactory.createForClass(AgentJob);
