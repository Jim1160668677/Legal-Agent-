/**
 * CitationGraphBuilder —— 法条引用图谱构建器（v2.3-W3，14 §十四）。
 *
 * 职责：
 *   1. 增量 upsert：案例/文书入库时，更新 articleId → citingCaseIds/citingDocIds 映射
 *   2. 全量重建：定时任务清空图谱 + 从 case_precedent/document_record 全量提取重建
 *   3. 查询：getGraph(articleId) / getHotArticles(topK)
 *
 * 架构（内存优先 + DB 持久化，参考 InMemoryBm25Retriever）：
 *   - 内部维护 Map<articleId, GraphEntry> 内存索引
 *   - @Optional() 注入 Mongoose Model，缺失时仅内存模式（单测友好）
 *   - onModuleInit 时从 DB 加载到内存（如果有 Model）
 *   - upsertCitations：先更新内存，再异步写 DB（如果有 Model）
 *   - rebuildAll：清空内存 + 从 DB 全量提取 + 重建内存 + 写 DB
 *
 * 降级策略（14 §14.6）：
 *   - 单条 upsert 失败：跳过 + 审计，不影响其他法条
 *   - case_precedent/document_record 无 citedLaws/lawRefs 字段：跳过该记录
 *   - 全量重建超时（> 30 分钟）：保留旧图谱 + 告警
 *
 * 设计依据：14 §14.1-14.7；05 3.26 law_citation_graph。
 */
import { Injectable, Optional } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  LawCitationGraph,
  type LawCitationGraphDocument,
} from '../../../infra/database/schemas/citation-graph.schema';
import {
  CasePrecedent,
  type CasePrecedentDocument,
} from '../../../infra/database/schemas/legal.schema';
import {
  DocumentRecord,
  type DocumentRecordDocument,
} from '../../../infra/database/schemas/document.schema';
import { extractLawRefs } from '../../../services/legal/llm/lawRefExtractor';
import type { AppLoggerService } from '../../platform/logger/logger.service';

/** 记录类型 */
export type CitationRecordType = 'case' | 'document';

/** 图谱条目（内存结构） */
interface GraphEntry {
  articleId: string;
  citingCaseIds: Set<string>;
  citingDocIds: Set<string>;
  citedCount: number;
  lastCitedAt: Date;
  updatedAt: Date;
}

/** 图谱查询结果（对外输出，Set 转为数组） */
export interface CitationGraphResult {
  articleId: string;
  citingCaseIds: string[];
  citingDocIds: string[];
  citedCount: number;
  lastCitedAt: Date;
  updatedAt: Date;
}

/** 全量重建结果统计 */
export interface RebuildStats {
  caseCount: number;
  docCount: number;
  articleCount: number;
  durationMs: number;
  errors: number;
}

/** upsert 单条结果 */
export interface UpsertResult {
  articleId: string;
  upserted: boolean;
  citedCount: number;
}

/** 30 分钟超时保护（14 §14.6） */
const REBUILD_TIMEOUT_MS = 30 * 60 * 1000;

@Injectable()
export class CitationGraphBuilderService implements OnModuleInit {
  /** 内存索引：articleId → GraphEntry */
  private readonly graph = new Map<string, GraphEntry>();

  constructor(
    @Optional()
    @InjectModel(LawCitationGraph.name)
    private readonly graphModel?: Model<LawCitationGraphDocument>,
    @Optional()
    @InjectModel(CasePrecedent.name)
    private readonly caseModel?: Model<CasePrecedentDocument>,
    @Optional()
    @InjectModel(DocumentRecord.name)
    private readonly docModel?: Model<DocumentRecordDocument>,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  /** NestJS 生命周期钩子：模块初始化时从 DB 加载图谱 */
  async onModuleInit(): Promise<void> {
    if (!this.graphModel) {
      this.logger?.debug('CitationGraphBuilder 无 graphModel，仅内存模式');
      return;
    }
    await this.loadFromDb();
  }

  /** 从 DB 加载图谱到内存 */
  async loadFromDb(): Promise<void> {
    try {
      const docs = await this.graphModel!.find().lean().exec();
      this.graph.clear();
      for (const doc of docs) {
        this.graph.set(doc.articleId, {
          articleId: doc.articleId,
          citingCaseIds: new Set(doc.citingCaseIds ?? []),
          citingDocIds: new Set(doc.citingDocIds ?? []),
          citedCount: doc.citedCount ?? 0,
          lastCitedAt: doc.lastCitedAt ?? new Date(),
          updatedAt: doc.updatedAt ?? new Date(),
        });
      }
      this.logger?.info('法条引用图谱加载完成', {
        articleCount: this.graph.size,
      });
    } catch (err) {
      this.logger?.error('法条引用图谱加载失败，降级为空图谱', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 增量 upsert：更新单条记录的法条引用关系（14 §14.4 增量模式）。
   *
   * @param recordId 案例/文书 ID
   * @param citedLaws 法条引用列表（articleId 形式，如 "民法典第143条"）
   * @param recordType 记录类型（case / document）
   * @returns 每条 articleId 的 upsert 结果
   */
  async upsertCitations(
    recordId: string,
    citedLaws: string[],
    recordType: CitationRecordType,
  ): Promise<UpsertResult[]> {
    if (!recordId || !citedLaws || citedLaws.length === 0) {
      return [];
    }

    const now = new Date();
    const results: UpsertResult[] = [];
    const toPersist: Array<{ articleId: string; entry: GraphEntry }> = [];

    for (const articleId of citedLaws) {
      const normalizedId = this.normalizeArticleId(articleId);
      if (!normalizedId) continue;

      try {
        const entry = this.upsertInMemory(normalizedId, recordId, recordType, now);
        results.push({
          articleId: normalizedId,
          upserted: true,
          citedCount: entry.citedCount,
        });
        toPersist.push({ articleId: normalizedId, entry });
      } catch (err) {
        // 14 §14.6 降级：单条 upsert 失败跳过 + 审计
        this.logger?.warn('单条法条引用 upsert 失败，跳过', {
          articleId: normalizedId,
          recordId,
          recordType,
          error: err instanceof Error ? err.message : String(err),
        });
        results.push({ articleId: normalizedId, upserted: false, citedCount: 0 });
      }
    }

    // 异步持久化到 DB（不阻塞主流程）
    if (this.graphModel && toPersist.length > 0) {
      this.persistUpserts(toPersist).catch((err) => {
        this.logger?.warn('法条引用图谱 DB 持久化失败（内存已更新）', {
          count: toPersist.length,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    return results;
  }

  /**
   * 全量重建：清空图谱 + 从 case_precedent/document_record 全量提取重建（14 §14.4 全量模式）。
   *
   * 算法：
   *   1. 清空内存图谱
   *   2. 遍历 case_precedent，对每条记录的 content 提取法条引用（extractLawRefs），upsert
   *   3. 遍历 document_record，对每条记录的 lawRefs 字段 upsert（缺失时从 renderedText 提取）
   *   4. 如果有 graphModel，清空 DB + 批量写入
   *   5. 审计 citation_graph_rebuilt
   *
   * @returns 重建统计
   */
  async rebuildAll(): Promise<RebuildStats> {
    const startedAt = Date.now();
    this.logger?.info('法条引用图谱全量重建开始');

    // 保留旧图谱备份（降级用，14 §14.6）
    const oldGraph = new Map(this.graph);
    this.graph.clear();

    let caseCount = 0;
    let docCount = 0;
    let errors = 0;

    try {
      // 1. 遍历 case_precedent
      if (this.caseModel) {
        try {
          const cases = await this.caseModel.find().lean().exec();
          for (const c of cases) {
            try {
              const id = c.contentHash ?? String(c._id);
              const refs = extractLawRefs(c.content ?? '');
              if (refs.length > 0) {
                await this.upsertCitations(
                  id,
                  refs.map((r) => r.ref),
                  'case',
                );
                caseCount++;
              }
            } catch (err) {
              errors++;
              this.logger?.warn('案例法条引用提取失败，跳过', {
                caseId: String(c._id),
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        } catch (err) {
          this.logger?.error('case_precedent 全量读取失败', {
            error: err instanceof Error ? err.message : String(err),
          });
          errors++;
        }
      }

      // 2. 遍历 document_record
      if (this.docModel) {
        try {
          const docs = await this.docModel.find().lean().exec();
          for (const d of docs) {
            try {
              const id = d.docId;
              // 优先用 lawRefs 字段，缺失时从 renderedText 提取
              let refs: string[] = d.lawRefs ?? [];
              if (refs.length === 0 && d.renderedText) {
                refs = extractLawRefs(d.renderedText).map((r) => r.ref);
              }
              if (refs.length > 0) {
                await this.upsertCitations(id, refs, 'document');
                docCount++;
              }
            } catch (err) {
              errors++;
              this.logger?.warn('文书法条引用提取失败，跳过', {
                docId: d.docId,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        } catch (err) {
          this.logger?.error('document_record 全量读取失败', {
            error: err instanceof Error ? err.message : String(err),
          });
          errors++;
        }
      }

      // 3. 持久化到 DB（清空 + 批量写入）
      if (this.graphModel) {
        await this.persistFullRebuild();
      }

      const stats: RebuildStats = {
        caseCount,
        docCount,
        articleCount: this.graph.size,
        durationMs: Date.now() - startedAt,
        errors,
      };

      this.logger?.info('法条引用图谱全量重建完成', { ...stats });

      // 14 §14.6 降级：超时保护
      if (stats.durationMs > REBUILD_TIMEOUT_MS) {
        this.logger?.warn('法条引用图谱全量重建超时（> 30 分钟），建议人工介入', { ...stats });
      }

      return stats;
    } catch (err) {
      // 14 §14.6 降级：重建失败时恢复旧图谱
      this.logger?.error('法条引用图谱全量重建失败，恢复旧图谱', {
        error: err instanceof Error ? err.message : String(err),
      });
      this.graph.clear();
      for (const [k, v] of oldGraph) this.graph.set(k, v);
      throw err;
    }
  }

  /**
   * 查询单条法条的引用关系。
   * @param articleId 法条 ID（如 "民法典第143条"）
   * @returns 图谱条目；未命中返回 null
   */
  getGraph(articleId: string): CitationGraphResult | null {
    const normalizedId = this.normalizeArticleId(articleId);
    if (!normalizedId) return null;
    const entry = this.graph.get(normalizedId);
    if (!entry) return null;
    return this.toResult(entry);
  }

  /**
   * 查询热门法条（按 citedCount 降序）。
   * @param topK 返回条数（默认 10）
   * @returns 图谱条目数组
   */
  getHotArticles(topK = 10): CitationGraphResult[] {
    const entries = Array.from(this.graph.values());
    entries.sort((a, b) => b.citedCount - a.citedCount);
    return entries.slice(0, topK).map((e) => this.toResult(e));
  }

  /** 当前图谱大小（调试/测试用） */
  get size(): number {
    return this.graph.size;
  }

  /** 清空内存图谱（仅用于测试隔离） */
  clearForTesting(): void {
    this.graph.clear();
  }

  // ===== 内部方法 =====

  /** 内存 upsert（核心算法 14 §14.4 步骤 2） */
  private upsertInMemory(
    articleId: string,
    recordId: string,
    recordType: CitationRecordType,
    now: Date,
  ): GraphEntry {
    let entry = this.graph.get(articleId);
    if (!entry) {
      entry = {
        articleId,
        citingCaseIds: new Set<string>(),
        citingDocIds: new Set<string>(),
        citedCount: 0,
        lastCitedAt: now,
        updatedAt: now,
      };
      this.graph.set(articleId, entry);
    }

    if (recordType === 'case') {
      entry.citingCaseIds.add(recordId);
    } else {
      entry.citingDocIds.add(recordId);
    }
    entry.citedCount = entry.citingCaseIds.size + entry.citingDocIds.size;
    entry.lastCitedAt = now;
    entry.updatedAt = now;

    return entry;
  }

  /** 异步持久化 upsert 到 DB（批量） */
  private async persistUpserts(
    entries: Array<{ articleId: string; entry: GraphEntry }>,
  ): Promise<void> {
    if (!this.graphModel) return;
    const ops = entries.map(({ articleId, entry }) => ({
      updateOne: {
        filter: { articleId },
        update: {
          $set: {
            articleId,
            citingCaseIds: Array.from(entry.citingCaseIds),
            citingDocIds: Array.from(entry.citingDocIds),
            citedCount: entry.citedCount,
            lastCitedAt: entry.lastCitedAt,
            updatedAt: entry.updatedAt,
          },
        },
        upsert: true,
      },
    }));
    await this.graphModel.bulkWrite(ops);
  }

  /** 全量重建后持久化到 DB（清空 + 批量写入） */
  private async persistFullRebuild(): Promise<void> {
    if (!this.graphModel) return;
    await this.graphModel.deleteMany({}).exec();
    if (this.graph.size === 0) return;
    const docs = Array.from(this.graph.values()).map((entry) => ({
      articleId: entry.articleId,
      citingCaseIds: Array.from(entry.citingCaseIds),
      citingDocIds: Array.from(entry.citingDocIds),
      citedCount: entry.citedCount,
      lastCitedAt: entry.lastCitedAt,
      updatedAt: entry.updatedAt,
    }));
    await this.graphModel.insertMany(docs);
  }

  /** articleId 规范化（trim + 空值检查） */
  private normalizeArticleId(articleId: string): string | null {
    if (!articleId || typeof articleId !== 'string') return null;
    const trimmed = articleId.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /** GraphEntry → CitationGraphResult（Set 转数组） */
  private toResult(entry: GraphEntry): CitationGraphResult {
    return {
      articleId: entry.articleId,
      citingCaseIds: Array.from(entry.citingCaseIds),
      citingDocIds: Array.from(entry.citingDocIds),
      citedCount: entry.citedCount,
      lastCitedAt: entry.lastCitedAt,
      updatedAt: entry.updatedAt,
    };
  }
}
