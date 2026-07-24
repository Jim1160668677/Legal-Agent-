/**
 * 意图识别离线评测脚本（A1-W3.9）。
 *
 * 用途：基于 src/data/intentEvalSet.ts（200 条人工标注）评测 IntentRouterService
 *       在【无 LLM 辅助】离线模式下的打分准确率，输出多维指标与错例清单。
 *
 * 离线模式说明：
 *   IntentRouterService 构造时不注入 LlmService，0.5-0.8 区间的 assistWithLlm
 *   会降级返回 top1（candidates[0]）。因此本脚本评测的是纯关键词+正则打分基线，
 *   反映 IntentRouter 在 LLM 不可用时的下限能力（07 §1.4 Fallback 链第 2 层）。
 *
 * 指标：
 *   - overall intent accuracy / route accuracy
 *   - per-intent precision / recall / F1
 *   - per-category（normal/boundary/exception）/ per-difficulty（easy/medium/hard）accuracy
 *   - 混淆矩阵（expectedIntent → predictedIntent 计数）
 *   - 错例清单（text / expected / predicted / confidence）
 *
 * 运行：npm run eval:intent
 * 输出：reports/intent-eval-report.json + 控制台摘要
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { IntentRouterService } from '../modules/legal/intent/intent-router.service';
import type { IntentType, RouteTarget } from '../types/intent';
import type { DialogContext } from '../types/dialog';
import { INTENT_EVAL_SET, INTENT_EVAL_VERSION, type IntentEvalItem } from '../data/intentEvalSet';

/** 8 意图固定顺序（混淆矩阵行列对齐） */
const INTENT_ORDER: IntentType[] = [
  'legal_qa',
  'document_generate',
  'process_guide',
  'case_analysis',
  'case_reasoning',
  'material_checklist',
  'tool_invoke',
  'general_qa',
];

interface CaseResult {
  item: IntentEvalItem;
  predictedIntent: IntentType | null;
  predictedRoute: RouteTarget | null;
  confidence: number;
  fallbackUsed: boolean;
  intentCorrect: boolean;
  routeCorrect: boolean;
  error?: string;
}

interface IntentMetric {
  intent: IntentType;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

interface EvalReport {
  version: number;
  mode: 'offline-no-llm';
  total: number;
  evaluated: number;
  errors: number;
  intentAccuracy: number;
  routeAccuracy: number;
  perIntent: IntentMetric[];
  perCategory: Record<string, { total: number; correct: number; accuracy: number }>;
  perDifficulty: Record<string, { total: number; correct: number; accuracy: number }>;
  confusion: Record<string, Record<string, number>>;
  misclassified: CaseResult[];
  generatedAt: string;
}

/** 构造最小会话上下文（无多轮延续，隔离单条评测） */
function makeCtx(): DialogContext {
  return {
    sessionId: 'eval-session',
    unresolvedCount: 0,
    recentTurns: [],
  };
}

async function runEval(): Promise<EvalReport> {
  const router = new IntentRouterService();
  const ctx = makeCtx();
  const results: CaseResult[] = [];

  for (const item of INTENT_EVAL_SET) {
    try {
      const r = await router.classify(item.text, ctx);
      const predictedIntent = r.intent;
      const predictedRoute = r.route;
      const intentCorrect = predictedIntent === item.expectedIntent;
      const routeCorrect = predictedRoute === item.expectedRoute;
      results.push({
        item,
        predictedIntent,
        predictedRoute,
        confidence: r.confidence,
        fallbackUsed: r.fallbackUsed,
        intentCorrect,
        routeCorrect,
      });
    } catch (err) {
      // classify 对空输入抛 BadRequestException；评测集应无空串，仍兜底记录
      results.push({
        item,
        predictedIntent: null,
        predictedRoute: null,
        confidence: 0,
        fallbackUsed: true,
        intentCorrect: false,
        routeCorrect: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return buildReport(results);
}

function buildReport(results: CaseResult[]): EvalReport {
  const total = results.length;
  const errored = results.filter((r) => r.error);
  const evaluated = total - errored.length;

  const intentCorrectCount = results.filter((r) => r.intentCorrect).length;
  const routeCorrectCount = results.filter((r) => r.routeCorrect).length;

  // ===== per-intent P/R/F1 =====
  const perIntent: IntentMetric[] = INTENT_ORDER.map((intent) => {
    const support = results.filter((r) => r.item.expectedIntent === intent).length;
    const tp = results.filter(
      (r) => r.item.expectedIntent === intent && r.predictedIntent === intent,
    ).length;
    const fp = results.filter(
      (r) => r.item.expectedIntent !== intent && r.predictedIntent === intent,
    ).length;
    const fn = results.filter(
      (r) => r.item.expectedIntent === intent && r.predictedIntent !== intent,
    ).length;
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    return { intent, tp, fp, fn, precision, recall, f1, support };
  });

  // ===== per-category =====
  const perCategory: EvalReport['perCategory'] = {};
  for (const cat of ['normal', 'boundary', 'exception']) {
    const subset = results.filter((r) => r.item.category === cat);
    const correct = subset.filter((r) => r.intentCorrect).length;
    perCategory[cat] = {
      total: subset.length,
      correct,
      accuracy: subset.length ? correct / subset.length : 0,
    };
  }

  // ===== per-difficulty =====
  const perDifficulty: EvalReport['perDifficulty'] = {};
  for (const diff of ['easy', 'medium', 'hard']) {
    const subset = results.filter((r) => r.item.difficulty === diff);
    const correct = subset.filter((r) => r.intentCorrect).length;
    perDifficulty[diff] = {
      total: subset.length,
      correct,
      accuracy: subset.length ? correct / subset.length : 0,
    };
  }

  // ===== 混淆矩阵 =====
  const confusion: EvalReport['confusion'] = {};
  for (const exp of INTENT_ORDER) {
    confusion[exp] = {};
    for (const pred of INTENT_ORDER) {
      confusion[exp][pred] = 0;
    }
  }
  for (const r of results) {
    const exp = r.item.expectedIntent;
    const pred = r.predictedIntent ?? '__error__';
    if (!confusion[exp][pred]) confusion[exp][pred] = 0;
    confusion[exp][pred] += 1;
  }

  const misclassified = results.filter((r) => !r.intentCorrect);

  return {
    version: INTENT_EVAL_VERSION,
    mode: 'offline-no-llm',
    total,
    evaluated,
    errors: errored.length,
    intentAccuracy: evaluated > 0 ? intentCorrectCount / evaluated : 0,
    routeAccuracy: evaluated > 0 ? routeCorrectCount / evaluated : 0,
    perIntent,
    perCategory,
    perDifficulty,
    confusion,
    misclassified,
    generatedAt: new Date().toISOString(),
  };
}

function printSummary(report: EvalReport): void {
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  console.log('==================== 意图识别评测报告（离线 / 无 LLM）====================');
  console.log(`版本: v${report.version}  模式: ${report.mode}  生成时间: ${report.generatedAt}`);
  console.log(`总数: ${report.total}  评测: ${report.evaluated}  异常: ${report.errors}`);
  console.log(
    `意图准确率: ${pct(report.intentAccuracy)}  路由准确率: ${pct(report.routeAccuracy)}`,
  );
  console.log('');
  console.log('---- 各意图 P/R/F1 ----');
  console.log(
    'intent'.padEnd(20) +
      'support'.padStart(8) +
      'tp'.padStart(6) +
      'fp'.padStart(6) +
      'fn'.padStart(6) +
      'P'.padStart(9) +
      'R'.padStart(9) +
      'F1'.padStart(9),
  );
  for (const m of report.perIntent) {
    console.log(
      m.intent.padEnd(20) +
        String(m.support).padStart(8) +
        String(m.tp).padStart(6) +
        String(m.fp).padStart(6) +
        String(m.fn).padStart(6) +
        pct(m.precision).padStart(9) +
        pct(m.recall).padStart(9) +
        pct(m.f1).padStart(9),
    );
  }
  console.log('');
  console.log('---- 分类别准确率 ----');
  for (const [cat, m] of Object.entries(report.perCategory)) {
    console.log(`  ${cat.padEnd(10)} ${m.correct}/${m.total} = ${pct(m.accuracy)}`);
  }
  console.log('---- 分难度准确率 ----');
  for (const [diff, m] of Object.entries(report.perDifficulty)) {
    console.log(`  ${diff.padEnd(10)} ${m.correct}/${m.total} = ${pct(m.accuracy)}`);
  }
  console.log('');
  console.log(`---- 错例清单（共 ${report.misclassified.length} 条）----`);
  for (const r of report.misclassified.slice(0, 40)) {
    console.log(
      `  [${r.item.category}/${r.item.difficulty}] ` +
        `"${r.item.text.slice(0, 28)}" → 期望 ${r.item.expectedIntent} / 实际 ${r.predictedIntent}` +
        ` (conf=${r.confidence.toFixed(3)}${r.fallbackUsed ? ',fallback' : ''})`,
    );
  }
  if (report.misclassified.length > 40) {
    console.log(`  ... 其余 ${report.misclassified.length - 40} 条见 JSON 报告`);
  }
  console.log('==========================================================================');
}

async function main(): Promise<void> {
  const report = await runEval();
  printSummary(report);

  const outPath = resolve(process.cwd(), 'reports', 'intent-eval-report.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`[eval] JSON 报告已写入: ${outPath}`);

  // 准确率低于阈值时以非零码退出，便于 CI 拦截回归
  const THRESHOLD = 0.75;
  if (report.intentAccuracy < THRESHOLD) {
    console.error(
      `[eval] 意图准确率 ${report.intentAccuracy.toFixed(4)} 低于阈值 ${THRESHOLD}，评测未通过`,
    );
    process.exit(1);
  }
  console.log(`[eval] 评测通过（阈值 ${THRESHOLD}）`);
}

main().catch((e) => {
  console.error('[eval] FAIL', e);
  process.exit(1);
});
