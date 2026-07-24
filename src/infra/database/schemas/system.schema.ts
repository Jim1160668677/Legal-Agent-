/**
 * 系统域 Mongoose Schema（A1-W1）。
 * 设计依据：A1 §五 集合 feature_flag / llm_cache。
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ collection: 'feature_flag' })
export class FeatureFlag {
  @Prop({ required: true, unique: true, index: true }) flagKey!: string;
  @Prop({ default: false }) enabled!: boolean;
  @Prop({ default: 0 }) rolloutPercent!: number;
  @Prop({ type: [String], default: [] }) whitelist!: string[];
}
export type FeatureFlagDocument = HydratedDocument<FeatureFlag>;
export const FeatureFlagSchema = SchemaFactory.createForClass(FeatureFlag);

@Schema({ collection: 'llm_cache' })
export class LlmCache {
  @Prop({ required: true, unique: true, index: true }) promptHash!: string;
  @Prop({ required: true }) model!: string;
  @Prop() promptVersion?: string;
  @Prop() intent?: string;
  @Prop({ required: true }) response!: string;
  @Prop({ type: [String], default: [], index: true }) affectedLawArticles!: string[];
  @Prop({ default: 0 }) hitCount!: number;
  @Prop({ type: Date, expires: 604800 }) expireAt!: Date; // TTL 7 天
}
export type LlmCacheDocument = HydratedDocument<LlmCache>;
export const LlmCacheSchema = SchemaFactory.createForClass(LlmCache);
