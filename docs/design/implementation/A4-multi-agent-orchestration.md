# A4 · 多 Agent 协作（OrchestratorAgent + 12 Agent）

> 阶段：A4（后端业务补齐第四步） | 对应 v2.3 路线图阶段六 | 前置依赖：A1（IntentRouter、平台横切）、A2（RagService、KnowledgeBase）、A3（DocumentGenerator、LlmService、JobService）
> 技术栈：NestJS Provider + AgentRegistry 单例 + OrchestratorAgent 编排
> 目标：把 A1-A3 的 L4 能力层模块包装为 12 个专业 Agent，由 OrchestratorAgent 按意图统一编排（单/并行/串行），建立 Agent 层降级、审计、PII 边界机制，为 A5 对外暴露打好基础。

---

## 一、范围与目标

| 范围 | 说明 |
|------|------|
| LegalAgent 接口 + AgentCard | 统一 Agent 契约（inputSchema/outputSchema/piiLevel/exposure/async/timeout） |
| AgentRegistry | 按 capability / agentId 发现 Agent（进程级单例） |
| OrchestratorAgent | 意图分类 -> 编排计划 -> 调度 Agent -> 聚合 -> 注入免责/法条校验 |
| 12 Agent 包装层 | 8 核心 Agent 完整实现 + 4 个 v2.3 Agent 桩（nlu/reasoning/lawyer-review/tool 子层） |
| JobService 扩展 | 异步任务完整实现（jobId/进度/回调） |
| Agent 降级与审计 | fallbackAgentId + 4 级降级链 + agent_invoke 审计 |

**不在 A4 范围**：IRAC 推理完整实现（v2.3 阶段九）、律师审核闭环（v2.3 阶段十）、8 LegalTool 完整实现（v2.3 阶段七）、对外 MCP/OpenAPI（A5）。

---

## 二、前置依赖

- A1：IntentRouter（意图分类）、MemoryManager、PiiService、AuditLog、CacheService
- A2：RagService、KnowledgeBase、EmbeddingService
- A3：LlmService（含 PromptRegistry/CircuitBreaker）、DocumentGenerator、ExportService、JobService 雏形
- agent_registry / agent_invocation_log / agent_job 集合（05 文档 3.14-3.17）

---

## 三、LegalAgent 接口与 AgentCard

### 3.1 LegalAgent 接口

```typescript
// src/modules/legal/agents/types.ts
interface LegalAgent {
  readonly card: AgentCard;
  invoke(input: AgentInvokeInput, ctx: AgentContext): Promise<AgentInvokeOutput>;
}

interface AgentInvokeInput {
  capability: string;            // 调用的能力（如 'law.lookup'）
  params: Record<string, any>;   // 入参（须符合 inputSchema）
  piiLevel: PiiLevel;            // 入参 PII 级别
  jobId?: string;                // 异步任务时携带
}

interface AgentInvokeOutput {
  ok: boolean;
  data: Record<string, any>;     // 按 outputSchema
  lawRefs: LawRef[];
  disclaimer: string;
  verified: boolean;
  jobId?: string;                // 异步任务返回
  usage: { durationMs: number; tokensIn: number; tokensOut: number; cacheHit?: string };
  errorCode?: number;
  errorMessage?: string;
}

interface AgentContext {
  traceId: string;
  callerAgentId?: string;        // 外部调用形如 'external:<agentKey>'
  callerUserId: string;
  externalAgentKey?: string;
  deadline: number;              // 截止时间戳
  lang: 'zh' | 'en';
}
```

### 3.2 AgentCard（能力声明，权威字段）

```typescript
interface AgentCard {
  agentId: string;               // 'law-lookup'
  name: string;
  description: string;
  version: string;               // 语义化版本 '1.0.0'
  capabilities: string[];        // ['law.lookup']
  inputSchema: object;           // JSONSchema
  outputSchema: object;          // JSONSchema（强制含 disclaimer/lawRefs/traceId）
  piiLevel: PiiLevel;            // L1-L4，声明可接受最高 PII
  exposure: 'L-Read' | 'L-Write-Limited' | 'L-Internal';
  async: boolean;                // 是否异步长任务
  timeout: number;               // 默认超时 ms
  fallbackAgentId?: string;      // 降级目标
}
```

**强制约束**：outputSchema 必含 disclaimer + lawRefs + traceId；缺失则网关出口注入兜底免责并告警。

---

## 四、AgentRegistry（注册与发现）

```typescript
// src/modules/legal/agents/registry.ts
class AgentRegistry {
  register(agent: LegalAgent): void;
  lookup(capability: string): LegalAgent;        // 一个 capability 仅一个主 agent
  get(agentId: string): LegalAgent;
  listCards(filter?: { exposure?: string }): AgentCard[];   // 暴露给 MCP tools/list 与 /v1/agents
}
```

- 进程级单例，NestJS 启动时（onModuleInit）注册全部 12 个内部 Agent
- 一个 capability 仅一个主 agent（避免歧义）
- listCards 按 exposure 过滤（外部 agent 只见 L-Read / L-Write-Limited）
---

## 五、12 个 Agent 清单

### 5.1 8 核心 Agent（A4 完整实现）

| # | agentId | capability | 职责 | 依赖模块 | exposure | async | fallback |
|---|---------|-----------|------|---------|----------|-------|----------|
| 1 | law-lookup | law.lookup | 法条精确查询 | RuleEngine, KnowledgeBase | L-Read | 否 | legal-qa |
| 2 | legal-qa | legal.qa | 法律 FAQ/术语问答 | RuleEngine, KnowledgeBase | L-Read | 否 | — |
| 3 | case-search | case.search | 案例语义召回 | RagService | L-Read | 否 | — |
| 4 | process-guide | process.guide / material.checklist | 流程指引+材料清单 | KnowledgeBase | L-Read | 否 | — |
| 5 | document | document.generate / document.export | 文书生成与导出 | DocumentGenerator, ExportService | L-Write-Limited | 是 | — |
| 6 | case-analysis | case.analyze | 案例分析（RAG+LLM+法条校验） | RagService, LlmService | L-Write-Limited | 是 | — |
| 7 | memory | memory.read / memory.write | 会话/长期记忆读写 | MemoryManager | L-Internal | 否 | — |
| 8 | orchestrator | orchestrate | 意图分类+编排调度 | IntentRouter, AgentRegistry | L-Internal | 否 | — |

### 5.2 4 个 v2.3 Agent（A4 桩实现，完整逻辑后续阶段）

| # | agentId | capability | A4 状态 | 完整实现阶段 |
|---|---------|-----------|---------|-------------|
| 9 | tool | tool.period_calculator 等 8 项 | 桩（注册 card + NotImplemented） | v2.3 阶段七 |
| 10 | nlu | nlu.extract / nlu.clarify | 桩 | v2.3 阶段八 |
| 11 | reasoning | case.reason / case.compare / law.apply_check | 桩 | v2.3 阶段九 |
| 12 | lawyer-review | review.lawyer / review.score / review.compliance | 桩（L-Internal 不对外） | v2.3 阶段十 |

### 5.3 横切注入

- 所有 Agent 通用注入：PiiService、AuditLog、Logger
- 写操作类额外注入：ContentSafety、JobService
- 涉法条类额外注入：LlmService.validateLawRefs

### 5.4 Agent 实现示例

```typescript
// src/modules/legal/agents/law-lookup.agent.ts
@Injectable()
class LawLookupAgent implements LegalAgent {
  readonly card: AgentCard = {
    agentId: 'law-lookup', name: '法条查询', version: '1.0.0',
    capabilities: ['law.lookup'], inputSchema: {...}, outputSchema: {...},
    piiLevel: 'L1', exposure: 'L-Read', async: false, timeout: 5000,
    fallbackAgentId: 'legal-qa',
  };

  async invoke(input: AgentInvokeInput, ctx: AgentContext): Promise<AgentInvokeOutput> {
    // 1. PII 边界校验
    this.pii.assertBoundary(input.piiLevel, this.card.piiLevel);
    // 2. 调 RuleEngine / KnowledgeBase
    const result = await this.ruleEngine.query(input.params.keyword);
    // 3. 注入免责 + 法条校验
    // 4. 写审计 agent_invoke
    return { ok: true, data: result, lawRefs: result.lawRefs, disclaimer: DISCLAIMER, verified: true, usage: {...} };
  }
}
```

---

## 六、OrchestratorAgent（编排核心）

### 6.1 编排流程

```typescript
@Injectable()
class OrchestratorAgent implements LegalAgent {
  async invoke(input: AgentInvokeInput, ctx: AgentContext): Promise<AgentInvokeOutput> {
    // 1. IntentRouter.classify 判定意图
    const intentResult = await this.intentRouter.classify(input.params.message, dialogCtx);
    // 2. 查 PLAN_BY_INTENT 编排计划
    const plan = PLAN_BY_INTENT[intentResult.intent];
    // 3. 执行编排（单/并行/串行）
    const aggregated = await this.executePlan(plan, input, ctx);
    // 4. 注入免责 + 法条兜底校验
    // 5. 写审计 agent_invoke
    return aggregated;
  }
}
```

### 6.2 意图 -> 编排计划映射（7 个）

| IntentType | 编排计划 | 模式 |
|-----------|---------|------|
| legal_qa | law-lookup -> legal-qa（命中即返） | 串行短路 |
| document_generate | law-lookup // process-guide -> document | 并行取上下文 + 串行生成（异步） |
| process_guide | process-guide | 单 agent |
| case_analysis | case-search // law-lookup -> case-analysis | 并行召回 + 串行分析（异步） |
| case_reasoning | nlu -> case-search // law-lookup -> reasoning | 前置 NLU + 并行召回 + 串行 IRAC（异步） |
| material_checklist | process-guide(material.checklist) | 单 agent |
| general_qa | legal-qa -> case-analysis(fallback) | 串行 |

### 6.3 编排模式实现

```typescript
// 单 agent
async single(agent, input, ctx) { return agent.invoke(input, ctx); }

// 并行（Promise.allSettled + 聚合）
async parallel(agents: {agent, input}[], ctx): Promise<Record<string, AgentInvokeOutput>> {
  const results = await Promise.allSettled(agents.map(a => a.agent.invoke(a.input, ctx)));
  return aggregate(results);  // 部分失败不阻断，降级处理
}

// 串行（前序输出作为后序输入）
async serial(agents: {agent, deriveInput}[], input, ctx): Promise<AgentInvokeOutput> {
  let current = input;
  for (const step of agents) {
    const result = await step.agent.invoke(step.deriveInput(current), ctx);
    current = mergeResult(current, result);
  }
  return current;
}
```

### 6.4 降级机制（4 级，来自 02 第 4.4 节）

| 故障 | 降级策略 | 错误码 | 审计 |
|------|---------|--------|------|
| 子 agent 超时 | 走 fallbackAgentId（如 law-lookup -> legal-qa） | 7003 | agent_degradation |
| 关键 agent 全失败 | Orchestrator 降级到单体路径（直调 RuleEngine/KnowledgeBase） | 5001 | agent_degradation + degradation |
| Orchestrator 自身故障 | ChatController fallback 到 v2.0 单体编排（保留兼容） | 5001 | degradation |
| 外部 agent 不可达 | 返回 7003 + 建议本地能力替代 | 7003 | agent_degradation |

- 单 agent 错误率 > 30%（5 分钟）触发该 agent 降级（非全局熔断）
- 降级事件写 audit_log(event=agent_degradation)，字段 agentId / fallbackAgentId / reason
- v2.0 单体降级链（A1 的 rule -> knowledge -> llm -> 人工引导）保留为最终兜底
---

## 七、JobService 扩展（异步任务）

A3 已建雏形，A4 扩展为完整异步任务机制：

```typescript
class JobService {
  async create(capability: string, agentId: string, params: object, ctx: AgentContext): Promise<{ jobId: string }>;
  async getStatus(jobId: string): Promise<JobStatus>;
  async update(jobId: string, update: Partial<JobStatus>): Promise<void>;
  async subscribe(jobId: string, webhook?: string): Promise<void>;  // 回调通知
}

interface JobStatus {
  jobId: string; capability: string; agentId: string;
  callerAgentId?: string; callerUserId: string;
  params: object;               // L4 加密
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;             // 0-1
  result?: any; resultFileId?: string;
  errorCode?: number; errorMessage?: string;
  expireAt: Date;               // TTL 3 天
}
```

- 异步 agent：document、case-analysis、reasoning、lawyer-review
- 3 种调用形态：同进程直调（默认）/ 跨 Agent 调用 / 异步任务（agent_job 集合）
- 客户端轮询 GET /v1/jobs/{jobId}；A5 扩展 MCP notifications/progress 推送

---

## 八、Agent 间通信与边界

### 8.1 上下文传递（无共享 memory 模式）

- Agent 间通过**函数调用参数传递**，不共享内存状态
- 并行阶段：编排器用 deriveParams(cap, input) + nluContext 派生各 agent 入参
- 串行阶段：用 mergeParallel(parallelResults) 聚合后向下游传递
- AgentContext 携带 traceId / callerAgentId / callerUserId / externalAgentKey / deadline / lang
- 独立 memory Agent 提供 memory.read / memory.write，编排器可选注入历史记忆

### 8.2 PII 边界控制

- AgentCard.piiLevel（L1-L4）：声明该 agent 输入可接受的最高 PII 级别
- AgentInvokeInput.piiLevel：调用方声明输入 PII 级别
- 边界校验：外部 agent 调用 piiLevel >= L4 直接拒绝（错误码 7004）
- exposure 层级：
  - L-Read：对外只读（law-lookup、legal-qa、case-search、process-guide、tool）
  - L-Write-Limited：对外受限写（document、case-analysis、reasoning）
  - L-Internal：仅编排器可调（memory、orchestrator、nlu、lawyer-review）

### 8.3 超时与熔断

- 每个 Agent 在 AgentCard.timeout 声明默认超时（ms），如 law-lookup 5000ms
- AgentContext.deadline 截止时间戳，供下游 agent 判断剩余预算
- 通过超时 + fallbackAgentId + 4 级降级链实现等价熔断能力

---

## 九、涉及集合（A4 新增/扩展）

| 集合 | A4 变更 |
|------|---------|
| agent_registry | 新建，12 Agent 的 AgentCard 注册（agentId/capabilities/inputSchema/outputSchema/piiLevel/exposure/status） |
| agent_invocation_log | 新建，跨 agent 调用快查（traceId/callerAgentId/targetAgentId/capability/result/durationMs，TTL 30 天） |
| agent_job | A3 雏形 -> A4 完整（status/progress/回调，TTL 3 天） |
| audit_log | 复用 A1，新增 agent_invoke / agent_degradation 事件 |
| system_status | 复用 A1，单 agent 熔断状态 |

---

## 十、验收标准

| # | 标准 | 验证方式 |
|---|------|---------|
| 1 | 12 Agent 注册 AgentRegistry（8 完整 + 4 桩） | 启动日志 + listCards |
| 2 | OrchestratorAgent 7 IntentType 编排全覆盖 | 编排评测（7×10=70 用例） |
| 3 | 单/并行/串行三种编排模式正确 | 集成测试 |
| 4 | 串行短路：legal_qa 命中 law-lookup 即返 | 集成测试 |
| 5 | 子 agent 超时 -> fallbackAgentId 降级（7003） | 故障注入 |
| 6 | 关键 agent 全失败 -> 单体路径降级（5001） | 故障注入 |
| 7 | Orchestrator 故障 -> v2.0 单体兼容路径 | 故障注入 |
| 8 | PII 边界：外部 L4 输入被拒（7004） | 安全测试 |
| 9 | outputSchema 缺 disclaimer -> 网关注入兜底 | 集成测试 |
| 10 | agent_invoke 审计 100% 写入 | 数据库验证 |
| 11 | 异步任务 jobId 全流程 < 60s（POST -> 轮询 -> GET） | 性能测试 |
| 12 | AgentContext.deadline 正确传播 | 单测 |
| 13 | 4 桩 Agent 返回 NotImplemented 但 card 注册正确 | 集成测试 |

---

## 十一、风险与对策

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| 编排计划设计错误导致死循环 | 低 | 高 | 串行模式无环 + deadline 强制超时 + 单测 |
| 并行 agent 部分失败处理 | 中 | 中 | Promise.allSettled + 部分降级 + 审计 |
| Agent 调用链过深延迟累积 | 中 | 中 | deadline 传播 + 超时熔断 + 并行化 |
| PII 跨 agent 泄漏 | 低 | 极高 | piiLevel 边界校验 + 出口脱敏 + 7004 拦截 + 审计 |
| 桩 Agent 误调用 | 低 | 中 | NotImplemented 明确错误 + exposure 过滤 |
| 单 agent 故障传染 | 中 | 中 | 熔断隔离 + fallback + 降级链 |

---

## 十二、交付物清单

- LegalAgent 接口 + AgentCard 类型定义（agents/types.ts）
- AgentRegistry（agents/registry.ts，进程级单例）
- OrchestratorAgent（agents/orchestrator.ts，7 IntentType 编排）
- 8 核心 Agent 实现（law-lookup/legal-qa/case-search/process-guide/document/case-analysis/memory/orchestrator）
- 4 桩 Agent（tool/nlu/reasoning/lawyer-review，card 注册 + NotImplemented）
- JobService 完整实现（异步任务 + 状态 + 回调）
- Agent 降级 4 级链 + 审计
- agent_registry / agent_invocation_log / agent_job schema
- 编排评测脚本 + 70 用例（7 IntentType × 10）

**预计工期**：4 周（与 v2.3 阶段六一致，纯后端编排，不含外部 agent 接入）。
