/**
 * 法条引用图谱 Schema（v2.3-W3，05 3.26 law_citation_graph 集合）。
 *
 * 用途：CitationGraphBuilder 维护 articleId → citingCaseIds/citingDocIds 映射，
 *       为 15 LawTimelinessScanner 交叉引用扫描和 16 CaseComparator 案例对比提供数据基础。
 *
 * 字段对齐 05 3.26：
 *   - articleId：被引用的法条 ID（law_article._id 或 lawName+articleNoInt 组合键）
 *   - citingCaseIds：引用该法条的案例 ID 列表
 *   - citingDocIds：引用该法条的文书 ID 列表
 *   - citedCount：总引用次数（citingCaseIds.length + citingDocIds.length）
 *   - lastCitedAt：最近一次被引用时间
 *   - updatedAt：图谱更新时间
 *
 * 索引：idx_articleId（唯一）、idx_citedCount（按热度排序）
 *
 * 设计依据：05 3.26 law_citation_graph；14 §14.2 输入输出。
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({
  collection: 'law_citation_graph',
  timestamps: { updatedAt: 'updatedAt' },
})
export class LawCitationGraph {
  /** 被引用的法条 ID（如 "民法典-143" 或 law_article._id） */
  @Prop({ required: true, unique: true, index: true })
  articleId!: string;

  /** 引用该法条的案例 ID 列表 */
  @Prop({ type: [String], default: [] })
  citingCaseIds!: string[];

  /** 引用该法条的文书 ID 列表 */
  @Prop({ type: [String], default: [] })
  citingDocIds!: string[];

  /** 总引用次数（citingCaseIds.length + citingDocIds.length） */
  @Prop({ default: 0, index: true })
  citedCount!: number;

  /** 最近一次被引用时间 */
  @Prop()
  lastCitedAt?: Date;

  /** 图谱更新时间（timestamps 选项自动维护，声明以便 lean() 类型包含） */
  @Prop()
  updatedAt?: Date;
}

export type LawCitationGraphDocument = HydratedDocument<LawCitationGraph>;
export const LawCitationGraphSchema = SchemaFactory.createForClass(LawCitationGraph);
