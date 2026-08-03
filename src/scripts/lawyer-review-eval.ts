/**
 * 律师审核评测脚本（v2.3 阶段十，17 §2-§6 验收）。
 *
 * 用途：基于 src/data/lawyerReviewEvalSet.ts（62 条金标）评测律师审核五合一闭环
 *       6 大维度在【离线 mock】模式下的正确性。
 *
 * 离线 mock 模式说明：
 *   - 不依赖 MongoDB / Redis / LLM，所有服务直接实例化（@Optional 依赖不注入）
 *   - LawyerReviewService 走内存表兜底
 *   - ComplianceMonitor 不注入 ContentSafetyService，由 contentSafetyResult 入参模拟
 *   - LawyerAnnotationService 不注入 Model，仅验证 hasRelevantAnnotations 判定逻辑
 *   - Math.random 通过 spy 控制，确保 normal 抽样可重现
 *
 * 评测维度：
 *   1. sampling：抽样策略准确率（高风险/用户标记/普通）
 *   2. state_machine：状态机流转准确率（合法/非法/跨律师/非法评分）
 *   3. auto_score：自动评分算法误差（保留两位小数）
 *   4. lawyer_score：律师评分聚合误差 + 等级判定准确率
 *   5. compliance：合规风险三路评分准确率（level + triggers）
 *   6. reflow：标注回流目标命中准确率（hitTargets + skippedTargets）
 *
 * 运行：npm run eval:lawyer-review
 * 输出：reports/lawyer-review-eval-report.json + 控制台摘要
 */
import 'reflect-metadata';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { LawyerReviewService } from '../modules/legal/review/lawyer-review.service';
import { AnswerQualityScorer } from '../modules/legal/review/answer-quality-scorer.service';
import { ComplianceMonitor } from '../modules/legal/review/compliance-monitor.service';
import { LawyerAnnotationService } from '../modules/legal/review/lawyer-annotation.service';
import { AnswerTracer } from '../modules/legal/review/answer-tracer.service';
import { REVIEW_ERROR_CODES } from '../modules/legal/review/review.constants';
import {
  SAMPLING_EVAL_SET,
  STATE_MACHINE_EVAL_SET,
  AUTO_SCORE_EVAL_SET,
  LAWYER_SCORE_EVAL_SET,
  COMPLIANCE_EVAL_SET,
  REFLOW_EVAL_SET,
  LAWYER_REVIEW_EVAL_VERSION,
  type StateMachineEvalItem,
} from '../data/lawyerReviewEvalSet';
import type { ReflowTarget } from '../modules/legal/review/review.types';

// ===== 用例结果 =====

interface CaseResultBase {
  id: string;
  category: string;
  difficulty: string;
  correct: boolean;
  error?: string;
}

interface SamplingResult extends CaseResultBase {
  category: 'sampling';
  expected: { sampled: boolean; riskLevel: string };
  actual: { sampled: boolean; riskLevel?: string };
}

interface StateMachineResult extends CaseResultBase {
  category: 'state_machine';
  expected: { resultState?: string; errorCode?: number };
  actual: { resultState?: string; errorCode?: number };
}

interface AutoScoreResult extends CaseResultBase {
  category: 'auto_score';
  expected: { autoScore: number };
  actual: {
    autoScore: number;
    citationSuccessRate: number;
    reasoningCompleteness: number;
    disclaimerCoverage: number;
  };
}

interface LawyerScoreResult extends CaseResultBase {
  category: 'lawyer_score';
  expected: { lawyerScore: number; grade: string };
  actual: { lawyerScore: number; grade: string };
}

interface ComplianceResult extends CaseResultBase {
  category: 'compliance';
  expected: { level: string; blocked: boolean; triggerPaths: string[] };
  actual: { level: string; blocked: boolean; triggerPaths: string[] };
}

interface ReflowResult extends CaseResultBase {
  category: 'reflow';
  expected: { hitTargets: string[]; skippedTargets: string[] };
  actual: { hitTargets: string[]; skippedTargets: string[] };
}

type CaseResult =
  | SamplingResult
  | StateMachineResult
  | AutoScoreResult
  | LawyerScoreResult
  | ComplianceResult
  | ReflowResult;

interface DimensionMetric {
  dimension: string;
  total: number;
  correct: number;
  accuracy: number;
}

interface EvalReport {
  version: number;
  mode: 'offline-mock';
  total: number;
  evaluated: number;
  errors: number;
  overallAccuracy: number;
  perDimension: DimensionMetric[];
  sampling: { results: SamplingResult[]; accuracy: number };
  stateMachine: { results: StateMachineResult[]; accuracy: number };
  autoScore: { results: AutoScoreResult[]; accuracy: number; maxDelta: number };
  lawyerScore: { results: LawyerScoreResult[]; accuracy: number; maxDelta: number };
  compliance: { results: ComplianceResult[]; accuracy: number };
  reflow: { results: ReflowResult[]; accuracy: number };
  misclassified: CaseResult[];
  generatedAt: string;
}

// ===== 工具：Math.random 控制 =====

let randomSpy: (() => number) | null = null;
const originalRandom = Math.random;

function setRandomValue(value: number): void {
  randomSpy = () => value;
  Math.random = randomSpy;
}

function restoreRandom(): void {
  Math.random = originalRandom;
  randomSpy = null;
}

// ===== 维度 1：抽样策略 =====

async function evalSampling(): Promise<{ results: SamplingResult[]; accuracy: number }> {
  const service = new LawyerReviewService();
  const results: SamplingResult[] = [];

  for (const item of SAMPLING_EVAL_SET) {
    try {
      if (item.input.randomValue !== undefined) {
        setRandomValue(item.input.randomValue);
      }
      const r = await service.sample({
        msgId: item.input.msgId,
        userId: item.input.userId,
        intent: item.input.intent,
        userFlagged: item.input.userFlagged,
      });
      const actual = { sampled: r.sampled, riskLevel: r.riskLevel };
      const correct =
        r.sampled === item.expected.sampled && r.riskLevel === item.expected.riskLevel;
      results.push({
        id: item.id,
        category: 'sampling',
        difficulty: item.difficulty,
        correct,
        expected: item.expected,
        actual,
      });
    } catch (err) {
      results.push({
        id: item.id,
        category: 'sampling',
        difficulty: item.difficulty,
        correct: false,
        error: err instanceof Error ? err.message : String(err),
        expected: item.expected,
        actual: { sampled: false, riskLevel: 'error' },
      });
    } finally {
      if (item.input.randomValue !== undefined) restoreRandom();
    }
  }

  const correctCount = results.filter((r) => r.correct).length;
  return { results, accuracy: results.length ? correctCount / results.length : 0 };
}

// ===== 维度 2：状态机 =====

async function evalStateMachine(): Promise<{ results: StateMachineResult[]; accuracy: number }> {
  const results: StateMachineResult[] = [];

  for (const item of STATE_MACHINE_EVAL_SET) {
    // 每个用例独立实例化，避免相互干扰
    const service = new LawyerReviewService();
    let actual: { resultState?: string; errorCode?: number } = {};
    let correct = false;
    let error: string | undefined;

    try {
      // 预置初始状态：先 sample 创建 pending，再流转到 initialState
      const reviewId = await presetState(service, item);

      if (reviewId === null) {
        // presetState 失败
        results.push({
          id: item.id,
          category: 'state_machine',
          difficulty: item.difficulty,
          correct: false,
          error: '预置初始状态失败',
          expected: item.expected,
          actual: { errorCode: -1 },
        });
        continue;
      }

      // 执行动作
      try {
        let resultReview;
        switch (item.input.action) {
          case 'claim':
            resultReview = await service.claim(reviewId, item.input.lawyerId ?? 'lawyer-test');
            break;
          case 'start':
            resultReview = await service.startReview(
              reviewId,
              item.input.lawyerId ?? 'lawyer-test',
            );
            break;
          case 'submit':
            resultReview = await service.submit(reviewId, {
              scores: item.input.annotations!.scores,
              riskFlag: item.input.annotations!.riskFlag ?? 'none',
              reviewedBy: item.input.annotations!.reviewedBy ?? 'lawyer-test',
              reviewedAt: new Date(),
              duration: 1000,
            });
            break;
          case 'give_up':
            resultReview = await service.giveUp(reviewId, item.input.lawyerId ?? 'lawyer-test');
            break;
          case 'mark_reflowed':
            resultReview = await service.markReflowed(reviewId, item.input.reflowTargets ?? []);
            break;
        }
        actual = { resultState: resultReview?.state };
        // 判定：若期望 errorCode，则应抛错；若期望 resultState，则应匹配
        if (item.expected.errorCode !== undefined) {
          correct = false; // 期望抛错但未抛
        } else {
          correct = actual.resultState === item.expected.resultState;
        }
      } catch (err) {
        const code = (err as Error & { code?: number }).code;
        actual = { errorCode: code };
        if (item.expected.errorCode !== undefined) {
          correct = code === item.expected.errorCode;
        } else {
          correct = false;
          error = err instanceof Error ? err.message : String(err);
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    results.push({
      id: item.id,
      category: 'state_machine',
      difficulty: item.difficulty,
      correct,
      error,
      expected: item.expected,
      actual,
    });
  }

  const correctCount = results.filter((r) => r.correct).length;
  return { results, accuracy: results.length ? correctCount / results.length : 0 };
}

/** 预置状态：sample 创建 pending → 流转到 item.input.initialState */
async function presetState(
  service: LawyerReviewService,
  item: StateMachineEvalItem,
): Promise<string | null> {
  // sample 走 high-risk 命中（用 case_reasoning），保证 100% 入审
  const sampleResult = await service.sample({
    msgId: `preset-${item.id}`,
    userId: `preset-user-${item.id}`,
    intent: 'case_reasoning',
    userFlagged: false,
  });
  if (!sampleResult.sampled || !sampleResult.reviewId) return null;
  const reviewId = sampleResult.reviewId;
  const lawyerId = item.input.initialClaimedBy ?? 'lawyer-preset';

  // 流转到 initialState
  switch (item.input.initialState) {
    case 'pending':
      break; // sample 后已是 pending
    case 'claimed':
      await service.claim(reviewId, lawyerId);
      break;
    case 'reviewing':
      await service.claim(reviewId, lawyerId);
      await service.startReview(reviewId, lawyerId);
      break;
    case 'submitted':
      await service.claim(reviewId, lawyerId);
      await service.startReview(reviewId, lawyerId);
      await service.submit(reviewId, {
        scores: { accuracy: 4, completeness: 4, compliance: 4, usefulness: 4 },
        riskFlag: 'none',
        reviewedBy: lawyerId,
        reviewedAt: new Date(),
        duration: 1000,
      });
      break;
    case 'reflowed':
      await service.claim(reviewId, lawyerId);
      await service.startReview(reviewId, lawyerId);
      await service.submit(reviewId, {
        scores: { accuracy: 4, completeness: 4, compliance: 4, usefulness: 4 },
        riskFlag: 'none',
        reviewedBy: lawyerId,
        reviewedAt: new Date(),
        duration: 1000,
      });
      await service.markReflowed(reviewId, ['feedback']);
      break;
  }
  return reviewId;
}

// ===== 维度 3：自动评分 =====

function evalAutoScore(): { results: AutoScoreResult[]; accuracy: number; maxDelta: number } {
  const scorer = new AnswerQualityScorer();
  const results: AutoScoreResult[] = [];
  let maxDelta = 0;

  for (const item of AUTO_SCORE_EVAL_SET) {
    try {
      const r = scorer.computeAutoScore({
        answer: item.input.answer,
        trace: item.input.trace,
        hasDisclaimer: item.input.hasDisclaimer,
      });
      const delta = Math.abs(r.autoScore - item.expected.autoScore);
      if (delta > maxDelta) maxDelta = delta;
      // 误差 ≤ 0.05 视为正确
      const correct =
        delta <= 0.05 &&
        Math.abs(r.citationSuccessRate - item.expected.citationSuccessRate) <= 0.01 &&
        Math.abs(r.reasoningCompleteness - item.expected.reasoningCompleteness) <= 0.01 &&
        Math.abs(r.disclaimerCoverage - item.expected.disclaimerCoverage) <= 0.01;
      results.push({
        id: item.id,
        category: 'auto_score',
        difficulty: item.difficulty,
        correct,
        expected: { autoScore: item.expected.autoScore },
        actual: {
          autoScore: r.autoScore,
          citationSuccessRate: r.citationSuccessRate,
          reasoningCompleteness: r.reasoningCompleteness,
          disclaimerCoverage: r.disclaimerCoverage,
        },
      });
    } catch (err) {
      results.push({
        id: item.id,
        category: 'auto_score',
        difficulty: item.difficulty,
        correct: false,
        error: err instanceof Error ? err.message : String(err),
        expected: { autoScore: item.expected.autoScore },
        actual: {
          autoScore: -1,
          citationSuccessRate: -1,
          reasoningCompleteness: -1,
          disclaimerCoverage: -1,
        },
      });
    }
  }

  const correctCount = results.filter((r) => r.correct).length;
  return {
    results,
    accuracy: results.length ? correctCount / results.length : 0,
    maxDelta,
  };
}

// ===== 维度 4：律师评分 =====

function evalLawyerScore(): { results: LawyerScoreResult[]; accuracy: number; maxDelta: number } {
  const scorer = new AnswerQualityScorer();
  const results: LawyerScoreResult[] = [];
  let maxDelta = 0;

  for (const item of LAWYER_SCORE_EVAL_SET) {
    try {
      const r = scorer.computeLawyerScore({ scores: item.input.scores });
      const delta = Math.abs(r.lawyerScore - item.expected.lawyerScore);
      if (delta > maxDelta) maxDelta = delta;
      const correct = delta <= 0.05 && r.grade === item.expected.grade;
      results.push({
        id: item.id,
        category: 'lawyer_score',
        difficulty: item.difficulty,
        correct,
        expected: item.expected,
        actual: { lawyerScore: r.lawyerScore, grade: r.grade },
      });
    } catch (err) {
      results.push({
        id: item.id,
        category: 'lawyer_score',
        difficulty: item.difficulty,
        correct: false,
        error: err instanceof Error ? err.message : String(err),
        expected: item.expected,
        actual: { lawyerScore: -1, grade: 'error' },
      });
    }
  }

  const correctCount = results.filter((r) => r.correct).length;
  return {
    results,
    accuracy: results.length ? correctCount / results.length : 0,
    maxDelta,
  };
}

// ===== 维度 5：合规风险 =====

async function evalCompliance(): Promise<{ results: ComplianceResult[]; accuracy: number }> {
  const monitor = new ComplianceMonitor();
  const results: ComplianceResult[] = [];

  for (const item of COMPLIANCE_EVAL_SET) {
    try {
      const r = await monitor.scan({
        msgId: item.input.msgId,
        userId: item.input.userId,
        answer: item.input.answer,
        citationFailureRate: item.input.citationFailureRate,
        lawyerRiskFlag: item.input.lawyerRiskFlag,
        contentSafetyResult: item.input.contentSafetyResult,
      });
      const actualPaths = r.triggers.map((t) => t.path).sort();
      const expectedPaths = [...item.expected.triggerPaths].sort();
      const correct =
        r.level === item.expected.level &&
        r.blocked === item.expected.blocked &&
        JSON.stringify(actualPaths) === JSON.stringify(expectedPaths);
      results.push({
        id: item.id,
        category: 'compliance',
        difficulty: item.difficulty,
        correct,
        expected: item.expected,
        actual: {
          level: r.level,
          blocked: r.blocked,
          triggerPaths: actualPaths,
        },
      });
    } catch (err) {
      results.push({
        id: item.id,
        category: 'compliance',
        difficulty: item.difficulty,
        correct: false,
        error: err instanceof Error ? err.message : String(err),
        expected: item.expected,
        actual: { level: 'error', blocked: false, triggerPaths: [] },
      });
    }
  }

  const correctCount = results.filter((r) => r.correct).length;
  return { results, accuracy: results.length ? correctCount / results.length : 0 };
}

// ===== 维度 6：标注回流 =====

/**
 * 评测回流目标命中逻辑。
 * 由于 LawyerAnnotationService.reflow 依赖 Model（未注入时会抛错），
 * 这里评测 hasRelevantAnnotations 判定逻辑：通过访问私有方法的方式不可行，
 * 改为构造完整 reflow 调用，通过 success/skipped 字段反推判定结果。
 * Model 未注入时，命中的目标会抛错（failed），跳过的目标返回 skipped=true。
 * 因此：skipped=true 的目标 = hasRelevantAnnotations=false；
 *       skipped=false 的目标（无论 success 还是 failed）= hasRelevantAnnotations=true。
 */
async function evalReflow(): Promise<{ results: ReflowResult[]; accuracy: number }> {
  const lawyerReviewService = new LawyerReviewService();
  const annotationService = new LawyerAnnotationService(
    undefined, // evalSetModel
    undefined, // reasoningChainModel
    undefined, // lawArticleModel
    undefined, // feedbackModel
    lawyerReviewService,
  );
  const results: ReflowResult[] = [];

  const ALL_TARGETS: ReflowTarget[] = [
    'intent_eval_set',
    'reasoning_chain',
    'law_article',
    'feedback',
  ];

  for (const item of REFLOW_EVAL_SET) {
    try {
      // 先创建一个 review 供 markReflowed 调用
      const sampleResult = await lawyerReviewService.sample({
        msgId: `reflow-${item.id}`,
        userId: `reflow-user-${item.id}`,
        intent: item.input.intent,
        userFlagged: false,
      });
      const reviewId = sampleResult.reviewId!;

      const r = await annotationService.reflow(
        {
          reviewId,
          msgId: `reflow-${item.id}`,
          userId: `reflow-user-${item.id}`,
          intent: item.input.intent,
          annotations: {
            scores: item.input.annotations.scores,
            textAnnotations: item.input.annotations.textAnnotations,
            riskFlag: item.input.annotations.riskFlag ?? 'none',
            reviewedBy: item.input.annotations.reviewedBy ?? 'lawyer-test',
            reviewedAt: new Date(),
            duration: 1000,
          },
        },
        {
          reasoningChainId: item.input.reasoningChainId,
          qualityScore: 2.0,
        },
      );

      // 推断 hit/skipped：skipped=true 表示无相关标注；否则表示有相关标注（命中）
      const actualHit = r.results
        .filter((x) => !x.skipped)
        .map((x) => x.target)
        .sort();
      const actualSkipped = r.results
        .filter((x) => x.skipped)
        .map((x) => x.target)
        .sort();

      const expectedHit = [...item.expected.hitTargets].sort();
      const expectedSkipped = [...item.expected.skippedTargets].sort();

      // 校验 hit + skipped = ALL_TARGETS（覆盖性）
      const union = [...actualHit, ...actualSkipped].sort();
      const allCovered = JSON.stringify(union) === JSON.stringify([...ALL_TARGETS].sort());

      const correct =
        allCovered &&
        JSON.stringify(actualHit) === JSON.stringify(expectedHit) &&
        JSON.stringify(actualSkipped) === JSON.stringify(expectedSkipped);

      results.push({
        id: item.id,
        category: 'reflow',
        difficulty: item.difficulty,
        correct,
        expected: item.expected,
        actual: { hitTargets: actualHit, skippedTargets: actualSkipped },
      });
    } catch (err) {
      results.push({
        id: item.id,
        category: 'reflow',
        difficulty: item.difficulty,
        correct: false,
        error: err instanceof Error ? err.message : String(err),
        expected: item.expected,
        actual: { hitTargets: [], skippedTargets: [] },
      });
    }
  }

  const correctCount = results.filter((r) => r.correct).length;
  return { results, accuracy: results.length ? correctCount / results.length : 0 };
}

// ===== 主流程 =====

async function runEval(): Promise<EvalReport> {
  console.log('[eval] 开始律师审核五合一闭环评测...');

  console.log('[eval] 维度 1/6：抽样策略...');
  const sampling = await evalSampling();

  console.log('[eval] 维度 2/6：状态机流转...');
  const stateMachine = await evalStateMachine();

  console.log('[eval] 维度 3/6：自动评分算法...');
  const autoScore = evalAutoScore();

  console.log('[eval] 维度 4/6：律师评分聚合...');
  const lawyerScore = evalLawyerScore();

  console.log('[eval] 维度 5/6：合规风险扫描...');
  const compliance = await evalCompliance();

  console.log('[eval] 维度 6/6：标注回流...');
  const reflow = await evalReflow();

  const allResults: CaseResult[] = [
    ...sampling.results,
    ...stateMachine.results,
    ...autoScore.results,
    ...lawyerScore.results,
    ...compliance.results,
    ...reflow.results,
  ];

  const total = allResults.length;
  const errored = allResults.filter((r) => r.error);
  const evaluated = total - errored.length;
  const correctCount = allResults.filter((r) => r.correct).length;

  const perDimension: DimensionMetric[] = [
    {
      dimension: 'sampling',
      total: sampling.results.length,
      correct: sampling.results.filter((r) => r.correct).length,
      accuracy: sampling.accuracy,
    },
    {
      dimension: 'state_machine',
      total: stateMachine.results.length,
      correct: stateMachine.results.filter((r) => r.correct).length,
      accuracy: stateMachine.accuracy,
    },
    {
      dimension: 'auto_score',
      total: autoScore.results.length,
      correct: autoScore.results.filter((r) => r.correct).length,
      accuracy: autoScore.accuracy,
    },
    {
      dimension: 'lawyer_score',
      total: lawyerScore.results.length,
      correct: lawyerScore.results.filter((r) => r.correct).length,
      accuracy: lawyerScore.accuracy,
    },
    {
      dimension: 'compliance',
      total: compliance.results.length,
      correct: compliance.results.filter((r) => r.correct).length,
      accuracy: compliance.accuracy,
    },
    {
      dimension: 'reflow',
      total: reflow.results.length,
      correct: reflow.results.filter((r) => r.correct).length,
      accuracy: reflow.accuracy,
    },
  ];

  const misclassified = allResults.filter((r) => !r.correct);

  return {
    version: LAWYER_REVIEW_EVAL_VERSION,
    mode: 'offline-mock',
    total,
    evaluated,
    errors: errored.length,
    overallAccuracy: total > 0 ? correctCount / total : 0,
    perDimension,
    sampling: { results: sampling.results, accuracy: sampling.accuracy },
    stateMachine: { results: stateMachine.results, accuracy: stateMachine.accuracy },
    autoScore: {
      results: autoScore.results,
      accuracy: autoScore.accuracy,
      maxDelta: autoScore.maxDelta,
    },
    lawyerScore: {
      results: lawyerScore.results,
      accuracy: lawyerScore.accuracy,
      maxDelta: lawyerScore.maxDelta,
    },
    compliance: { results: compliance.results, accuracy: compliance.accuracy },
    reflow: { results: reflow.results, accuracy: reflow.accuracy },
    misclassified,
    generatedAt: new Date().toISOString(),
  };
}

function printSummary(report: EvalReport): void {
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  console.log('');
  console.log('==================== 律师审核评测报告（离线 / Mock）====================');
  console.log(`版本: v${report.version}  模式: ${report.mode}  生成时间: ${report.generatedAt}`);
  console.log(`总数: ${report.total}  评测: ${report.evaluated}  异常: ${report.errors}`);
  console.log(`总体准确率: ${pct(report.overallAccuracy)}`);
  console.log('');
  console.log('---- 各维度准确率 ----');
  console.log(
    'dimension'.padEnd(20) + 'total'.padStart(8) + 'correct'.padStart(10) + 'accuracy'.padStart(12),
  );
  for (const m of report.perDimension) {
    console.log(
      m.dimension.padEnd(20) +
        String(m.total).padStart(8) +
        String(m.correct).padStart(10) +
        pct(m.accuracy).padStart(12),
    );
  }
  console.log('');
  console.log(`自动评分最大误差: ${report.autoScore.maxDelta.toFixed(4)}`);
  console.log(`律师评分最大误差: ${report.lawyerScore.maxDelta.toFixed(4)}`);
  console.log('');
  console.log(`---- 错例清单（共 ${report.misclassified.length} 条）----`);
  for (const r of report.misclassified.slice(0, 30)) {
    let detail = '';
    switch (r.category) {
      case 'sampling':
        detail = `期望 sampled=${r.expected.sampled} risk=${r.expected.riskLevel} / 实际 sampled=${r.actual.sampled} risk=${r.actual.riskLevel}`;
        break;
      case 'state_machine':
        detail = `期望 ${JSON.stringify(r.expected)} / 实际 ${JSON.stringify(r.actual)}`;
        break;
      case 'auto_score':
        detail = `期望 ${r.expected.autoScore} / 实际 ${r.actual.autoScore}`;
        break;
      case 'lawyer_score':
        detail = `期望 ${r.expected.lawyerScore}/${r.expected.grade} / 实际 ${r.actual.lawyerScore}/${r.actual.grade}`;
        break;
      case 'compliance':
        detail = `期望 ${r.expected.level}/${r.expected.triggerPaths.join(',')} / 实际 ${r.actual.level}/${r.actual.triggerPaths.join(',')}`;
        break;
      case 'reflow':
        detail = `期望 hit=[${r.expected.hitTargets.join(',')}] skip=[${r.expected.skippedTargets.join(',')}] / 实际 hit=[${r.actual.hitTargets.join(',')}] skip=[${r.actual.skippedTargets.join(',')}]`;
        break;
    }
    console.log(
      `  [${r.id}/${r.category}/${r.difficulty}] ${detail}${r.error ? ` ERR: ${r.error}` : ''}`,
    );
  }
  if (report.misclassified.length > 30) {
    console.log(`  ... 其余 ${report.misclassified.length - 30} 条见 JSON 报告`);
  }
  console.log('==========================================================================');
}

async function main(): Promise<void> {
  const report = await runEval();
  printSummary(report);

  const outPath = resolve(process.cwd(), 'reports', 'lawyer-review-eval-report.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`[eval] JSON 报告已写入: ${outPath}`);

  // 阈值（17 §十 验收）：
  //   - sampling / state_machine / compliance ≥ 0.95
  //   - auto_score / lawyer_score ≥ 0.90（允许 0.05 误差）
  //   - reflow ≥ 0.90
  //   - 总体 ≥ 0.93
  const THRESHOLDS = {
    sampling: 0.95,
    state_machine: 0.95,
    auto_score: 0.9,
    lawyer_score: 0.9,
    compliance: 0.95,
    reflow: 0.9,
    overall: 0.93,
  };
  const fmtPct = (n: number) => `${(n * 100).toFixed(2)}%`;

  const failed: string[] = [];
  if (report.sampling.accuracy < THRESHOLDS.sampling) {
    failed.push(`sampling ${fmtPct(report.sampling.accuracy)} < ${fmtPct(THRESHOLDS.sampling)}`);
  }
  if (report.stateMachine.accuracy < THRESHOLDS.state_machine) {
    failed.push(
      `state_machine ${fmtPct(report.stateMachine.accuracy)} < ${fmtPct(THRESHOLDS.state_machine)}`,
    );
  }
  if (report.autoScore.accuracy < THRESHOLDS.auto_score) {
    failed.push(
      `auto_score ${fmtPct(report.autoScore.accuracy)} < ${fmtPct(THRESHOLDS.auto_score)}`,
    );
  }
  if (report.lawyerScore.accuracy < THRESHOLDS.lawyer_score) {
    failed.push(
      `lawyer_score ${fmtPct(report.lawyerScore.accuracy)} < ${fmtPct(THRESHOLDS.lawyer_score)}`,
    );
  }
  if (report.compliance.accuracy < THRESHOLDS.compliance) {
    failed.push(
      `compliance ${fmtPct(report.compliance.accuracy)} < ${fmtPct(THRESHOLDS.compliance)}`,
    );
  }
  if (report.reflow.accuracy < THRESHOLDS.reflow) {
    failed.push(`reflow ${fmtPct(report.reflow.accuracy)} < ${fmtPct(THRESHOLDS.reflow)}`);
  }
  if (report.overallAccuracy < THRESHOLDS.overall) {
    failed.push(`overall ${fmtPct(report.overallAccuracy)} < ${fmtPct(THRESHOLDS.overall)}`);
  }

  if (failed.length > 0) {
    console.error(`[eval] 评测未通过，以下维度未达阈值：`);
    for (const f of failed) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`[eval] 评测通过（总体阈值 ${fmtPct(THRESHOLDS.overall)}）`);
}

// 引用 REVIEW_ERROR_CODES 避免未使用告警
void REVIEW_ERROR_CODES;
// 引用 AnswerTracer 保留以备扩展
void AnswerTracer;

main().catch((err) => {
  console.error('[eval] 律师审核评测执行失败:', err);
  process.exit(1);
});
