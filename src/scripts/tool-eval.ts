/**
 * 8 工具评测脚本（v2.3-W2，14-tool-design.md §12）。
 *
 * 用途：基于 src/data/toolEvalSet.ts（80 条金标）评测 8 个 LegalTool
 *       在【离线静态数据】模式下的输出正确性。
 *
 * 评测流程：
 *   1. 实例化 8 个 Tool（绕过 ToolRegistry，直接 invoke）
 *   2. 对每条用例：执行 invoke → 对比 expected 断言 → 记录 pass/fail
 *   3. 输出分工具指标 + 总体指标 + 错例清单
 *
 * 断言规则（ToolEvalExpectation）：
 *   - success: 期望 ToolResult.success
 *   - dataFields: 期望 data 中部分字段值（深度匹配，未列出字段不校验）
 *   - minDataFields: 期望 data 中包含的字段名（仅校验存在性）
 *   - minLawRefsCount: 期望 lawRefs 最少条数
 *   - errorCode: 期望失败时抛出的 LegalToolError.code
 *   - topCauseCode: 期望 data.topCandidates[0].causeCode
 *   - topClauseId: 期望 data.recommendedClauses[0].clauseId
 *   - minClausesCount / minCandidatesCount: 期望列表最少条数
 *   - hasIssueType: 期望 data.issues 至少包含一条 type
 *
 * 指标：
 *   - 各工具准确率 = pass / total
 *   - 总体准确率 = sum(pass) / sum(total)
 *   - 阈值 TOOL_EVAL_THRESHOLD = 0.85
 *
 * 运行：npm run eval:tool
 * 输出：reports/tool-eval-report.json + 控制台摘要
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { LawValidityTool } from '../services/legal/tools/law-validity.tool';
import { PeriodCalculatorTool } from '../services/legal/tools/period-calculator.tool';
import { CompensationQueryTool } from '../services/legal/tools/compensation-query.tool';
import { LicenseOcrTool } from '../services/legal/tools/license-ocr.tool';
import { DocumentReviewerTool } from '../services/legal/tools/document-reviewer.tool';
import { CauseClassifierTool } from '../services/legal/tools/cause-classifier.tool';
import { SentencingGuideTool } from '../services/legal/tools/sentencing-guide.tool';
import { ClauseRecommenderTool } from '../services/legal/tools/clause-recommender.tool';
import type {
  LegalTool,
  ToolContext,
  ToolResult,
  ToolOcrService,
} from '../services/legal/tools/types';
import { LegalToolError } from '../services/legal/tools/types';
import {
  TOOL_EVAL_SET,
  TOOL_EVAL_VERSION,
  TOOL_EVAL_THRESHOLD,
  type ToolEvalItem,
  type ToolId,
} from '../data/toolEvalSet';

// ===== 工具实例化 =====
const tools: Record<ToolId, LegalTool> = {
  law_validity: new LawValidityTool(),
  period_calculator: new PeriodCalculatorTool(),
  compensation_query: new CompensationQueryTool(),
  license_ocr: new LicenseOcrTool(),
  document_review: new DocumentReviewerTool(),
  cause_classification: new CauseClassifierTool(),
  sentencing_guide: new SentencingGuideTool(),
  clause_recommender: new ClauseRecommenderTool(),
};

/** 构造 ToolContext（含可选 ocrService / featureFlags） */
function makeCtx(item: ToolEvalItem): ToolContext {
  const ctx: ToolContext = {
    userId: 'eval-user',
    traceId: `trace-${item.caseId}`,
    requestId: `req-${item.caseId}`,
  };
  if (item.ctxOverrides?.ocrService) {
    ctx.ocrService = item.ctxOverrides.ocrService as ToolOcrService;
  }
  if (item.ctxOverrides?.featureFlags) {
    ctx.featureFlags = item.ctxOverrides.featureFlags as Record<string, boolean>;
  }
  return ctx;
}

// ===== 断言实现 =====

/** 深度部分匹配：actual 包含 expected 的所有键值对 */
function deepMatch(actual: unknown, expected: Record<string, unknown>): boolean {
  if (typeof actual !== 'object' || actual === null) return false;
  const a = actual as Record<string, unknown>;
  for (const [k, v] of Object.entries(expected)) {
    if (!(k in a)) return false;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      if (!deepMatch(a[k], v as Record<string, unknown>)) return false;
    } else if (a[k] !== v) {
      return false;
    }
  }
  return true;
}

/** 校验字段存在性 */
function hasFields(actual: unknown, fields: string[]): boolean {
  if (typeof actual !== 'object' || actual === null) return false;
  const a = actual as Record<string, unknown>;
  return fields.every((f) => f in a);
}

/** 评测单条用例 */
async function evalItem(item: ToolEvalItem): Promise<{
  pass: boolean;
  reason: string;
  actual?: unknown;
}> {
  const tool = tools[item.toolId];
  const ctx = makeCtx(item);

  let result: ToolResult | null = null;
  let thrownError: unknown = null;

  try {
    result = await tool.invoke(item.input, ctx);
  } catch (err) {
    thrownError = err;
  }

  const expected = item.expected;

  // 期望抛错场景
  if (expected.errorCode !== undefined) {
    if (thrownError instanceof LegalToolError) {
      if (thrownError.code === expected.errorCode) {
        return { pass: true, reason: 'OK' };
      }
      return {
        pass: false,
        reason: `期望 errorCode=${expected.errorCode}，实际 errorCode=${thrownError.code}（${thrownError.message}）`,
      };
    }
    if (thrownError) {
      const msg = thrownError instanceof Error ? thrownError.message : String(thrownError);
      return {
        pass: false,
        reason: `期望抛 LegalToolError(code=${expected.errorCode})，实际抛非 LegalToolError: ${msg}`,
      };
    }
    return {
      pass: false,
      reason: `期望抛 LegalToolError(code=${expected.errorCode})，但未抛错（success=${result?.success}）`,
      actual: result,
    };
  }

  // 期望成功场景
  if (thrownError) {
    const msg = thrownError instanceof Error ? thrownError.message : String(thrownError);
    return { pass: false, reason: `期望成功但抛错: ${msg}`, actual: thrownError };
  }

  if (!result) {
    return { pass: false, reason: 'ToolResult 为空' };
  }

  // success 断言
  if (expected.success !== undefined && result.success !== expected.success) {
    return {
      pass: false,
      reason: `期望 success=${expected.success}，实际 success=${result.success}`,
      actual: result,
    };
  }

  // dataFields 深度匹配
  if (expected.dataFields && !deepMatch(result.data, expected.dataFields)) {
    return {
      pass: false,
      reason: `dataFields 不匹配（期望 ${JSON.stringify(expected.dataFields)}，实际 ${JSON.stringify(result.data)}）`,
      actual: result.data,
    };
  }

  // minDataFields 字段存在性
  if (expected.minDataFields && !hasFields(result.data, expected.minDataFields)) {
    return {
      pass: false,
      reason: `minDataFields 缺失（期望含 ${expected.minDataFields.join(',')}，实际 ${JSON.stringify(Object.keys(result.data as Record<string, unknown>))}）`,
      actual: result.data,
    };
  }

  // minLawRefsCount
  if (expected.minLawRefsCount !== undefined) {
    const count = result.lawRefs?.length ?? 0;
    if (count < expected.minLawRefsCount) {
      return {
        pass: false,
        reason: `lawRefs 数量 ${count} < 期望最小 ${expected.minLawRefsCount}`,
        actual: result.lawRefs,
      };
    }
  }

  // cause_classification 专属：topCauseCode
  if (expected.topCauseCode) {
    const data = result.data as { topCandidates?: Array<{ causeCode: string }> };
    const topCode = data.topCandidates?.[0]?.causeCode;
    if (topCode !== expected.topCauseCode) {
      return {
        pass: false,
        reason: `topCauseCode 不匹配（期望 ${expected.topCauseCode}，实际 ${topCode}）`,
        actual: data.topCandidates,
      };
    }
  }

  // clause_recommender 专属：topClauseId
  if (expected.topClauseId) {
    const data = result.data as { recommendedClauses?: Array<{ clauseId: string }> };
    const topId = data.recommendedClauses?.[0]?.clauseId;
    if (topId !== expected.topClauseId) {
      return {
        pass: false,
        reason: `topClauseId 不匹配（期望 ${expected.topClauseId}，实际 ${topId}）`,
        actual: data.recommendedClauses,
      };
    }
  }

  // minClausesCount
  if (expected.minClausesCount !== undefined) {
    const data = result.data as { recommendedClauses?: unknown[] };
    const count = data.recommendedClauses?.length ?? 0;
    if (count < expected.minClausesCount) {
      return {
        pass: false,
        reason: `recommendedClauses 数量 ${count} < 期望最小 ${expected.minClausesCount}`,
      };
    }
  }

  // minCandidatesCount
  if (expected.minCandidatesCount !== undefined) {
    const data = result.data as { topCandidates?: unknown[] };
    const count = data.topCandidates?.length ?? 0;
    if (count < expected.minCandidatesCount) {
      return {
        pass: false,
        reason: `topCandidates 数量 ${count} < 期望最小 ${expected.minCandidatesCount}`,
      };
    }
  }

  // hasIssueType（document_review）
  if (expected.hasIssueType) {
    const data = result.data as { issues?: Array<{ type: string }> };
    const has = data.issues?.some((i) => i.type === expected.hasIssueType);
    if (!has) {
      return {
        pass: false,
        reason: `issues 不含 type=${expected.hasIssueType}（实际 ${JSON.stringify(data.issues?.map((i) => i.type))}）`,
        actual: data.issues,
      };
    }
  }

  return { pass: true, reason: 'OK', actual: result };
}

// ===== 主流程 =====

async function main(): Promise<void> {
  console.log('==================== 8 工具评测报告（离线 / 静态数据）====================');
  console.log(`版本: ${TOOL_EVAL_VERSION}  生成时间: ${new Date().toISOString()}`);
  console.log(`总数: ${TOOL_EVAL_SET.length}`);

  // 分工具统计
  const perToolStats: Record<
    string,
    { total: number; pass: number; fail: number; fails: Array<{ caseId: string; reason: string }> }
  > = {};

  // 分难度统计
  const perDifficultyStats: Record<string, { total: number; pass: number }> = {
    easy: { total: 0, pass: 0 },
    medium: { total: 0, pass: 0 },
    hard: { total: 0, pass: 0 },
  };

  const allFailures: Array<{
    caseId: string;
    toolId: string;
    difficulty: string;
    description: string;
    reason: string;
  }> = [];

  for (const item of TOOL_EVAL_SET) {
    // 初始化统计
    if (!perToolStats[item.toolId]) {
      perToolStats[item.toolId] = { total: 0, pass: 0, fail: 0, fails: [] };
    }
    perToolStats[item.toolId].total++;
    perDifficultyStats[item.difficulty].total++;

    const { pass, reason } = await evalItem(item);

    if (pass) {
      perToolStats[item.toolId].pass++;
      perDifficultyStats[item.difficulty].pass++;
    } else {
      perToolStats[item.toolId].fail++;
      perToolStats[item.toolId].fails.push({ caseId: item.caseId, reason });
      allFailures.push({
        caseId: item.caseId,
        toolId: item.toolId,
        difficulty: item.difficulty,
        description: item.description,
        reason,
      });
    }
  }

  // ===== 控制台输出 =====
  console.log('\n---- 各工具准确率 ----');
  console.log('toolId                       total    pass    fail    accuracy');
  let totalPass = 0;
  let totalAll = 0;
  for (const [toolId, stat] of Object.entries(perToolStats)) {
    const acc = stat.total > 0 ? (stat.pass / stat.total) * 100 : 0;
    console.log(
      `${toolId.padEnd(28)} ${String(stat.total).padStart(6)}   ${String(stat.pass).padStart(6)}   ${String(stat.fail).padStart(6)}   ${acc.toFixed(2)}%`,
    );
    totalPass += stat.pass;
    totalAll += stat.total;
  }
  const overallAcc = totalAll > 0 ? (totalPass / totalAll) * 100 : 0;
  console.log(
    `${'TOTAL'.padEnd(28)} ${String(totalAll).padStart(6)}   ${String(totalPass).padStart(6)}   ${String(totalAll - totalPass).padStart(6)}   ${overallAcc.toFixed(2)}%`,
  );

  console.log('\n---- 分难度准确率 ----');
  for (const [diff, stat] of Object.entries(perDifficultyStats)) {
    const acc = stat.total > 0 ? (stat.pass / stat.total) * 100 : 0;
    console.log(
      `  ${diff.padEnd(8)} ${String(stat.pass).padStart(4)}/${String(stat.total).padStart(4)} = ${acc.toFixed(2)}%`,
    );
  }

  console.log(`\n---- 错例清单（共 ${allFailures.length} 条）----`);
  for (const f of allFailures) {
    console.log(`  [${f.toolId}/${f.difficulty}] ${f.caseId}: ${f.description}`);
    console.log(`    原因: ${f.reason}`);
  }

  // ===== JSON 报告 =====
  const report = {
    version: TOOL_EVAL_VERSION,
    generatedAt: new Date().toISOString(),
    totalCases: totalAll,
    passed: totalPass,
    failed: totalAll - totalPass,
    overallAccuracy: Number(overallAcc.toFixed(4)),
    threshold: TOOL_EVAL_THRESHOLD,
    passedGate: overallAcc / 100 >= TOOL_EVAL_THRESHOLD,
    perTool: Object.fromEntries(
      Object.entries(perToolStats).map(([k, v]) => [
        k,
        {
          total: v.total,
          pass: v.pass,
          fail: v.fail,
          accuracy: v.total > 0 ? Number(((v.pass / v.total) * 100).toFixed(2)) : 0,
        },
      ]),
    ),
    perDifficulty: Object.fromEntries(
      Object.entries(perDifficultyStats).map(([k, v]) => [
        k,
        {
          total: v.total,
          pass: v.pass,
          accuracy: v.total > 0 ? Number(((v.pass / v.total) * 100).toFixed(2)) : 0,
        },
      ]),
    ),
    failures: allFailures,
  };

  const reportPath = resolve(process.cwd(), 'reports', 'tool-eval-report.json');
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('==========================================================================');
  console.log(`[eval] JSON 报告已写入: ${reportPath}`);
  if (report.passedGate) {
    console.log(`[eval] 评测通过（阈值 ${TOOL_EVAL_THRESHOLD}）`);
    process.exit(0);
  } else {
    console.log(
      `[eval] 评测未通过（准确率 ${overallAcc.toFixed(2)}% < 阈值 ${TOOL_EVAL_THRESHOLD * 100}%）`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[eval] 评测脚本异常:', err);
  process.exit(2);
});
