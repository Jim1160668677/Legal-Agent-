/**
 * 法律知识域 Mongoose Schema（A1-W1）。
 * 设计依据：A1 §五 集合 law_article / legal_knowledge / intent_eval_set。
 * 注：law_article.case_precedent 的 embedding 字段 A2 阶段扩展。
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
