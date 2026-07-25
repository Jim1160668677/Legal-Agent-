/**
 * InMemoryBm25Retriever —— 内存 BM25 索引 + Okapi BM25 评分（A2-W3）。
 *
 * 职责：
 *   1. onModuleInit 时从 MongoDB 加载 law_article + case_precedent，构建内存倒排索引
 *   2. retrieve(query) → 按 BM25 评分降序返回 RetrievalResult[]
 *
 * BM25 参数：k1=1.5（词频饱和）、b=0.75（长度归一化）
 * IDF 公式：ln((N - df + 0.5) / (df + 0.5) + 1)（+1 平滑，保证非负）
 *
 * 可插拔：实现 Retriever 接口；生产可替换为 Atlas Search / Elasticsearch。
 * 单元测试：绕过 onModuleInit，手动 addDocument 构建索引。
 *
 * 设计依据：A2 §4.2 第一路 BM25 召回；Okapi BM25 标准公式。
 */
import { Injectable, Optional } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  LawArticle,
  type LawArticleDocument,
  CasePrecedent,
  type CasePrecedentDocument,
} from '../../../infra/database/schemas/legal.schema';
import type { AppLoggerService } from '../../platform/logger/logger.service';
import { tokenize, termFrequencies } from './bm25.tokenizer';
import type { Retriever, RetrievalResult, Bm25Document } from './retrieval.types';

/** BM25 参数 */
const K1 = 1.5;
const B = 0.75;

/** 索引文档（含分词与词频） */
interface IndexedDoc {
  id: string;
  collection: Bm25Document['collection'];
  title: string;
  content: string;
  tf: Map<string, number>;
  length: number;
  lawRefs?: Bm25Document['lawRefs'];
  meta?: Record<string, unknown>;
}

@Injectable()
export class InMemoryBm25Retriever implements Retriever, OnModuleInit {
  readonly name = 'in-memory-bm25';

  private readonly docs = new Map<string, IndexedDoc>();
  /** 倒排索引：token → docId 集合 */
  private readonly invertedIndex = new Map<string, Set<string>>();
  private avgDocLength = 0;

  constructor(
    @InjectModel(LawArticle.name) private readonly lawModel: Model<LawArticleDocument>,
    @InjectModel(CasePrecedent.name)
    private readonly caseModel: Model<CasePrecedentDocument>,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  /** NestJS 生命周期钩子：模块初始化时从 DB 加载并构建索引 */
  async onModuleInit(): Promise<void> {
    await this.loadFromDb();
  }

  /** 从 MongoDB 加载法条 + 案例并构建索引 */
  async loadFromDb(): Promise<void> {
    try {
      const [laws, cases] = await Promise.all([
        this.lawModel.find().lean().exec(),
        this.caseModel.find().lean().exec(),
      ]);

      for (const law of laws) {
        const id = law.contentHash ?? String(law._id);
        this.addDocument({
          id,
          collection: 'law_article',
          title: `${law.lawName} ${law.articleNo}`,
          content: law.content,
          lawRefs: [
            { ref: `${law.lawName}第${law.articleNo}`, title: `${law.lawName} ${law.articleNo}` },
          ],
          meta: {
            lawName: law.lawName,
            articleNo: law.articleNo,
            category: law.category,
            status: law.status,
          },
        });
      }

      for (const c of cases) {
        const id = c.contentHash ?? String(c._id);
        this.addDocument({
          id,
          collection: 'case_precedent',
          title: c.caseTitle,
          content: c.content,
          meta: {
            caseNo: c.caseNo,
            category: c.category,
            causeOfAction: c.causeOfAction,
            court: c.court,
          },
        });
      }

      this.logger?.info('BM25 索引构建完成', {
        lawArticles: laws.length,
        casePrecedents: cases.length,
        totalDocs: this.docs.size,
        avgDocLength: Math.round(this.avgDocLength),
      });
    } catch (err) {
      this.logger?.error('BM25 索引加载失败，降级为空索引', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 手动添加文档到索引（供测试与种子数据用）。
   * 若 tokens 为空则自动分词 title + content。
   */
  addDocument(doc: Bm25Document): void {
    const tokens = doc.tokens?.length ? doc.tokens : tokenize(`${doc.title} ${doc.content}`);
    const tf = termFrequencies(tokens);

    this.docs.set(doc.id, {
      id: doc.id,
      collection: doc.collection,
      title: doc.title,
      content: doc.content,
      tf,
      length: tokens.length,
      lawRefs: doc.lawRefs,
      meta: doc.meta,
    });

    for (const token of tf.keys()) {
      const set = this.invertedIndex.get(token) ?? new Set<string>();
      set.add(doc.id);
      this.invertedIndex.set(token, set);
    }

    this.recomputeAvgLength();
  }

  /**
   * BM25 检索。
   * @param query 查询文本
   * @param opts.topK 返回数（默认 10）
   * @param opts.filter 元数据精确过滤
   */
  async retrieve(
    query: string,
    opts?: { topK?: number; filter?: Record<string, unknown> },
  ): Promise<RetrievalResult[]> {
    if (!query?.trim() || this.docs.size === 0) return [];

    const topK = opts?.topK ?? 10;
    const filter = opts?.filter;
    const queryTokens = tokenize(query);

    // 1. 通过倒排索引收集候选文档
    const candidates = new Set<string>();
    for (const token of new Set(queryTokens)) {
      const docIds = this.invertedIndex.get(token);
      if (docIds) for (const id of docIds) candidates.add(id);
    }
    if (candidates.size === 0) return [];

    // 2. 评分
    const results: RetrievalResult[] = [];
    for (const docId of candidates) {
      const doc = this.docs.get(docId)!;
      // 元数据过滤
      if (filter && !this.matchesFilter(doc, filter)) continue;

      const score = this.bm25Score(queryTokens, doc);
      if (score > 0) {
        results.push({
          id: doc.id,
          collection: doc.collection,
          title: doc.title,
          content: doc.content,
          pathScore: score,
          paths: ['bm25'],
          lawRefs: doc.lawRefs,
          meta: doc.meta,
        });
      }
    }

    // 3. 按分数降序，取 topK
    results.sort((a, b) => b.pathScore - a.pathScore);
    return results.slice(0, topK);
  }

  /** 当前索引文档数（调试/测试用） */
  size(): number {
    return this.docs.size;
  }

  // ===== 内部方法 =====

  /** Okapi BM25 评分 */
  private bm25Score(queryTokens: string[], doc: IndexedDoc): number {
    const N = this.docs.size;
    const avgdl = this.avgDocLength || 1;
    let score = 0;

    for (const token of new Set(queryTokens)) {
      const tf = doc.tf.get(token) ?? 0;
      if (tf === 0) continue;

      const df = this.invertedIndex.get(token)?.size ?? 0;
      // IDF：+1 平滑保证非负
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      // BM25 词频饱和 + 长度归一化
      const denom = tf + K1 * (1 - B + B * (doc.length / avgdl));
      score += (idf * (tf * (K1 + 1))) / denom;
    }

    return score;
  }

  /** 元数据精确匹配 */
  private matchesFilter(doc: IndexedDoc, filter: Record<string, unknown>): boolean {
    if (!doc.meta) return false;
    return Object.entries(filter).every(([k, v]) => doc.meta![k] === v);
  }

  /** 重新计算平均文档长度 */
  private recomputeAvgLength(): void {
    if (this.docs.size === 0) {
      this.avgDocLength = 0;
      return;
    }
    let total = 0;
    for (const doc of this.docs.values()) total += doc.length;
    this.avgDocLength = total / this.docs.size;
  }
}
