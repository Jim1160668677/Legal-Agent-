/**
 * LegalAgent 接口与 AgentCard 类型契约（A4-W1，A4 §三）。
 *
 * 权威源：docs/design/implementation/A4-multi-agent-orchestration.md §三。
 *
 * 设计要点：
 *   - AgentCard 为能力声明权威字段（agentId/capabilities/inputSchema/outputSchema/piiLevel/exposure/async/timeout/fallbackAgentId）
 *   - outputSchema 强制含 disclaimer + lawRefs + traceId；缺失由网关出口注入兜底（A4 验收 #9）
 *   - PiiLevel 复用 PiiService 定义（L1-L4），确保单一真相源
 *   - LawRef 复用 types/llm.ts，避免类型重复
 *   - AgentContext 携带 traceId / callerAgentId / callerUserId / deadline / lang，无共享 memory（A4 §8.1）
 *
 * 设计依据：A4 §三；11-multi-agent-architecture.md；13-agent-governance.md。
 */
import type { PiiLevel } from '../../platform/pii/pii.service';
import type { LawRef } from '../../../types/llm';

// ===== 暴露层级（A4 §8.2）=====

/**
 * Agent 暴露层级：
 *   - L-Read：对外只读（law-lookup / legal-qa / case-search / process-guide / tool）
 *   - L-Write-Limited：对外受限写（document / case-analysis / reasoning）
 *   - L-Internal：仅编排器可调（memory / orchestrator / nlu / lawyer-review）
 */
export type AgentExposure = 'L-Read' | 'L-Write-Limited' | 'L-Internal';

// ===== AgentCard（能力声明，A4 §3.2）=====

/**
 * Agent 能力声明卡片。
 *
 * 权威字段：NestJS 启动时注册到 AgentRegistry，对外暴露给 MCP tools/list 与 /v1/agents。
 *
 * 强制约束：
 *   - outputSchema 必含 disclaimer + lawRefs + traceId 字段
 *   - piiLevel 声明该 agent 输入可接受的最高 PII 级别
 *   - timeout 为默认超时（ms），AgentContext.deadline 截止时间戳供下游判断剩余预算
 */
export interface AgentCard {
  /** Agent ID（如 'law-lookup'），全局唯一 */
  agentId: string;
  /** 展示名（中文） */
  name: string;
  /** 描述 */
  description: string;
  /** 语义化版本 '1.0.0' */
  version: string;
  /** 能力列表（如 ['law.lookup']），一个 capability 仅一个主 agent */
  capabilities: string[];
  /** 入参 JSONSchema */
  inputSchema: object;
  /** 出参 JSONSchema（强制含 disclaimer / lawRefs / traceId） */
  outputSchema: object;
  /** 可接受最高 PII 级别 */
  piiLevel: PiiLevel;
  /** 暴露层级 */
  exposure: AgentExposure;
  /** 是否异步长任务（document / case-analysis / reasoning / lawyer-review） */
  async: boolean;
  /** 默认超时（ms） */
  timeout: number;
  /** 降级目标 agentId（超时/失败时切换，A4 §6.4） */
  fallbackAgentId?: string;
}

// ===== 调用入参 / 出参 / 上下文（A4 §3.1）=====

/** Agent 调用入参 */
export interface AgentInvokeInput {
  /** 调用的能力（如 'law.lookup'） */
  capability: string;
  /** 入参（须符合 AgentCard.inputSchema） */
  params: Record<string, unknown>;
  /** 入参 PII 级别（由调用方声明） */
  piiLevel: PiiLevel;
  /** 异步任务时携带的 jobId */
  jobId?: string;
}

/** Agent 调用出参 */
export interface AgentInvokeOutput {
  /** 是否成功 */
  ok: boolean;
  /** 出参（按 AgentCard.outputSchema） */
  data: Record<string, unknown>;
  /** 法条引用列表 */
  lawRefs: LawRef[];
  /** 免责声明（强制非空，A4 验收 #9） */
  disclaimer: string;
  /** 法条是否已核实（A2 接 law_article 后为 true） */
  verified: boolean;
  /** 异步任务返回的 jobId */
  jobId?: string;
  /** 用量统计 */
  usage: AgentUsage;
  /** 错误码（失败时） */
  errorCode?: number;
  /** 错误消息（失败时） */
  errorMessage?: string;
}

/** Agent 用量统计 */
export interface AgentUsage {
  /** 执行耗时（ms） */
  durationMs: number;
  /** 输入 token 数（LLM 类 agent 填充） */
  tokensIn: number;
  /** 输出 token 数（LLM 类 agent 填充） */
  tokensOut: number;
  /** 缓存命中标记（如 'L3:agnes-2.0-flash'） */
  cacheHit?: string;
}

/** Agent 调用上下文（无共享 memory 模式，A4 §8.1） */
export interface AgentContext {
  /** 请求级追踪 ID（贯穿日志/审计） */
  traceId: string;
  /** 调用方 agentId（外部调用形如 'external:<agentKey>'） */
  callerAgentId?: string;
  /** 调用方用户 ID */
  callerUserId: string;
  /** 外部 agent 标识（MCP/OpenAPI 入口） */
  externalAgentKey?: string;
  /** 截止时间戳（ms），供下游 agent 判断剩余预算 */
  deadline: number;
  /** 语言 */
  lang: 'zh' | 'en';
}

// ===== LegalAgent 接口（A4 §3.1）=====

/**
 * LegalAgent 统一契约。
 *
 * 所有 12 个 Agent（8 核心 + 4 桩）实现此接口，
 * 由 AgentRegistry 注册发现，OrchestratorAgent 按意图编排调度。
 */
export interface LegalAgent {
  /** 能力声明卡片（只读） */
  readonly card: AgentCard;
  /**
   * 调用 Agent。
   * @param input 调用入参（capability + params + piiLevel）
   * @param ctx 调用上下文（traceId + callerUserId + deadline）
   * @returns 调用出参（ok + data + lawRefs + disclaimer + usage）
   */
  invoke(input: AgentInvokeInput, ctx: AgentContext): Promise<AgentInvokeOutput>;
}

// ===== 错误码（A4 §6.4 + 06-api-spec）=====

/** Agent 调用错误码 */
export const AGENT_ERROR_CODES = {
  /** 7003：子 agent 超时/失败，已走 fallbackAgentId 降级 */
  AGENT_DEGRADED: 7003,
  /** 7004：PII 边界违规（外部 agent 调用 piiLevel >= L4 被拒） */
  PII_BOUNDARY_VIOLATION: 7004,
  /** 7005：Agent 未实现（桩 agent 被调用） */
  NOT_IMPLEMENTED: 7005,
  /** 7006：Agent 不存在（capability/agentId 未注册） */
  AGENT_NOT_FOUND: 7006,
  /** 5001：关键 agent 全失败，降级到单体路径 */
  CRITICAL_DEGRADATION: 5001,
} as const;

/** Agent 执行状态（用于审计） */
export type AgentInvokeStatus = 'success' | 'degraded' | 'failed' | 'blocked';

/** 编排模式（A4 §6.3） */
export type OrchestrationMode = 'single' | 'parallel' | 'serial';

/**
 * 编排计划步骤。
 * - single/parallel 模式：agents 为并行执行的 agent 列表
 * - serial 模式：agents 按顺序执行，前序输出作为后序输入
 */
export interface PlanStep {
  /** 步骤名 */
  name: string;
  /** 执行模式 */
  mode: OrchestrationMode;
  /** 参与的 agentId 列表 */
  agentIds: string[];
  /** 是否短路退出（如 legal_qa 命中 law-lookup 即返） */
  shortCircuit?: boolean;
}

/** 编排计划（IntentType → 步骤序列） */
export interface OrchestrationPlan {
  /** 对应的 IntentType */
  intent: string;
  /** 步骤序列 */
  steps: PlanStep[];
  /** 是否异步（document/case-analysis/reasoning 为 true） */
  async: boolean;
}
