/**
 * 会话域 Mongoose Schema（A1-W1）。
 * 设计依据：A1 §五 集合 dialog_record / audit_log。
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ _id: false })
class DialogMessage {
  /** union type 用 string 存储（tsx 不支持 emitDecoratorMetadata，§8） */
  @Prop({ required: true }) role!: string;
  @Prop({ required: true }) content!: string;
  @Prop({ required: true }) ts!: Date;
  @Prop() traceId?: string;
}
const DialogMessageSchema = SchemaFactory.createForClass(DialogMessage);

@Schema({ collection: 'dialog_record', timestamps: true })
export class DialogRecord {
  @Prop({ required: true, index: true }) sessionId!: string;
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ type: [DialogMessageSchema], default: [] }) messages!: DialogMessage[];
  @Prop({ type: Object, default: {} }) context!: Record<string, unknown>;
  @Prop({ type: Date, expires: 7776000 }) expireAt!: Date; // TTL 90 天
}
export type DialogRecordDocument = HydratedDocument<DialogRecord>;
export const DialogRecordSchema = SchemaFactory.createForClass(DialogRecord);

@Schema({ collection: 'audit_log' })
export class AuditLog {
  @Prop({ required: true }) ts!: Date;
  @Prop({ index: true }) traceId?: string;
  @Prop({ index: true }) userId?: string;
  @Prop({ required: true, index: true }) event!: string;
  @Prop() func?: string;
  @Prop() ip?: string;
  @Prop({ type: Object, default: {} }) detail!: Record<string, unknown>;
  @Prop() result?: string;
  @Prop({ type: Date, expires: 15552000 }) expireAt!: Date; // TTL 180 天
}
export type AuditLogDocument = HydratedDocument<AuditLog>;
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
