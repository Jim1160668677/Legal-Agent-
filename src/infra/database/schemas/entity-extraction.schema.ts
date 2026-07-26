/**
 * 实体抽取结果 Schema（v2.3-W4，05 3.24 entity_extraction 集合）。
 *
 * 用途：EntityExtractor 四层抽取结果持久化，支持跨轮指代消解（L4 层
 * 按 userId 查最近一条记录获取 lastTurnEntities）。
 *
 * 字段对齐 05 3.24：
 *   - msgId：关联 dialog_record.messages[].msgId（唯一）
 *   - userId：用户标识（跨轮消解查询维度）
 *   - entities[]：实体列表（type/value/span/confidence/source）
 *   - modelVersion / promptVersion：LLM NER 模型与 prompt 版本
 *   - extractedAt：抽取时间（跨轮查询排序用）
 *
 * 索引：idx_msgId（唯一）、idx_userId_extractedAt（跨轮消解查询）
 *
 * 设计依据：05 3.24 entity_extraction；07 §8.1 实体抽取算法。
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/** 实体类型枚举（对齐 05 3.24 entities[].type） */
export type EntityType =
  | 'person'
  | 'org'
  | 'contract'
  | 'case_cause'
  | 'evidence'
  | 'legal_term'
  | 'date'
  | 'amount'
  | 'idcard'
  | 'phone'
  | 'law_ref';

/** 实体来源枚举（对齐 05 3.24 entities[].source） */
export type EntitySource = 'regex' | 'dict' | 'llm' | 'coref';

/** 单条实体（嵌入子文档） */
@Schema({ _id: false })
export class EntityEntry {
  @Prop({ required: true })
  type!: string;

  @Prop({ required: true })
  value!: string;

  @Prop({ type: [Number] })
  span!: [number, number];

  @Prop({ required: true, default: 0 })
  confidence!: number;

  @Prop({ required: true })
  source!: string;
}

@Schema({
  collection: 'entity_extraction',
  timestamps: { createdAt: 'createdAt' },
})
export class EntityExtraction {
  @Prop({ required: true, unique: true, index: true })
  msgId!: string;

  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ type: [EntityEntry], default: [] })
  entities!: EntityEntry[];

  @Prop()
  modelVersion?: string;

  @Prop()
  promptVersion?: string;

  @Prop({ default: Date.now })
  extractedAt!: Date;

  @Prop()
  createdAt?: Date;
}

export type EntityExtractionDocument = HydratedDocument<EntityExtraction>;
export const EntityExtractionSchema = SchemaFactory.createForClass(EntityExtraction);
