/**
 * 文书域 Mongoose Schema（A3-W3 新增，A3 §七）。
 *
 * 两个集合：
 *   - document_template：文书模板持久化（code 唯一，含 varsSchema + DSL body）
 *   - document_record：文书生成记录（varsFilled L4 加密 + exportFileId 回链）
 *
 * 设计依据：A3 §七；A3 §4.1 模板结构；05 数据模型 document_record。
 *
 * 注：当前模板数据仍在 src/data/documentTemplates.ts 内存加载（DocumentGeneratorService
 *     启动时构建 Map）。document_template 集合预留给后续从 DB 加载模板的场景，
 *     A3-W3 不强制迁移。document_record 由 DocumentRecordService 持久化。
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * 文书模板集合（A3 §七）。
 * 当前阶段从 src/data/documentTemplates.ts 加载，此 schema 预留给 DB 驱动场景。
 */
@Schema({ collection: 'document_template' })
export class DocumentTemplateRecord {
  @Prop({ required: true, unique: true, index: true }) code!: string;
  @Prop({ required: true }) type!: string;
  @Prop({ required: true }) title!: string;
  @Prop() description?: string;
  /** 变量 schema（JSON 字符串或内嵌对象） */
  @Prop({ type: Array, default: [] }) vars!: unknown[];
  /** DSL 模板正文 */
  @Prop({ required: true }) body!: string;
  @Prop({ type: [String], default: [] }) lawRefs!: string[];
  @Prop({ default: 1 }) version!: number;
  @Prop({ default: 'active', index: true }) status!: string;
  @Prop({ default: Date.now }) createdAt!: Date;
  @Prop({ default: Date.now }) updatedAt!: Date;
}
export type DocumentTemplateRecordDocument = HydratedDocument<DocumentTemplateRecord>;
export const DocumentTemplateRecordSchema = SchemaFactory.createForClass(DocumentTemplateRecord);

/**
 * 文书生成记录集合（A3 §七）。
 *
 * 关键字段：
 *   - varsFilled：L4 加密入库（PiiService.encrypt 后存储）
 *   - renderedText：渲染后正文（含免责声明）
 *   - exportFileId：导出后的对象存储 key（如 documents/{docId}/起诉状.docx）
 *   - expireAt：TTL 1 年（案件关闭后清理）
 */
@Schema({ collection: 'document_record' })
export class DocumentRecord {
  @Prop({ required: true, unique: true, index: true }) docId!: string;
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ index: true }) caseId?: string;
  @Prop({ required: true, index: true }) templateCode!: string;
  @Prop() templateTitle?: string;
  @Prop({ default: 1 }) templateVersion!: number;
  /** L4 加密后的 varsFilled（PiiService.encrypt(JSON.stringify(vars))） */
  @Prop({ required: true }) varsFilled!: string;
  /** 渲染后正文（含免责声明） */
  @Prop({ required: true }) renderedText!: string;
  @Prop({ type: [String], default: [] }) lawRefs!: string[];
  /** 导出文件对象存储 key（首次导出后回填） */
  @Prop({ index: true }) exportFileId?: string;
  @Prop() exportFormat?: 'docx' | 'pdf';
  /** 状态：generated / exported / archived（union type 用 string 存储） */
  @Prop({ default: 'generated' }) status!: string;
  @Prop({ default: Date.now, index: true }) createdAt!: Date;
  @Prop({ default: Date.now }) updatedAt!: Date;
  /** TTL 1 年（A3 §七） */
  @Prop({ type: Date, expires: 365 * 24 * 3600 }) expireAt!: Date;
}
export type DocumentRecordDocument = HydratedDocument<DocumentRecord>;
export const DocumentRecordSchema = SchemaFactory.createForClass(DocumentRecord);
