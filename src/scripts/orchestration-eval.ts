/**
 * 编排评测脚本（A4-W4，A4 §十 验收 #2：7×10=70 用例）。
 *
 * 用途：基于 src/data/orchestrationEvalSet.ts（70 条金标）评测 OrchestratorAgent
 *       在【离线 mock】模式下的编排正确性，验证 7 IntentType 编排全覆盖。
 *
 * 离线 mock 模式说明：
 *   - 构造内存版 AgentRegistry，注册 8 核心 Agent + 4 桩 Agent 的 mock 实现
 *   - 核心 Agent：返回固定成功结果（验证编排调度正确性，不验证业务逻辑）
 *   - 桩 Agent：返回 NOT_IMPLEMENTED 7005（验证降级路径）
 *   - IntentRouterService 不注入 LLM，走纯关键词+正则打分基线
 *
 * 指标：
 *   - 意图识别准确率（编排正确的前提）
 *   - 编排计划命中率（是否走了正确的 plan）
 *   - 编排模式准确率（single/parallel+serial/serial）
 *   - 调用 agent 列表准确率（应被调用的 agent 是否都调用了）
 *   - 短路触发准确率
 *   - 降级触发率（case_reasoning 涉及桩 agent 应触发降级）
 *
 * 运行：npm run eval:orchestration
 * 输出：reports/orchestration-eval-report.json + 控制台摘要
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { IntentRouterService } from '../modules/legal/intent/intent-router.service';
import { AgentRegistry } from '../modules/legal/agents/registry';
import { OrchestratorAgent } from '../modules/legal/agents/orchestrator.agent';
import type {
  AgentCard,
  AgentContext,
  AgentInvokeInput,
  AgentInvokeOutput,
  LegalAgent,
} from '../modules/legal/agents/types';
import { AGENT_ERROR_CODES } from '../modules/legal/agents/types';
import { DISCLAIMER_TEXT } from '../modules/legal/chat/sse-frames';
import {
  ORCHESTRATION_EVAL_SET,
  ORCHESTRATION_EVAL_VERSION,
  type OrchestrationEvalItem,
} from '../data/orchestrationEvalSet';
import type { IntentType } from '../types/intent';

// ===== Mock Agent 构造 =====

/** 构造 mock LegalAgent：所有 capability 调用返回固定成功结果 */
function makeMockAgent(
  agentId: string,
  capabilities: string[],
  overrides: Partial<AgentCard> = {},
): LegalAgent {
  const card: AgentCard = {
    agentId,
    name: agentId,
    description: `mock ${agentId}`,
    version: '1.0.0',
    capabilities,
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    piiLevel: 'L1',
    exposure: 'L-Read',
    async: false,
    timeout: 5_000,
    ...overrides,
  };
  return {
    card,
    invoke: async (input: AgentInvokeInput, _ctx: AgentContext): Promise<AgentInvokeOutput> => {
      // 记录调用（用于评测 agent 是否被调用）
      mockCallLog.push({ agentId, capability: input.capability });
      return {
        ok: true,
        data: { agentId, capability: input.capability, mockResult: true },
        lawRefs: [],
        disclaimer: DISCLAIMER_TEXT,
        verified: false,
        usage: { durationMs: 5, tokensIn: 10, tokensOut: 20 },
      };
    },
  };
}

/** 构造 mock 桩 Agent：返回 NOT_IMPLEMENTED 7005 */
function makeMockStubAgent(
  agentId: string,
  capabilities: string[],
  overrides: Partial<AgentCard> = {},
): LegalAgent {
  const card: AgentCard = {
    agentId,
    name: agentId,
    description: `mock stub ${agentId}`,
    version: '0.1.0',
    capabilities,
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    piiLevel: 'L1',
    exposure: 'L-Internal',
    async: false,
    timeout: 5_000,
    ...overrides,
  };
  return {
    card,
    invoke: async (input: AgentInvokeInput, _ctx: AgentContext): Promise<AgentInvokeOutput> => {
      mockCallLog.push({ agentId, capability: input.capability });
      return {
        ok: false,
        data: {},
        lawRefs: [],
        disclaimer: DISCLAIMER_TEXT,
        verified: false,
        usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
        errorCode: AGENT_ERROR_CODES.NOT_IMPLEMENTED,
        errorMessage: `Agent ${agentId} 未实现（mock stub）`,
      };
    },
  };
}

/** 调用日志：每次 mock agent.invoke 都记录 */
const mockCallLog: Array<{ agentId: string; capability: string }> = [];

/** 构造完整 mock AgentRegistry（8 核心 + 4 桩） */
function buildMockRegistry(): AgentRegistry {
  const registry = new AgentRegistry();
  // 8 核心 Agent
  registry.register(makeMockAgent('law-lookup', ['law.lookup'], { fallbackAgentId: 'legal-qa' }));
  registry.register(makeMockAgent('legal-qa', ['legal.qa']));
  registry.register(makeMockAgent('case-search', ['case.search']));
  registry.register(makeMockAgent('process-guide', ['process.guide', 'material.checklist']));
  registry.register(
    makeMockAgent('document', ['document.generate', 'document.export'], { async: true }),
  );
  registry.register(makeMockAgent('case-analysis', ['case.analyze'], { async: true }));
  registry.register(makeMockAgent('memory', ['memory.read', 'memory.write']));
  // 4 桩 Agent
  registry.register(
    makeMockStubAgent('tool', [
      'tool.period_calculator',
      'tool.document_review',
      'tool.compensation_query',
      'tool.license_ocr',
      'tool.law_validity',
      'tool.cause_classification',
      'tool.sentencing_guide',
      'tool.clause_recommender',
    ]),
  );
  registry.register(makeMockStubAgent('nlu', ['nlu.extract', 'nlu.clarify']));
  registry.register(
    makeMockStubAgent('reasoning', ['case.reason', 'case.compare', 'law.apply_check'], {
      async: true,
    }),
  );
  registry.register(
    makeMockStubAgent('lawyer-review', ['review.lawyer', 'review.score', 'review.compliance'], {
      async: true,
    }),
  );
  return registry;
}

// ===== 评测逻辑 =====

interface CaseResult {
  item: OrchestrationEvalItem;
  predictedIntent: IntentType | null;
  predictedPlan: string | null;
  invokedAgents: string[];
  intentCorrect: boolean;
  planCorrect: boolean;
  modeCorrect: boolean;
  agentsCorrect: boolean;
  shortCircuitCorrect: boolean;
  degraded: boolean;
  error?: string;
}

interface IntentMetric {
  intent: string;
  total: number;
  intentCorrect: number;
  planCorrect: number;
  agentsCorrect: number;
  intentAccuracy: number;
  planAccuracy: number;
  agentsAccuracy: number;
}

interface EvalReport {
  version: number;
  mode: 'offline-mock';
  total: number;
  evaluated: number;
  errors: number;
  intentAccuracy: number;
  planAccuracy: number;
  modeAccuracy: number;
  agentsAccuracy: number;
  shortCircuitAccuracy: number;
  degradedCount: number;
  perIntent: IntentMetric[];
  misclassified: CaseResult[];
  generatedAt: string;
}

function makeCtx(): AgentContext {
  return {
    traceId: `eval-orch-${Date.now()}`,
    callerUserId: 'eval-user',
    deadline: Date.now() + 30_000,
    lang: 'zh',
  };
}

async function runEval(): Promise<EvalReport> {
  const registry = buildMockRegistry();
  // IntentRouterService 不注入 LLM（离线模式）
  const router = new IntentRouterService();
  const orchestrator = new OrchestratorAgent(registry, router, undefined, undefined, undefined);

  const results: CaseResult[] = [];

  for (const item of ORCHESTRATION_EVAL_SET) {
    // 重置调用日志
    mockCallLog.length = 0;

    try {
      const input: AgentInvokeInput = {
        capability: 'orchestrate',
        params: { message: item.text },
        piiLevel: 'L1',
      };
      const output = await orchestrator.invoke(input, makeCtx());

      const predictedIntent = (output.data.intent as IntentType) ?? null;
      const predictedPlan = (output.data.plan as string) ?? null;
      const invokedAgents = Array.from(new Set(mockCallLog.map((c) => c.agentId)));

      const intentCorrect = predictedIntent === item.expectedIntent;
      const planCorrect = predictedPlan === item.expectedPlan;
      // 验证所有期望 agent 都被调用（不区分顺序，只看集合）
      const invokedSet = new Set(invokedAgents);
      const agentsCorrect = item.expectedAgents.every((a) => invokedSet.has(a));
      // case_reasoning 涉及 nlu/reasoning 桩 agent，invokedAgents 可能不全（降级跳过）
      // 此时 agentsCorrect 应当为 false，但 degraded 应当为 true
      const degraded = output.ok === false || (output.errorCode ?? 0) >= 5000;

      // 模式准确率：通过 plan 推断（plan 正确则模式正确）
      const modeCorrect = planCorrect;

      // 短路准确率：legal_qa 期望短路，且 law-lookup 命中后不应调用 legal-qa
      let shortCircuitCorrect = true;
      if (item.expectedShortCircuit && item.expectedIntent === 'legal_qa') {
        // legal_qa: law-lookup 命中 → 不调 legal-qa
        // mock law-lookup 总是返回 ok=true，所以 legal-qa 不应被调用
        shortCircuitCorrect = !invokedSet.has('legal-qa');
      }

      results.push({
        item,
        predictedIntent,
        predictedPlan,
        invokedAgents,
        intentCorrect,
        planCorrect,
        modeCorrect,
        agentsCorrect,
        shortCircuitCorrect,
        degraded,
      });
    } catch (err) {
      results.push({
        item,
        predictedIntent: null,
        predictedPlan: null,
        invokedAgents: [],
        intentCorrect: false,
        planCorrect: false,
        modeCorrect: false,
        agentsCorrect: false,
        shortCircuitCorrect: false,
        degraded: true,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ===== 汇总指标 =====
  const total = results.length;
  const evaluated = results.filter((r) => !r.error).length;
  const errors = results.filter((r) => r.error).length;
  const intentCorrectCount = results.filter((r) => r.intentCorrect).length;
  const planCorrectCount = results.filter((r) => r.planCorrect).length;
  const modeCorrectCount = results.filter((r) => r.modeCorrect).length;
  const agentsCorrectCount = results.filter((r) => r.agentsCorrect).length;
  const shortCircuitCorrectCount = results.filter((r) => r.shortCircuitCorrect).length;
  const degradedCount = results.filter((r) => r.degraded).length;

  // 按意图分组
  const intentGroups = new Map<string, CaseResult[]>();
  for (const r of results) {
    const key = r.item.expectedIntent;
    if (!intentGroups.has(key)) intentGroups.set(key, []);
    intentGroups.get(key)!.push(r);
  }

  const perIntent: IntentMetric[] = [];
  for (const [intent, group] of intentGroups) {
    const t = group.length;
    const ic = group.filter((r) => r.intentCorrect).length;
    const pc = group.filter((r) => r.planCorrect).length;
    const ac = group.filter((r) => r.agentsCorrect).length;
    perIntent.push({
      intent,
      total: t,
      intentCorrect: ic,
      planCorrect: pc,
      agentsCorrect: ac,
      intentAccuracy: t > 0 ? ic / t : 0,
      planAccuracy: t > 0 ? pc / t : 0,
      agentsAccuracy: t > 0 ? ac / t : 0,
    });
  }

  // 错例清单
  const misclassified = results.filter(
    (r) => !r.intentCorrect || !r.planCorrect || !r.agentsCorrect,
  );

  return {
    version: ORCHESTRATION_EVAL_VERSION,
    mode: 'offline-mock',
    total,
    evaluated,
    errors,
    intentAccuracy: total > 0 ? intentCorrectCount / total : 0,
    planAccuracy: total > 0 ? planCorrectCount / total : 0,
    modeAccuracy: total > 0 ? modeCorrectCount / total : 0,
    agentsAccuracy: total > 0 ? agentsCorrectCount / total : 0,
    shortCircuitAccuracy: total > 0 ? shortCircuitCorrectCount / total : 0,
    degradedCount,
    perIntent: perIntent.sort((a, b) => a.intent.localeCompare(b.intent)),
    misclassified,
    generatedAt: new Date().toISOString(),
  };
}

function printSummary(report: EvalReport): void {
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  console.log('==================== 编排评测报告（离线 / Mock）====================');
  console.log(`版本: v${report.version}  模式: ${report.mode}  生成时间: ${report.generatedAt}`);
  console.log(`总数: ${report.total}  评测: ${report.evaluated}  异常: ${report.errors}`);
  console.log('');
  console.log('---- 总体指标 ----');
  console.log(`  意图识别准确率:   ${pct(report.intentAccuracy)}`);
  console.log(`  编排计划命中率:   ${pct(report.planAccuracy)}`);
  console.log(`  编排模式准确率:   ${pct(report.modeAccuracy)}`);
  console.log(`  Agent 调用准确率: ${pct(report.agentsAccuracy)}`);
  console.log(`  短路触发准确率:   ${pct(report.shortCircuitAccuracy)}`);
  console.log(`  降级触发次数:     ${report.degradedCount}`);
  console.log('');
  console.log('---- 各意图分组 ----');
  console.log(
    'intent'.padEnd(20) +
      'total'.padStart(8) +
      'intent'.padStart(10) +
      'plan'.padStart(10) +
      'agents'.padStart(10),
  );
  for (const m of report.perIntent) {
    console.log(
      m.intent.padEnd(20) +
        String(m.total).padStart(8) +
        pct(m.intentAccuracy).padStart(10) +
        pct(m.planAccuracy).padStart(10) +
        pct(m.agentsAccuracy).padStart(10),
    );
  }
  console.log('');
  console.log(`---- 错例清单（共 ${report.misclassified.length} 条）----`);
  for (const r of report.misclassified.slice(0, 30)) {
    const reasons: string[] = [];
    if (!r.intentCorrect) reasons.push(`意图期望${r.item.expectedIntent}实际${r.predictedIntent}`);
    if (!r.planCorrect) reasons.push(`计划期望${r.item.expectedPlan}实际${r.predictedPlan}`);
    if (!r.agentsCorrect)
      reasons.push(
        `agent期望[${r.item.expectedAgents.join(',')}]实际[${r.invokedAgents.join(',')}]`,
      );
    console.log(
      `  [${r.item.id}/${r.item.difficulty}] "${r.item.text.slice(0, 24)}" → ${reasons.join(' / ')}`,
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

  const outPath = resolve(process.cwd(), 'reports', 'orchestration-eval-report.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`[eval] JSON 报告已写入: ${outPath}`);

  // 阈值：编排计划命中率 >= 0.85（A4 §十 验收 #2）
  const THRESHOLD = 0.85;
  if (report.planAccuracy < THRESHOLD) {
    console.error(
      `[eval] 编排计划命中率 ${report.planAccuracy.toFixed(4)} 低于阈值 ${THRESHOLD}，评测未通过`,
    );
    process.exit(1);
  }
  console.log(`[eval] 编排评测通过（阈值 ${THRESHOLD}）`);
}

main().catch((err) => {
  console.error('[eval] 编排评测执行失败:', err);
  process.exit(1);
});
