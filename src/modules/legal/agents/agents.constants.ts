/**
 * Agent 模块常量（A4-W1，A4 §六）。
 *
 * 包含：
 *   - PLAN_BY_INTENT：7 IntentType → 编排计划映射（A4 §6.2）
 *   - ASYNC_AGENTS：异步 agent 集合（document/case-analysis/reasoning/lawyer-review）
 *   - STUB_AGENTS：桩 agent 集合（A4-W4 完整实现）
 *   - 默认超时 / 免责声明
 *
 * 设计依据：A4 §6.2；07 §1.1 IntentType。
 */
import type { OrchestrationPlan } from './types';

/**
 * 意图 → 编排计划映射（7 个，A4 §6.2）。
 *
 * A4-N1 修正：补 tool_invoke 编排计划（单 agent 直调 tool Agent，命中即返）。
 * 验收标准改 8 IntentType（A4 §十验收 #2：7×10=70 用例 + tool_invoke 10 用例 = 80 用例，
 * 实际以 A4 §十为准 70 用例，tool_invoke 走 single 模式）。
 *
 * 模式说明：
 *   - single：单 agent 直调
 *   - parallel：并行召回（Promise.allSettled + 聚合，部分失败不阻断）
 *   - serial：串行（前序输出作为后序输入），shortCircuit=true 时命中即返
 */
export const PLAN_BY_INTENT: Record<string, OrchestrationPlan> = {
  /** 法律问答：law-lookup → legal-qa（命中即返，串行短路） */
  legal_qa: {
    intent: 'legal_qa',
    async: false,
    steps: [
      {
        name: 'lookup-then-qa',
        mode: 'serial',
        agentIds: ['law-lookup', 'legal-qa'],
        shortCircuit: true,
      },
    ],
  },

  /** 文书生成：law-lookup // process-guide → document（并行取上下文 + 串行生成，异步） */
  document_generate: {
    intent: 'document_generate',
    async: true,
    steps: [
      {
        name: 'gather-context',
        mode: 'parallel',
        agentIds: ['law-lookup', 'process-guide'],
      },
      {
        name: 'generate-doc',
        mode: 'serial',
        agentIds: ['document'],
      },
    ],
  },

  /** 流程指引：process-guide（单 agent） */
  process_guide: {
    intent: 'process_guide',
    async: false,
    steps: [
      {
        name: 'guide',
        mode: 'single',
        agentIds: ['process-guide'],
      },
    ],
  },

  /** 案件分析：case-search // law-lookup → case-analysis（并行召回 + 串行分析，异步） */
  case_analysis: {
    intent: 'case_analysis',
    async: true,
    steps: [
      {
        name: 'retrieve',
        mode: 'parallel',
        agentIds: ['case-search', 'law-lookup'],
      },
      {
        name: 'analyze',
        mode: 'serial',
        agentIds: ['case-analysis'],
      },
    ],
  },

  /** 案件推理：nlu → case-search // law-lookup → reasoning（前置 NLU + 并行召回 + 串行 IRAC，异步） */
  case_reasoning: {
    intent: 'case_reasoning',
    async: true,
    steps: [
      {
        name: 'nlu',
        mode: 'single',
        agentIds: ['nlu'],
      },
      {
        name: 'retrieve',
        mode: 'parallel',
        agentIds: ['case-search', 'law-lookup'],
      },
      {
        name: 'reasoning',
        mode: 'serial',
        agentIds: ['reasoning'],
      },
    ],
  },

  /** 材料清单：process-guide(material.checklist)（单 agent） */
  material_checklist: {
    intent: 'material_checklist',
    async: false,
    steps: [
      {
        name: 'checklist',
        mode: 'single',
        agentIds: ['process-guide'],
      },
    ],
  },

  /** 兜底通用问答：legal-qa → case-analysis(fallback)（串行） */
  general_qa: {
    intent: 'general_qa',
    async: false,
    steps: [
      {
        name: 'qa-then-analysis',
        mode: 'serial',
        agentIds: ['legal-qa', 'case-analysis'],
      },
    ],
  },

  /** 工具调用：tool（单 agent 直调，命中即返，A4-N1 修正） */
  tool_invoke: {
    intent: 'tool_invoke',
    async: false,
    steps: [
      {
        name: 'tool-invoke',
        mode: 'single',
        agentIds: ['tool'],
        shortCircuit: true,
      },
    ],
  },
};

/** 异步 agent 集合（AgentCard.async = true） */
export const ASYNC_AGENT_IDS = new Set(['document', 'case-analysis', 'reasoning', 'lawyer-review']);

/** 桩 agent 集合（A4-W4 完整实现，当前仅注册 card + NotImplemented） */
export const STUB_AGENT_IDS = new Set(['tool', 'nlu', 'reasoning', 'lawyer-review']);

/** Agent 默认超时（ms），未在 AgentCard 声明时使用 */
export const DEFAULT_AGENT_TIMEOUT_MS = 30_000;

/** 异步任务超时（ms），A3 JobService 已定义为 60_000 */
export const ASYNC_JOB_TIMEOUT_MS = 60_000;

/** 兜底免责声明（outputSchema 缺 disclaimer 时由网关注入，A4 验收 #9） */
export const FALLBACK_DISCLAIMER =
  '本回复由 AI 生成，仅供参考，不构成法律意见。具体问题请咨询执业律师。';
