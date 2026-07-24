/**
 * 法律知识域 Mongoose Schema（A1-W1 + A2-W1 扩展）。
 * 设计依据：A1 §五 集合 law_article / legal_knowledge / intent_eval_set；
 *           A2 §八 case_precedent 集合（A2-W1 新增）。
 * 注：law_article / case_precedent 的 embedding 字段 A2 阶段启用向量索引。
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ collection: 'law_article' })
export class LawArticle {
  @Prop({ required: true }) lawName!: string;
  @Prop({ required: true }) articleNo!: string;
  @Prop() articleNoInt?: number;
  @Prop({ required: true, index: true }) category!: string;
  @Prop({ required: true }) content!: string;
  @Prop({ type: [String], default: [], index: true }) keywords!: string[];
  @Prop() province?: string;
  @Prop() legalHierarchy?: string;
  @Prop({ default: 'effective' }) status!: string;
  @Prop({ unique: true, index: true }) contentHash?: string;
  @Prop({ type: [Number], default: [] }) embedding?: number[]; // A2 向量
}
export type LawArticleDocument = HydratedDocument<LawArticle>;
export const LawArticleSchema = SchemaFactory.createForClass(LawArticle);

@Schema({ collection: 'legal_knowledge' })
export class LegalKnowledge {
  @Prop({ required: true, index: true }) type!: string;
  @Prop({ required: true, index: true }) category!: string;
  @Prop() subCategory?: string;
  @Prop({ required: true }) title!: string;
  @Prop({ required: true }) content!: string;
  @Prop({ type: Object, default: {} }) structured!: Record<string, unknown>;
  @Prop({ type: [String], default: [] }) lawRefs!: string[];
  @Prop({ type: [String], default: [], index: true }) tags!: string[];
}
export type LegalKnowledgeDocument = HydratedDocument<LegalKnowledge>;
export const LegalKnowledgeSchema = SchemaFactory.createForClass(LegalKnowledge);

@Schema({ collection: 'intent_eval_set' })
export class IntentEvalSet {
  @Prop({ required: true }) text!: string;
  @Prop({ required: true, index: true }) expectedIntent!: string;
  @Prop() expectedRoute?: string;
  @Prop() category?: string;
  @Prop({ index: true }) difficulty?: string;
  @Prop() source?: string;
  @Prop({ default: 1 }) version!: number;
}
export type IntentEvalSetDocument = HydratedDocument<IntentEvalSet>;
export const IntentEvalSetSchema = SchemaFactory.createForClass(IntentEvalSet);

/**
 * 案例（裁判文书）Schema（A2-W1 新增，A2 §八 case_precedent 集合）。
 * 数据源：中国裁判文书网公开数据子集（脱敏处理）。
 * embedding 字段 A2-W2 启用向量索引（Atlas Vector Search / Milvus）。
 */
@Schema({ collection: 'case_precedent' })
export class CasePrecedent {
  @Prop({ required: true }) caseTitle!: string;
  @Prop({ required: true, index: true }) caseNo!: string;
  @Prop() court?: string;
  @Prop({ required: true, index: true }) category!: string; // 民事/刑事/商事/行政
  @Prop({ index: true }) causeOfAction?: string; // 案由（向量索引 filter）
  @Prop() judgmentDate?: Date;
  @Prop() outcomeLabel?: string; // 裁判结果标签：胜诉/败诉/部分支持/驳回等
  @Prop({ required: true }) content!: string;
  @Prop({ type: [String], default: [], index: true }) keywords!: string[];
  @Prop({ unique: true, index: true }) contentHash?: string; // SHA-256 去重
  @Prop({ type: [Number], default: [] }) embedding?: number[]; // A2 向量（1536 维）
}
export type CasePrecedentDocument = HydratedDocument<CasePrecedent>;
export const CasePrecedentSchema = SchemaFactory.createForClass(CasePrecedent);
