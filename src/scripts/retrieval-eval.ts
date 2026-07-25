/**
 * 检索离线评测脚本（A2-W4）。
 *
 * 用途：基于 src/data/retrievalEvalSet.ts（50 题金标）评测 BM25 检索质量。
 *       从 LAW_ARTICLES 种子数据构建内存索引，无外部依赖（不需 MongoDB）。
 *
 * 指标：
 *   - Recall@10：至少 1 条期望文档出现在 top-10 的比例
 *   - Recall@10-strict：所有期望文档均出现在 top-10 的比例
 *   - MRR（Mean Reciprocal Rank）：首条命中文档排名倒数的均值
 *   - NDCG@10：归一化折损累计增益
 *
 * 分维度：category（law_ref / keyword / scenario / multi_result）
 *
 * 运行：npm run eval:retrieval
 * 输出：reports/retrieval-eval-report.json + 控制台摘要
 * 验收：Recall@10 ≥ 0.85
 */
// reflect-metadata 必须在导入 @nestjs/mongoose 装饰的 schema 之前加载，
// 否则 @Prop 无法推断字段类型（main.ts / tests/setup.ts 同样处理）。
import 'reflect-metadata';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { InMemoryBm25Retriever } from '../modules/legal/retrieval/in-memory-bm25.retriever';
import type { RetrievalResult } from '../modules/legal/retrieval/retrieval.types';
import { LAW_ARTICLES } from '../data/lawArticles';
import {
  RETRIEVAL_EVAL_SET,
  RETRIEVAL_EVAL_VERSION,
  type RetrievalEvalItem,
} from '../data/retrievalEvalSet';

interface CaseResult {
  item: RetrievalEvalItem;
  retrieved: RetrievalResult[];
  hit: boolean; // 至少 1 条期望文档在 top-10
  strictHit: boolean; // 所有期望文档在 top-10
  firstRelRank: number | null; // 首条命中排名（0-based，null=未命中）
  dcg: number;
  idcg: number;
}

interface CategoryMetric {
  total: number;
  recall: number;
  mrr: number;
  ndcg: number;
}

interface EvalReport {
  version: number;
  total: number;
  recallAt10: number;
  recallAt10Strict: number;
  mrr: number;
  ndcgAt10: number;
  perCategory: Record<string, CategoryMetric>;
  misses: CaseResult[];
  generatedAt: string;
}

/** 构建文档 ID：lawName#articleNoInt */
function docId(lawName: string, articleNoInt: number): string {
  return `${lawName}#${articleNoInt}`;
}

/** 构建 BM25 索引（从种子数据，mock Mongoose Model） */
function buildRetriever(): InMemoryBm25Retriever {
  const mockModel = {
    find: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }),
  };
  const retriever = new InMemoryBm25Retriever(mockModel as never, mockModel as never);

  for (const art of LAW_ARTICLES) {
    if (art.status !== 'effective') continue;
    retriever.addDocument({
      id: docId(art.lawName, art.articleNoInt),
      collection: 'law_article',
      title: `${art.lawName} ${art.articleNo}`,
      content: art.content,
      lawRefs: [
        { ref: `${art.lawName}第${art.articleNo}`, title: `${art.lawName} ${art.articleNo}` },
      ],
      meta: {
        lawName: art.lawName,
        articleNo: art.articleNo,
        category: art.category,
        status: art.status,
      },
    });
  }

  return retriever;
}

/** DCG@k */
function dcgAtK(relevance: number[], k: number): number {
  let sum = 0;
  for (let i = 0; i < Math.min(relevance.length, k); i++) {
    sum += (Math.pow(2, relevance[i]) - 1) / Math.log2(i + 2);
  }
  return sum;
}

async function runEval(): Promise<EvalReport> {
  const retriever = buildRetriever();
  const results: CaseResult[] = [];

  for (const item of RETRIEVAL_EVAL_SET) {
    const retrieved = await retriever.retrieve(item.query, { topK: 10 });
    const retrievedIds = new Set(retrieved.map((r) => r.id));

    // Recall@10：至少 1 条命中
    const hit = item.expectedDocIds.some((id) => retrievedIds.has(id));
    // Recall@10-strict：全部命中
    const strictHit = item.expectedDocIds.every((id) => retrievedIds.has(id));

    // MRR：首条命中排名
    let firstRelRank: number | null = null;
    for (let i = 0; i < retrieved.length; i++) {
      if (item.expectedDocIds.includes(retrieved[i].id)) {
        firstRelRank = i;
        break;
      }
    }

    // NDCG@10：二值相关性（1=相关, 0=不相关）
    const relevance = retrieved.map((r) => (item.expectedDocIds.includes(r.id) ? 1 : 0));
    const idealRel = Array.from({ length: item.expectedDocIds.length }, () => 1);
    const dcg = dcgAtK(relevance, 10);
    const idcg = dcgAtK(idealRel, 10);

    results.push({
      item,
      retrieved,
      hit,
      strictHit,
      firstRelRank,
      dcg,
      idcg,
    });
  }

  return buildReport(results);
}

function buildReport(results: CaseResult[]): EvalReport {
  const total = results.length;
  const hits = results.filter((r) => r.hit).length;
  const strictHits = results.filter((r) => r.strictHit).length;

  const recallAt10 = total > 0 ? hits / total : 0;
  const recallAt10Strict = total > 0 ? strictHits / total : 0;

  // MRR
  const mrr =
    total > 0
      ? results.reduce(
          (sum, r) => sum + (r.firstRelRank !== null ? 1 / (r.firstRelRank + 1) : 0),
          0,
        ) / total
      : 0;

  // NDCG@10
  const ndcgAt10 =
    total > 0 ? results.reduce((sum, r) => sum + (r.idcg > 0 ? r.dcg / r.idcg : 0), 0) / total : 0;

  // 分类别
  const categories = ['law_ref', 'keyword', 'scenario', 'multi_result'];
  const perCategory: Record<string, CategoryMetric> = {};
  for (const cat of categories) {
    const subset = results.filter((r) => r.item.category === cat);
    const catHits = subset.filter((r) => r.hit).length;
    const catMrr =
      subset.length > 0
        ? subset.reduce((s, r) => s + (r.firstRelRank !== null ? 1 / (r.firstRelRank + 1) : 0), 0) /
          subset.length
        : 0;
    const catNdcg =
      subset.length > 0
        ? subset.reduce((s, r) => s + (r.idcg > 0 ? r.dcg / r.idcg : 0), 0) / subset.length
        : 0;
    perCategory[cat] = {
      total: subset.length,
      recall: subset.length > 0 ? catHits / subset.length : 0,
      mrr: catMrr,
      ndcg: catNdcg,
    };
  }

  const misses = results.filter((r) => !r.hit);

  return {
    version: RETRIEVAL_EVAL_VERSION,
    total,
    recallAt10,
    recallAt10Strict,
    mrr,
    ndcgAt10,
    perCategory,
    misses,
    generatedAt: new Date().toISOString(),
  };
}

function printSummary(report: EvalReport): void {
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  console.log('==================== 检索评测报告（BM25 离线）====================');
  console.log(`版本: v${report.version}  生成时间: ${report.generatedAt}`);
  console.log(`总数: ${report.total}`);
  console.log(`Recall@10:        ${pct(report.recallAt10)}`);
  console.log(`Recall@10(strict):${pct(report.recallAt10Strict)}`);
  console.log(`MRR:              ${report.mrr.toFixed(4)}`);
  console.log(`NDCG@10:          ${report.ndcgAt10.toFixed(4)}`);
  console.log('');
  console.log('---- 分类别指标 ----');
  console.log(
    'category'.padEnd(16) +
      'total'.padStart(8) +
      'Recall@10'.padStart(12) +
      'MRR'.padStart(10) +
      'NDCG@10'.padStart(10),
  );
  for (const [cat, m] of Object.entries(report.perCategory)) {
    console.log(
      cat.padEnd(16) +
        String(m.total).padStart(8) +
        pct(m.recall).padStart(12) +
        m.mrr.toFixed(4).padStart(10) +
        m.ndcg.toFixed(4).padStart(10),
    );
  }
  console.log('');
  if (report.misses.length > 0) {
    console.log(`---- 未命中清单（共 ${report.misses.length} 条）----`);
    for (const m of report.misses) {
      const retrievedIds = m.retrieved
        .map((r) => r.id)
        .slice(0, 3)
        .join(', ');
      console.log(
        `  [${m.item.category}/${m.item.difficulty}] ` +
          `"${m.item.query.slice(0, 32)}" → 期望 ${m.item.expectedDocIds.join(', ')}` +
          ` | 实际 top3: ${retrievedIds || '(空)'}`,
      );
    }
  }
  console.log('==========================================================================');
}

async function main(): Promise<void> {
  const report = await runEval();
  printSummary(report);

  const outPath = resolve(process.cwd(), 'reports', 'retrieval-eval-report.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`[eval] JSON 报告已写入: ${outPath}`);

  const THRESHOLD = 0.85;
  if (report.recallAt10 < THRESHOLD) {
    console.error(
      `[eval] Recall@10 ${report.recallAt10.toFixed(4)} 低于阈值 ${THRESHOLD}，评测未通过`,
    );
    process.exit(1);
  }
  console.log(`[eval] 评测通过（Recall@10 阈值 ${THRESHOLD}）`);
}

main().catch((e) => {
  console.error('[eval] FAIL', e);
  process.exit(1);
});
