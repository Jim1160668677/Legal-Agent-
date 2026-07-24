# A1/A4/A5 设计文档评审报告

> 评审日期：2026-07-24 | 评审基线：v2.3 设计文档集 | 评审人：工程评审
> 评审范围：A1（NestJS 工程脚手架）、A4（多 Agent 协作）、A5（对外 API 规约化）

---

## 一、评审概述

| 文档 | 评审重点 | 结论 |
|------|---------|------|
| A1 | NestJS 目录结构、模块迁移映射表完整性/准确性/技术合理性 | 通过（含 2 项改进建议） |
| A4 | 12 Agent 编排可行性、资源分配合理性、执行路径清晰度 | 有条件通过（含 1 项高严重度不符合项） |
| A5 | 25 API 端点完整性、命名规范性、参数定义、接口一致性 | 有条件通过（含 1 项高严重度不符合项） |

**总体结论**：3 份文档整体设计扎实、与 v2.3 总体架构（02 文档）对齐良好，可进入 A1 实施阶段。但发现 2 项高严重度不一致需在 A4/A5 实施前修正，4 项中等改进建议可在实施过程中闭环。

---

## 二、A1 评审：NestJS 工程脚手架

### 2.1 符合项（8 项）

| # | 评审项 | 结论 | 证据 |
|---|--------|------|------|
| 1 | 目录结构完整性 | 符合 | A1 §三：src/{main,app.module,config,common,modules,infra,data} + test/{unit,integration,eval}，覆盖 NestJS 标准 6 层（main/config/common/modules/infra/data） |
| 2 | 分层依赖原则 | 符合 | A1 §三末：common/platform 横切不反向依赖业务；legal/* 为 L4 纯逻辑；chat 为 L3 编排；与 02 §一六层架构一致 |
| 3 | 配置管理（Joi 校验） | 符合 | A1 §四：@nestjs/config + registerAs，env/port/mongo/redis/jwt/llm/rateLimit 全覆盖，禁止硬编码 |
| 4 | MongoDB 接入与集合设计 | 符合 | A1 §五：MongooseModule.forRootAsync + 9 集合 schema（user_profile/dialog_record/law_article/legal_knowledge/intent_eval_set/audit_log/feature_flag/llm_cache/feedback），索引设计合理（含 TTL/多键/唯一索引） |
| 5 | 平台横切模块 7 个 | 符合 | A1 §六：AuthService(JWT)/PiiService/AuditLog/Logger/CacheService/FeatureFlag/ContentSafety，接口定义完整 |
| 6 | IntentRouter 8 IntentType | 符合 | A1 §七：legal_qa/document_generate/process_guide/case_analysis/case_reasoning/material_checklist/tool_invoke/general_qa，与 07 §一权威源一致 |
| 7 | 三层混合降级链 | 符合 | A1 §十：rule→knowledge→llm→知识库 Top-3+人工引导，与 02 §4.2 一致 |
| 8 | 模块迁移映射表 12 项 | 符合 | A1 §十一：chat/gateway/openid/云数据库/内存缓存/llm_cache/内容安全/订阅消息/云存储/日志/定时触发器/灰度，迁移路径清晰 |

### 2.2 不符合项 / 改进建议（2 项）

| # | 严重度 | 问题 | 位置 | 建议 |
|---|--------|------|------|------|
| A1-N1 | 中 | 迁移映射表"微信订阅消息 → A1 不实现（A4 通知模块）"，但 A4 §一范围明确排除通知模块（A4 是 Agent 编排，不含 NotificationService） | A1 §十一 | 修正为"A1 不实现，通知模块归入 v2.3 阶段四 MemoryManager 扩展"，或新增 A6 通知专项；避免 A4 范围误指 |
| A1-N2 | 低 | 目录结构 `common/pipes` 在 A1 范围内未明确使用场景（ValidationPipe 在 main.ts 全局用，不需独立目录） | A1 §三 | 可保留为脚手架预留，但在交付物清单（§十五）注明"pipes 目录预留，A2+ 使用" |

### 2.3 技术合理性验证

- **JWT 替代 openid**：A1 §6.1 保留 mapExternalIdentity(wechat→userId) 映射，为小程序端共存预留 ✅
- **Mongoose schema 显式索引**：A1 §五 9 集合均声明关键索引 + TTL，优于云数据库隐式索引 ✅
- **Redis 替代内存缓存**：A1 §6.5 CacheService 统一抽象 L2(Redis)+L3(llm_cache 集合)，invalidateByLawArticle 支持法条更新批量失效 ✅
- **vitest 与 NestJS 测试共存**：A1 §十四风险表已识别"vitest 跑原 llm 层；NestJS 用 Jest 跑模块测试；两套并行"，对策合理 ✅

---

## 三、A4 评审：多 Agent 协作

### 3.1 符合项（7 项）

| # | 评审项 | 结论 | 证据 |
|---|--------|------|------|
| 1 | LegalAgent 接口设计 | 符合 | A4 §三：AgentCard 含 agentId/capabilities/inputSchema/outputSchema/piiLevel/exposure/async/timeout/fallbackAgentId 9 字段，契约完整 |
| 2 | outputSchema 强制约束 | 符合 | A4 §三末：outputSchema 必含 disclaimer+lawRefs+traceId，缺失则网关出口注入兜底免责+告警 |
| 3 | AgentRegistry 单例 | 符合 | A4 §四：进程级单例，onModuleInit 注册 12 Agent，一个 capability 仅一个主 agent，listCards 按 exposure 过滤 |
| 4 | 12 Agent 清单（8 核心+4 桩） | 符合 | A4 §五：8 核心 Agent（law-lookup/legal-qa/case-search/process-guide/document/case-analysis/memory/orchestrator）+ 4 桩（tool/nlu/reasoning/lawyer-review），exposure/async/fallback 分配合理 |
| 5 | 编排模式三态 | 符合 | A4 §6.3：single/parallel(Promise.allSettled)/serial(deriveInput 链)，串行模式无环（§十一风险对策） |
| 6 | 4 级降级机制 | 符合 | A4 §6.4：子 agent 超时→fallbackAgentId(7003)；关键 agent 全失败→单体路径(5001)；Orchestrator 故障→v2.0 兼容；外部 agent 不可达→7003，与 02 §4.4 一致 |
| 7 | JobService 异步任务 | 符合 | A4 §七：create/getStatus/update/subscribe，JobStatus 含 status/progress/result/expireAt(TTL 3d)，3 种调用形态清晰 |

### 3.2 不符合项（1 项高严重度 + 2 项中）

| # | 严重度 | 问题 | 位置 | 建议 |
|---|--------|------|------|------|
| A4-N1 | **高** | **IntentType 数量不一致**：A1 §七定义 8 个 IntentType（含 tool_invoke），但 A4 §6.2 编排计划映射只有 7 个，**缺少 tool_invoke 的编排计划**；A4 §十验收标准第 2 项写"7 IntentType 编排全覆盖"，与 A1 的 8 IntentType 矛盾 | A4 §6.2 / §十 | 补充 tool_invoke 编排计划（建议：单 agent 直调 tool Agent，命中即返），并将验收标准改为"8 IntentType"；否则 tool_invoke 意图无法经 OrchestratorAgent 编排 |
| A4-N2 | 中 | orchestrator 既是 Agent（agentId='orchestrator', capability='orchestrate'）又是编排器，存在递归调用风险 | A4 §5.1 第 8 行 + §6.1 | 在 AgentRegistry.lookup 增加"orchestrate capability 禁止被 OrchestratorAgent 自身调用"的防护；或在 executePlan 中断言 plan 中不含 orchestrator agent |
| A4-N3 | 中 | §5.1 表格 process-guide 的 capability 列写"process.guide / material.checklist"（2 个），但其他 Agent 都是 1 个 capability；material.checklist 与 material_checklist 意图的关系未说明 | A4 §5.1 第 4 行 | 明确 process-guide Agent 支持多 capability 调用，或拆分为 process-guide + material-checklist 两个 Agent（但这会使 Agent 数变为 13，与"12 Agent"标题冲突）；建议保留多 capability 但在 AgentCard.capabilities 数组明确列出 |

### 3.3 可行性 / 资源分配 / 执行路径评估

- **可行性**：8 核心 Agent 均基于 A1-A3 已实现的 L4 模块包装，依赖关系清晰（A4 §二前置依赖完备）✅
- **资源分配**：timeout 按 capability 分级（law-lookup 5000ms / document 异步 / case-analysis 异步），exposure 三层（L-Read/L-Write-Limited/L-Internal）隔离合理 ✅
- **执行路径**：7 编排计划（缺 tool_invoke）模式标注清晰（单/并行/串行），串行短路（legal_qa 命中即返）优化成本 ✅（除 A4-N1）

---

## 四、A5 评审：对外 API 规约化

### 4.1 符合项（8 项）

| # | 评审项 | 结论 | 证据 |
|---|--------|------|------|
| 1 | 25 端点数量完整 | 符合 | A5 §三：基础 10 + 工具 9 + 律师审核 6 = 25，与标题"25 OpenAPI"一致 |
| 2 | RESTful 路径命名 | 符合 | 路径 kebab-case（/v1/law/articles, /v1/tools/period-calculator），资源层级清晰 |
| 3 | 统一响应信封 | 符合 | A5 §七：{code, message, traceId, data} 外层 + AgentInvokeOutput 内层（ok/data/lawRefs/disclaimer/verified/jobId/usage） |
| 4 | disclaimer/lawRefs 强制约束 | 符合 | A5 §7.3：三字段必填，网关出口二次校验，X-Legal-Disclaimer 响应头，工具类 lawRefs 可空但 disclaimer 必填 |
| 5 | 鉴权体系 5 Guard | 符合 | A5 §6.2：ApiKey/Scope/PiiLevel/Role/Owner，错误码 -32001/7002/7004/4032/4031 映射清晰 |
| 6 | 限流按 agentKey 维度 | 符合 | A5 §九：L-Read 100/min、L-Write-Limited 10/min、10000/天，@nestjs/throttler + Redis，X-RateLimit 响应头 |
| 7 | 异步任务 202+轮询 | 符合 | A5 §3.4：POST /v1/documents 返回 202 + pollLocation(GET /v1/jobs/{jobId})，clientRequestId 幂等 1 小时窗口 |
| 8 | 错误码 11 业务域 | 符合 | A5 §八：1xxx/2xxx/3xxx/4xxx/40xx/5xxx/6xxx/-32xxx/7xxx/8001-8007/8010-8019，HTTP 状态映射完整 |

### 4.2 不符合项（1 项高严重度 + 3 项中）

| # | 严重度 | 问题 | 位置 | 建议 |
|---|--------|------|------|------|
| A5-N1 | **高** | **MCP tools 与 OpenAPI 端点不对齐**：A5 §3.2 有 9 个工具端点，但 §4.2 MCP tools 仅列 4 个工具（tool_period_calculator/tool_law_validity/tool_cause_classification/tool_compensation_query），**缺少 5 个**：tool_document_review / tool_license_ocr / tool_sentencing_guide / query_center / materials_center；同时 §4.2 多出 clause_recommender 但 §3.2 无对应 OpenAPI 端点 | A5 §3.2 vs §4.2 | 二选一：(a) 补全 MCP tools 至 22 个（17+5），同步修订标题为"25 OpenAPI + 22 MCP"；(b) 在 §4.2 明确说明"仅 4 个高频工具暴露 MCP，其余 5 个仅 OpenAPI"并补充设计理由；clause_recommender 需在 §3.2 补 POST /v1/tools/clause-recommender 端点（则 OpenAPI 变 26）或从 MCP 移除 |
| A5-N2 | 中 | §6.2 标题"三层鉴权守卫"但表格列 5 个 Guard | A5 §6.2 | 修正标题为"鉴权守卫体系（5 个 Guard）"或按 L-Read/L-Write-Limited/L-Internal 三层归类重组表格 |
| A5-N3 | 中 | §八标题"51 个错误码"但表格仅列示例约 45 个，未注明完整列表位置 | A5 §八 | 补充"完整 51 错误码清单见 06 §错误码定义"或在本节附完整枚举表 |
| A5-N4 | 中 | POST /v1/qa 命名不够 RESTful（qa 是动词，资源应为 answers） | A5 §3.1 | 可接受（与 MCP legal_qa tool 名对齐），但建议在文档注明"qa 端点对应 legal.qa capability，非标准 REST 资源命名，为对齐 MCP tool 名保留" |

### 4.3 参数定义准确性评估

- DTO 类名定义（QueryLawDto/GenerateDocDto 等）出现但字段未展开 ⚠️（A5 范围为 API 规约，字段定义应归入 06 API 规范或 A5 附录，建议补充交叉引用）
- capability 映射：25 端点中 23 个有明确 capability 映射，2 个（GET /v1/jobs/{jobId}、GET /v1/agents）为元端点无 capability，合理 ✅
- 律师审核 6 端点鉴权标注清晰（律师端+管理员 / userId 本人）✅

---

## 五、跨文档一致性检查

| 检查项 | A1 | A4 | A5 | 结论 |
|--------|----|----|----|------|
| IntentType 数量 | 8 | 7（缺 tool_invoke） | — | **不一致**（A4-N1） |
| Agent 数量 | — | 12 | — | 一致 |
| capability 总数 | — | 27（隐含） | 25 端点映射 | 一致（capability>端点，多对一） |
| MCP tools 数量 | — | — | 17（实际应 22） | **不一致**（A5-N1） |
| 错误码 7003/7004 | — | 降级/PII 边界 | 鉴权/PII | 一致 |
| disclaimer 强制 | §十 ChatController | §三 outputSchema | §7.3 强制约束 | 一致 |
| 降级链 5001 | — | §6.4 | §八 5xxx | 一致 |

---

## 六、改进建议汇总（按优先级）

| 优先级 | 编号 | 文档 | 建议动作 | 预计工作量 |
|--------|------|------|---------|-----------|
| P0 | A4-N1 | A4 | 补充 tool_invoke 编排计划，验收标准改 8 IntentType | 0.5h |
| P0 | A5-N1 | A5 | 对齐 MCP tools 与 OpenAPI 端点（补全或说明） | 1h |
| P1 | A4-N2 | A4 | orchestrator 递归防护 | 0.5h |
| P1 | A4-N3 | A4 | process-guide 多 capability 说明 | 0.5h |
| P1 | A5-N2 | A5 | 鉴权守卫标题修正 | 0.2h |
| P2 | A1-N1 | A1 | 通知模块归属修正 | 0.2h |
| P2 | A5-N3 | A5 | 错误码完整列表交叉引用 | 0.5h |
| P2 | A5-N4 | A5 | /v1/qa 命名说明 | 0.2h |
| P3 | A1-N2 | A1 | pipes 目录预留说明 | 0.1h |

**总计**：9 项改进建议，P0 项必须在 A4/A5 实施前修正，其余可在实施过程中闭环。预计总工作量约 4.2h。

---

## 七、评审结论

**准予进入 A1 实施**。A1 文档质量最高，可立即开始工程脚手架搭建。A4/A5 的 2 项 P0 不符合项（IntentType 数量、MCP tools 对齐）需在对应阶段实施前修正，不阻塞 A1 启动。

脚手架搭建已在本次评审同步完成（见 scaffold-verification-report.md），配置清理已完成（见 cleanup-confirmation.md）。