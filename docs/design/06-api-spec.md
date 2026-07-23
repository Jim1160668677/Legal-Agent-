# 06 · 接口定义

> 版本：v2.3 | 日期：2026-07-22 | 状态：设计扩展（v2.3 新增 6 OpenAPI 端点 + 10 错误码 8010-8019 + 5 MCP tools）
> 影响范围：04 / 05 / 07 / 08 / 09 / 11 / 12 / 13 / 14 / 15 / 16 / 17
> 本文为接口契约与错误码权威源；模块实现、前端调用、外部 agent 接入以此为准。

---

## 一、总则

- 部署形态：微信云开发云函数；客户端通过 `wx.cloud.callFunction` 调用。
- 鉴权：网关层校验 openid（云开发上下文自带），映射为 `userId`；管理员 API 额外校验 `admin_user` 角色。
- 请求格式：`{ data: <Payload> }`（云函数 event 约定）；本文 `请求` 段即 `Payload`。
- 响应格式：统一外层

```jsonc
{
  "code": 0,                 // 0 成功；非 0 见错误码表
  "message": "ok",
  "traceId": "uuid",
  "data": { ... }            // 业务数据，可为 null
}
```

- 流式：`chat` 与 `generateDocument` 支持流式，通过云函数 SSE 代理（分片返回，详见 7.4）。
- 幂等：写操作支持 `requestId`（客户端生成 UUID），同 `requestId` 1 小时内重复请求直接返回首次结果。
- 限流：见 02 第四节；超限返回 `4291`。

## 二、错误码表

| code | HTTP 类比 | 含义 | 触发示例 |
|------|----------|------|----------|
| 0 | 200 | 成功 | — |
| 1001 | 400 | 参数缺失/非法 | 必填字段为空 |
| 1002 | 400 | 文件类型不允许 | 上传 .exe |
| 1003 | 400 | 文件超限 | > 10MB |
| 2001 | 404 | 资源不存在 | 案件/文书/模板找不到 |
| 3001 | 422 | 模板变量校验失败 | 必填变量未填 |
| 3002 | 422 | 文书渲染失败 | 模板语法错误 |
| 4001 | 422 | 意图识别失败 | 无法判定且 fallback 也失败 |
| 4002 | 422 | 法条引用校验未通过 | LLM 引用了不存在的法条 |
| 4011 | 401 | 未登录/会话失效 | openid 解析失败 |
| 4031 | 403 | 越权访问 | 访问他人案件 |
| 4032 | 403 | 无操作权限 | 非运营角色调用 admin API |
| 4291 | 429 | 限流 | 配额超限 |
| 5001 | 500 | 服务内部错误 | 未捕获异常 |
| 5002 | 502 | LLM 上游错误 | 通义千问 5xx |
| 5003 | 503 | LLM 降级中 | 熔断状态 |
| 5004 | 504 | LLM 超时 | > 30s |
| 6001 | 422 | OCR 失败 | 识别异常 |
| 6002 | 422 | 内容安全拦截 | 输入命中违规词 |
| -32700 | — | JSON-RPC parse error | MCP 请求体非法 JSON |
| -32600 | 400 | JSON-RPC invalid request | MCP 请求不符合协议 |
| -32601 | 404 | JSON-RPC method not found | MCP method 未实现 |
| -32602 | 400 | JSON-RPC invalid params | MCP 参数不符合 schema |
| -32603 | 500 | JSON-RPC internal error | MCP 内部异常 |
| -32001 | 401 | 未授权 / API Key 无效 | 外部 agent 凭证缺失/失效/吊销 |
| -32002 | 429 | MCP 限流 | 外部 agent 调用配额超限 |
| 7001 | 404 | agent 不存在 | agentId 未注册或已下线 |
| 7002 | 403 | capability 未授权 | 凭证 scope 不含该 capability |
| 7003 | 504 | agent 超时 | 子 agent 调用超时，已降级 |
| 7004 | 422 | PII 边界违规 | 外部 agent 输入含 L4 敏感信息 |
| 7005 | 422 | 内容安全拦截（agent） | 外部 agent 输入/输出命中违规 |
| 7006 | 422 | 法条引用校验失败 | LLM 输出引用法条未核实，已降级标注 |
| 8001（v2.2） | 400 | 工具入参非法 | 工具 inputSchema 校验失败 |
| 8002（v2.2） | 404 | 工具不存在 | toolId 未在 ToolRegistry 注册 |
| 8003（v2.2） | 422 | 工具执行失败 | 业务异常（日期越界/模板渲染失败等） |
| 8004（v2.2） | 404 | 证照 OCR 识别失败 | 图像无证照/质量过低/类型无法判断 |
| 8005（v2.2） | 404 | 法条效力查询无结果 | law_article 未命中 |
| 8006（v2.2） | 422 | 案由分类置信度过低 | LLM + 关键词匹配置信度 < 0.5，建议转 general_qa |
| 8007（v2.2） | 422 | 量刑指导情节要素不足 | 必填情节要素（如数额/次数）未提供 |
| 8008（v2.2） | 429 | 采集任务并发超限 | 单批并发 > 10，排队等待 |
| 8009（v2.2） | 503 | 采集源不可达 | 重试 3 次仍失败 |
| 8010（v2.3） | 500 | 实体抽取失败 | LLM NER 不可用，降级为仅正则+词典；warnings 提示 |
| 8011（v2.3） | 408 | 澄清会话超时 | 用户 3 轮未补齐必填字段，会话终止 |
| 8012（v2.3） | 403 | 敏感操作二次校验失败 | 文书删除/导出/案件归档前生物识别或短信校验未通过 |
| 8013（v2.3） | 422 | 合规风险拦截 | AI 回答合规风险评分 block 级，拦截展示 |
| 8014（v2.3） | 404 | 律师审核任务不存在 | lawyer_review._id 未命中 |
| 8015（v2.3） | 409 | 律师审核任务已被领取 | 任务 status=claimed，其他律师不可重复领取 |
| 8016（v2.3） | 422 | 律师标注字段不合法 | 四维评分越界（非 1-5）或必填字段缺失 |
| 8017（v2.3） | 404 | 溯源信息不存在 | answer_traceability.msgId 未命中 |
| 8018（v2.3） | 422 | 文书版本冲突 | 并发修订导致 parentVersionId 不匹配 |
| 8019（v2.3） | 422 | 法条适用判定要件不足 | 构成要件抽取失败且无降级路径 |

错误响应：`{ "code": 4291, "message": "请求过于频繁，请稍后再试", "traceId": "...", "data": null }`。

**v2.3 错误码使用约定**：
- `80xx` 系列由 v2.3 NLU/推理/文书/安全/律师审核 5 大方向引入，与现有 `1xxx`–`8xxx`（v2.2 及以前）不冲突。
- **NLU 类错误**（8010-8011）：经 nlu Agent 返回，chat 云函数透传，前端展示 ClarificationCard 降级或自由文本输入。
- **安全合规类错误**（8012-8013）：经 OrchestratorAgent 敏感操作钩子与 ComplianceMonitor 返回，block 级拦截并审计 `compliance_blocked`。
- **律师审核类错误**（8014-8016）：经 `/v1/lawyer-reviews/*` 端点返回，仅律师端可见。
- **溯源类错误**（8017）：经 `/v1/answers/{msgId}/trace` 端点返回。
- **文书/推理类错误**（8018-8019）：经 document Agent / reasoning Agent 返回，warnings 提示或降级为 partial。

**v2.1 错误码使用约定**：
- `-32xxx` 与 `7xxx` 系列由 v2.1 多 agent 协作后端引入，与现有 `1xxx`–`6xxx` 不冲突。
- **MCP 端点**：使用 JSON-RPC 整型 `code` 字段（如 `-32001`、`7002`），错误对象 `{ code, message, data: { traceId } }`，详见 12 第 3.6 节。
- **OpenAPI 端点**：沿用本节统一外层 `{ code, message, traceId, data }`，`code` 字段填相同码值（如 `7002`），HTTP 状态码按 12 第 4.4 节映射（`4xx → HTTP 4xx`，`5xx → HTTP 5xx`）。
- **内部云函数 API**（chat/generateDocument 等）：继续使用 `1xxx`–`6xxx`，不引入 `-32xxx`/`7xxx`。

**v2.2 错误码使用约定**：
- `8xxx` 系列由 v2.2 工具域与采集域引入，与现有 `1xxx`–`7xxx` 不冲突。
- **工具类错误**（8001-8007）：经 invokeTool 云函数或 `/v1/tools/*` 端点返回，沿用本节统一外层。
- **采集类错误**（8008-8009）：经 knowledgePipeline 云函数（admin）返回，仅运营后台可见。
- **MCP 工具调用**：`8xxx` 错误码同时出现在 JSON-RPC `code` 字段（如 `8003`），详见 12 第 3.6 节。

## 三、Agent.invoke 统一接口契约（v2.1）

> v2.1 多 agent 协作的核心抽象。本文给出调用入口与外层封装；Agent 接口、AgentCard、Capability 枚举的权威定义见 11。

### 3.1 接口定义

```typescript
// 复用 11 第二节 LegalAgent 接口
interface LegalAgent {
  readonly agentId: string;
  readonly card: AgentCard;
  invoke(input: AgentInvokeInput, ctx: AgentContext): Promise<AgentInvokeOutput>;
}

// 输入
interface AgentInvokeInput {
  capability: Capability;             // 11 第 2.2 节 11 个枚举之一
  params: Record<string, unknown>;    // 按 Agent Card.inputSchema
  piiLevel?: 'L1'|'L2'|'L3'|'L4';     // 调用方声明输入 PII 级别
}

// 上下文（由调用入口注入）
interface AgentContext {
  traceId: string;
  callerAgentId: string;              // 内部调用为 agentId；外部调用为 'external:<agentKey>'
  callerUserId?: string;
  externalAgentKey?: string;
  deadline: number;                   // 截止时间戳
  lang: 'zh';
}

// 输出（强制含 disclaimer/lawRefs/traceId）
interface AgentInvokeOutput {
  ok: boolean;
  data?: unknown;
  lawRefs: LawRef[];
  disclaimer: string;
  verified: boolean;
  jobId?: string;                     // 异步任务时返回
  usage: { durationMs: number; tokensIn?: number; tokensOut?: number; cacheHit?: string };
  errorCode?: number;
  errorMessage?: string;
}
```

### 3.2 调用入口

**统一入口云函数**：`agentDispatcher`（部署见 04 第 1.8 节、12 第二节）。

- **外部调用方**（mcpServer / openApiGateway 网关）→ 经 `wx.cloud.callFunction({ name: 'agentDispatcher', data: { action: 'invoke', capability, params, piiLevel } })` 转发。
- **内部调用方**（chat 云函数内 OrchestratorAgent）→ 同进程直调 `registry.lookup(capability).invoke(input, ctx)`，性能最优（见 11 第七节）。

`agentDispatcher` 内部完成：API Key 校验 → scope 校验（13 第 3.2 节）→ PII 边界检测（13 第 6.2 节）→ 限流（13 第四节）→ AgentRegistry.lookup → agent.invoke → 审计写入（`agent_invoke`）。

### 3.3 响应封装

`agentDispatcher` 云函数返回统一外层：

```jsonc
{
  "code": 0,
  "message": "ok",
  "traceId": "uuid",
  "data": {                          // 即 AgentInvokeOutput
    "ok": true,
    "data": { /* 按 capability 输出 schema */ },
    "lawRefs": [{"ref":"民法典第一百四十三条","verified":true,"title":"民事法律行为的效力"}],
    "disclaimer": "⚠️ 以上内容仅供参考，不构成法律意见……",
    "verified": true,
    "usage": {"durationMs": 120, "cacheHit": "L3"}
  }
}
```

失败时（如 `7002` capability 未授权）：

```jsonc
{
  "code": 7002,
  "message": "capability document.generate 未授权",
  "traceId": "uuid",
  "data": null
}
```

### 3.4 异步任务

异步 Agent（`async=true`，如 `document.generate`、`case.analyze`）调用立即返回 `jobId`：

```jsonc
{ "code":0, "data":{ "ok":true, "jobId":"job_xxx", "disclaimer":"...", "verified":false } }
```

任务状态查询走 `GET /v1/jobs/{jobId}`（见第五节）或 MCP `jobs/get`。

## 四、MCP 端点清单（v2.1，指向 12）

> MCP（Model Context Protocol）为 v2.1 主暴露协议，面向 AI agent。详细 inputSchema/outputSchema、传输、会话、错误码见 12 第三节。

### 4.1 传输与端点

- 基础 URL：`https://<env>.tcloudbaseapp.com/mcp`
- 传输：HTTP + SSE（Streamable HTTP transport，MCP 2025-03 规范）
- 会话：`Mcp-Session-Id` header，24 小时有效
- 协议版本：`MCP-Protocol-Version: 2025-03-26`
- 鉴权：`Authorization: Bearer lak_live_<32位>`

### 4.2 Tools（17 个：v2.1 6 个 + v2.2 7 个 + v2.3 4 个，对应 11 capability）

| MCP tool 名 | capability | 暴露层级 | 异步 | 详细 schema |
|-------------|-----------|---------|------|------------|
| `law_lookup` | `law.lookup` | L-Read | 否 | 12 第 3.3.1 节 |
| `legal_qa` | `legal.qa` | L-Read | 否 | 12 第 3.3.2 节 |
| `case_search` | `case.search` | L-Read | 否 | 12 第 3.3.3 节 |
| `process_guide` | `process.guide` | L-Read | 否 | 12 第 3.3.4 节 |
| `material_checklist` | `material.checklist` | L-Read | 否 | 12 第 3.3.5 节 |
| `document_generate` | `document.generate` | L-Write-Limited | 是 | 12 第 3.3.6 节 |
| `period_calculator`（v2.2） | `tool.period_calculator` | L-Read | 否 | 12 第 3.3.7 节 / 14 第五节 |
| `document_review`（v2.2） | `tool.document_review` | L-Read | 否 | 12 第 3.3.8 节 / 14 第七节 |
| `compensation_query`（v2.2） | `tool.compensation_query` | L-Read | 否 | 12 第 3.3.9 节 / 14 第八节 |
| `license_ocr`（v2.2） | `tool.license_ocr` | L-Read（PII L3） | 否 | 12 第 3.3.10 节 / 14 第六节 |
| `law_validity`（v2.2） | `tool.law_validity` | L-Read | 否 | 12 第 3.3.11 节 / 14 第四节 |
| `cause_classification`（v2.2） | `tool.cause_classification` | L-Read（PII L2） | 否 | 12 第 3.3.12 节 / 14 第九节 |
| `sentencing_guide`（v2.2） | `tool.sentencing_guide` | L-Read | 否 | 12 第 3.3.13 节 / 14 第十节 |
| `case.reason`（v2.3） | `case.reason` | L-Write-Limited | 否 | 12 第 3.3.14 节 / 16 第二节 |
| `case.compare`（v2.3） | `case.compare` | L-Write-Limited | 否 | 12 第 3.3.15 节 / 16 第五节 |
| `law.apply_check`（v2.3） | `law.apply_check` | L-Write-Limited | 否 | 12 第 3.3.16 节 / 16 第四节 |
| `clause_recommender`（v2.3） | `tool.clause_recommender` | L-Read | 否 | 12 第 3.3.17 节 / 14 第十一节 |

**强制约束**：所有 tool 的 `outputSchema` 必须含 `disclaimer` + `lawRefs` + `traceId` 三字段；网关出口处二次校验，缺失则注入兜底免责并告警（见 13 第 7.1 节）。v2.2 工具类 tool 的 `lawRefs` 在不涉法条时可为空数组（如 LicenseOcr），但 `disclaimer` 必填。v2.3 新增 4 个对外 MCP tools 中，`nlu.extract`/`nlu.clarify` 与 `review.*` 3 个 capability 为 L-Internal 不对外，不计入 MCP tools 总数（13 → 17）。

### 4.3 Resources（4 类：v2.1 2 类 + v2.2 2 类，只读）

| URI scheme | 用途 | 方法 |
|-----------|------|------|
| `law_article://?category=civil&page=1&pageSize=20` | 法条库分页/筛选 | `resources/list`、`resources/read` |
| `case_precedent://?causeOfAction=离婚纠纷&year=2023` | 案例库分页/筛选 | `resources/list`、`resources/read` |
| `official_query_entry://?category=enterprise&region=全国`（v2.2） | 官方查询网址目录 | `resources/list`、`resources/read` |
| `legal_material://?category=law_full_text&legalHierarchy=law`（v2.2） | 法规资料目录 | `resources/list`、`resources/read` |

### 4.4 Prompts（2 个）

| Prompt 名 | 注入变量 | 用途 |
|----------|---------|------|
| `legal_consult_template` | `{question}` | 结构化法律咨询 prompt |
| `document_draft_template` | `{docType, vars}` | 文书起草 prompt |

### 4.5 异步任务通知

长任务通过 `notifications/progress` 推送进度，完成/失败发 `notifications/job_done`；客户端也可用 `jobs/get` 主动查询（见 12 第 3.7 节）。

## 五、OpenAPI 端点清单（v2.1，指向 12）

> OpenAPI/REST 兼容层面向传统系统。详细请求/响应示例见 12 第四节。

### 5.1 通用约定

- 基础 URL：`https://<env>.tcloudbaseapp.com/api/v1`
- 鉴权：`Authorization: Bearer <apiKey>` 或 `X-API-Key: <apiKey>`
- 限流响应头：`X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`
- 版本：URL 路径 `/v1/`；重大变更升 `/v2/`，`/v1/` 至少维护 12 个月
- 文档：`GET /v1/openapi.json`（OpenAPI 3.0）、`GET /v1/docs`（Swagger UI）
- 强制合规：响应头追加 `X-Legal-Disclaimer: present`，便于调用方程序化校验

### 5.2 端点清单

| Method | Path | capability | 暴露层级 | 异步 |
|--------|------|-----------|---------|------|
| GET | `/v1/law/articles` | law.lookup | L-Read | 否 |
| POST | `/v1/qa` | legal.qa | L-Read | 否 |
| GET | `/v1/cases` | case.search | L-Read | 否 |
| GET | `/v1/process` | process.guide | L-Read | 否 |
| GET | `/v1/materials` | material.checklist | L-Read | 否 |
| POST | `/v1/documents` | document.generate | L-Write-Limited | 是 |
| GET | `/v1/documents/{docId}` | document.export | L-Read* | 否 |
| GET | `/v1/jobs/{jobId}` | — | L-Read | 否 |
| GET | `/v1/agents` | — | L-Read | 否 |
| GET | `/v1/agents/{agentId}/card` | — | L-Read | 否 |
| POST | `/v1/tools/period-calculator`（v2.2） | tool.period_calculator | L-Read | 否 |
| POST | `/v1/tools/document-review`（v2.2） | tool.document_review | L-Read | 否 |
| POST | `/v1/tools/compensation-query`（v2.2） | tool.compensation_query | L-Read | 否 |
| POST | `/v1/tools/license-ocr`（v2.2） | tool.license_ocr | L-Read** | 否 |
| POST | `/v1/tools/law-validity`（v2.2） | tool.law_validity | L-Read | 否 |
| POST | `/v1/tools/cause-classification`（v2.2） | tool.cause_classification | L-Read | 否 |
| POST | `/v1/tools/sentencing-guide`（v2.2） | tool.sentencing_guide | L-Read | 否 |
| GET | `/v1/query-center`（v2.2） | — | L-Read | 否 |
| GET | `/v1/materials-center`（v2.2） | — | L-Read | 否 |
| POST | `/v1/lawyer-reviews`（v2.3） | review.lawyer | L-Internal | 否 |
| GET | `/v1/lawyer-reviews/pending`（v2.3） | review.lawyer | L-Internal | 否 |
| POST | `/v1/lawyer-reviews/{id}/claim`（v2.3） | review.lawyer | L-Internal | 否 |
| POST | `/v1/lawyer-reviews/{id}/submit`（v2.3） | review.lawyer | L-Internal | 否 |
| GET | `/v1/answers/{msgId}/trace`（v2.3） | — | L-Read | 否 |
| POST | `/v1/data-exports`（v2.3） | — | L-Read | 是 |

*`document.export` 本质是读取已生成文书，归 L-Read，但需校验 `docId` 归属调用方（仅可下载由该 agentKey 触发生成的文书）。

**`license_ocr` 归 L-Read，但输入图像含 L3 PII，外部 agent 调用时凭证 scope 必须显式含 `tool.license_ocr`，且输入 fileId 必须经 UploadService 安全校验。

**v2.2 端点分组约定**：
- `/v1/tools/<toolId>` 端点统一 POST 方法（输入参数较多，GET 不适宜）
- `/v1/query-center` 与 `/v1/materials-center` 为 GET（资源列表查询，支持 `category`/`region`/`page`/`pageSize` 查询参数）
- 9 个 v2.2 端点均通过 `agentDispatcher` 转发至 ToolRegistry 或对应云函数（query-center/materials-center 直查 official_query_entry/legal_material 集合，不经 AgentRegistry）

**v2.3 端点分组约定**：
- `/v1/lawyer-reviews/*` 4 个端点为律师审核闭环，L-Internal 仅律师端 + 管理员可调（不对外部 agent 暴露，13 治理层拒绝外部凭证）
- `/v1/answers/{msgId}/trace` 为回答溯源查询，L-Read 对外可调（调用方须持有 `case.search` 或自有 msgId）
- `/v1/data-exports` 为数据可携带权导出，L-Read 但仅用户本人可调（按 userId 鉴权，非 apiKey），异步任务返回 `202 Accepted` + `pollLocation`
- 6 个 v2.3 端点总数：OpenAPI 端点 19 → 25

### 5.3 响应封装

所有端点沿用本节统一外层 `{ code, message, traceId, data }`，`data` 即 `AgentInvokeOutput`。异步任务 `POST /v1/documents` 返回 `202 Accepted` + `pollLocation`，详见 12 第 4.3 节。

## 六、云函数 API 清单

| 云函数 | 方法/动作 | 用途 | 鉴权 | 流式 |
|--------|----------|------|------|------|
| `chat` | send | 法律咨询对话 | user | 是 |
| `generateDocument` | render | 文书生成 | user | 是 |
| `generateDocument` | export | 导出 Word/PDF | user | 否 |
| `searchCase` | search | 案例检索 | user | 否 |
| `getProcess` | get | 流程指导 | user | 否 |
| `getMaterialChecklist` | get | 材料清单 | user | 否 |
| `caseCrud` | create/list/get/update/close | 案件 CRUD | user | 否 |
| `uploadOcr` | upload/recognize | 文件上传+OCR | user | 否 |
| `subscribeNotification` | grant/list | 订阅授权管理 | user | 否 |
| `submitFeedback` | create | 反馈 | user | 否 |
| `managePreference` | get/update | 偏好管理 | user | 否 |
| `admin` | * | 运营后台 | ops/audit/admin | 否 |
| `notificationScheduler` | cron | 定时提醒（触发器） | system | 否 |
| `lawUpdate` | cron | 法条更新（触发器） | system | 否 |
| `invokeTool`（v2.2） | invoke | 工具调用统一入口（按 toolId 分发到 LegalTool） | user | 否 |
| `queryCenter`（v2.2） | list/search | 官方查询网址目录（official_query_entry 集合） | user | 否 |
| `materialCenter`（v2.2） | list/download | 法规资料中心（legal_material 集合） | user | 否 |
| `knowledgePipeline`（v2.2） | trigger/status | 采集任务触发与查询（admin） | ops/admin | 否 |

## 七、API 详细定义

### 4.1 `chat` — 法律咨询对话

**请求**
```jsonc
{
  "sessionId": "sess_xxx",          // 可空，空则新建会话
  "message": "我想起诉离婚需要什么材料",
  "clientRequestId": "uuid",        // 幂等
  "stream": true                    // 是否流式
}
```

**流式协议**：云函数通过 `SSE`-like 分片返回（云开发 WebSocket 通道或多次分片回调）。每个分片：

```jsonc
{ "type":"chunk", "delta":"离婚诉讼", "traceId":"uuid" }
{ "type":"meta", "intent":"material_checklist", "route":"knowledge", "lawRefs":["民法典第一千零七十九条"] }
{ "type":"disclaimer", "text":"⚠️ 以上内容仅供参考……" }
{ "type":"done", "msgId":"m2", "sessionId":"sess_xxx" }
{ "type":"error", "code":5003, "message":"LLM 降级中，已转为知识库回答" }
```

**非流式响应** `data`：

```jsonc
{
  "msgId":"m2",
  "sessionId":"sess_xxx",
  "content":"离婚诉讼立案所需材料如下：1. 起诉状……",
  "intent":"material_checklist",
  "route":"knowledge",
  "lawRefs":[{"ref":"民法典第一千零七十九条","title":"离婚","verified":true}],
  "disclaimer":"⚠️ 以上内容仅供参考，不构成法律意见……",
  "suggestConsultLawyer": false,
  "quickReplies":["生成离婚起诉状","查看离婚立案流程"]
}
```

### 4.2 `generateDocument` — 文书生成

**render 请求**
```jsonc
{
  "templateCode":"civil_complaint_divorce",
  "caseId":"case_xxx",              // 可空，自动从案件带入变量
  "vars":{
    "plaintiffName":"张三",
    "defendantName":"李四",
    "claim":"1. 准予离婚；2. 婚生子由原告抚养……",
    "facts":"原被告于 2018 年登记结婚……",
    "courtName":"北京市朝阳区人民法院"
  },
  "clientRequestId":"uuid",
  "stream": true
}
```

**响应** `data`：
```jsonc
{
  "docId":"doc_xxx",
  "renderedText":"民事起诉状\n\n原告：张三……",
  "lawRefs":["民法典第一千零七十九条"],
  "disclaimer":"本文书由 AI 生成，请在提交前由专业律师审核。",
  "exportReady": true
}
```

错误：变量校验失败 `3001`；模板渲染失败 `3002`。

**export 请求**
```jsonc
{ "docId":"doc_xxx", "format":"docx" }   // docx|pdf
```

**响应** `data`：
```jsonc
{ "fileId":"cloud://legal-prod.abc/doc_xxx.docx", "expireAt":"..." }
```

### 4.3 `searchCase` — 案例检索

**请求**
```jsonc
{
  "query":"离婚 抚养权",
  "filters":{
    "category":"civil",
    "causeOfAction":"离婚纠纷",
    "courtLevel":"基层法院",
    "judgmentYearFrom":2020,
    "judgmentYearTo":2025,
    "outcomeLabel":"plaintiff_win"
  },
  "page":1,
  "pageSize":20,
  "sort":"relevance"                 // relevance|judgmentDate_desc|amount_desc
}
```

**响应** `data`：
```jsonc
{
  "total":234,
  "page":1,
  "items":[
    {
      "caseId":"...",
      "caseTitle":"张某某与李某某离婚纠纷一审民事判决书",
      "court":"北京市朝阳区人民法院",
      "judgmentDate":"2023-06-15",
      "outcomeLabel":"plaintiff_win",
      "factsSummary":"……",
      "lawRefs":["民法典第一千零七十九条"],
      "score":0.87,
      "sourceUrl":"https://wenshu.court.gov.cn/..."
    }
  ],
  "facets":{
    "causeOfAction":[{"value":"离婚纠纷","count":234}],
    "judgmentYear":[{"value":2023,"count":98}],
    "outcomeLabel":[{"value":"plaintiff_win","count":120}]
  }
}
```

### 4.4 `getProcess` — 流程指导

**请求**：`{ "category":"civil", "subCategory":"离婚", "stage":"立案中" }`
**响应** `data`：`legal_knowledge.structured`（steps/timeline/materials）+ `lawRefs`。

### 4.5 `getMaterialChecklist` — 材料清单

**请求**：`{ "category":"civil", "subCategory":"离婚" }`
**响应** `data`：`{ "items":[{"name":"身份证","required":true,"note":"..."}], "lawRefs":[...] }`

### 4.6 `caseCrud` — 案件 CRUD

**create 请求**
```jsonc
{
  "causeOfAction":"劳动争议",
  "category":"civil",
  "stage":"立案中",
  "role":"plaintiff",
  "facts":"...",                       // 🔒 加密前由服务端处理
  "nextDeadlines":[
    {"node":"举证期限","date":"2026-08-01","remindable":true}
  ]
}
```
**响应** `data`：`{ "caseId":"case_xxx", "createdAt":"..." }`

**list**：`{ "status":"active", "page":1, "pageSize":20 }` → `{ "items":[...], "total":N }`
**get**：`{ "caseId":"case_xxx" }` → 完整 `case_record`（含越权校验）
**update**：`{ "caseId":"case_xxx", "patch":{ "stage":"一审" } }` → 更新后记录（追加 stageHistory）
**close**：`{ "caseId":"case_xxx" }` → `{ "status":"closed","closedAt":"..." }`

### 4.7 `uploadOcr` — 上传与 OCR

**upload**：客户端先 `wx.cloud.uploadFile` 获 `fileId`，再调用：
```jsonc
{ "action":"recognize", "fileId":"cloud://...", "ocrType":"id_card|contract|general" }
```
**响应** `data`：
```jsonc
{
  "fileId":"cloud://...",
  "ocrResult":{ "fields":{ "name":"张三","idNo":"110***********1234" } },  // 已脱敏
  "structured":{ ... },          // 结构化字段（合同关键条款等）
  "contentSafe": true
}
```
错误：OCR 失败 `6001`；内容安全拦截 `6002`。

### 4.8 `subscribeNotification`

**grant**：`{ "templateId":"case_deadline_remind", "scope":"case_xxx", "authType":"one_time" }` → `{ "ok":true, "authCount":1 }`
**list**：`{}` → `{ "items":[...] }`

### 4.9 `submitFeedback`

```jsonc
{
  "type":"intent_wrong",
  "relatedMsgId":"m2",
  "relatedSessionId":"sess_xxx",
  "expectedIntent":"process_guide",
  "content":"应该是起诉流程而不是材料清单",
  "contact":"138****1234"          // 可空
}
```
响应：`{ "feedbackId":"...", "status":"open" }`

### 4.10 `managePreference`

**get**：`{}` → `user_profile.legalPreferences`
**update**：`{ "patch":{ "focusAreas":["民事","劳动"], "personalizationEnabled":true } }` → 更新后对象

## 八、Service 层 TypeScript 接口桩

> 位于 `src/types/` 与 `src/services/legal/`。仅签名，不含实现。

```typescript
// ===== types/intent.ts =====
export type IntentType =
  | 'legal_qa'
  | 'document_generate'
  | 'process_guide'
  | 'case_analysis'
  | 'material_checklist'
  | 'general_qa';

export type RouteTarget = 'rule' | 'knowledge' | 'llm' | 'general_qa';

export interface IntentResult {
  intent: IntentType;
  confidence: number;            // 0..1
  route: RouteTarget;
  fallbackUsed: boolean;
  matchedKeywords: string[];
  matchedPatterns: string[];
}

// ===== types/dialog.ts =====
export interface DialogContext {
  sessionId: string;
  lastIntent?: IntentType;
  pendingDocument?: string | null;
  relatedCaseId?: string | null;
  unresolvedCount: number;
  recentTurns: DialogTurn[];     // 最近 12 轮
}
export interface DialogTurn { role: 'user'|'assistant'; content: string; intent?: IntentType; ts: string; }

// ===== services/legal/intentRouter.ts =====
export interface IntentRouter {
  classify(input: string, ctx: DialogContext): Promise<IntentResult>;
  /** 0.5–0.8 区间调用 LLM 辅助判定 */
  assistWithLlm(input: string, candidates: IntentType[]): Promise<IntentType>;
}

// ===== services/legal/ruleEngine.ts =====
export interface RuleResult {
  answer: string;
  lawRefs: LawRef[];
  source: 'law_article' | 'faq';
  matchedKey: string;
}
export interface RuleEngine {
  query(input: string): Promise<RuleResult | null>;
}

// ===== services/legal/knowledgeBase.ts =====
export interface KnowledgeResult {
  answer: string;
  structured?: Record<string, unknown>;
  lawRefs: LawRef[];
  knowledgeId: string;
}
export interface KnowledgeBase {
  query(intent: IntentType, filters: KnowledgeFilter): Promise<KnowledgeResult | null>;
  getProcess(category: string, subCategory: string, stage?: string): Promise<KnowledgeResult | null>;
  getMaterialChecklist(category: string, subCategory: string): Promise<MaterialItem[]>;
}

// ===== services/legal/ragService.ts =====
export interface RagResult {
  lawArticles: LawArticleHit[];
  precedents: PrecedentHit[];
  fused: FusedHit[];              // RRF 融合后
  reranked: FusedHit[];           // 重排后
}
export interface RagService {
  retrieve(query: string, intent: IntentType, opts?: RagOpts): Promise<RagResult>;
}
export interface RagOpts { topK?: number; category?: string; minScore?: number; }

// ===== services/legal/llm.ts =====
export interface LlmOpts {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  promptVersion?: number;
  enableCache?: boolean;
}
export interface LlmService {
  stream(prompt: string, opts: LlmOpts): AsyncIterable<LlmChunk>;
  complete(prompt: string, opts: LlmOpts): Promise<string>;
  validateLawRefs(text: string): Promise<LawRefCheckResult>;
}
export interface LlmChunk { delta: string; done: boolean; }
export interface LawRefCheckResult {
  verified: LawRef[];
  unverified: LawRef[];           // 未在 law_article 命中
  sanitizedText: string;          // 标注后的文本
}

// ===== services/legal/documentGenerator.ts =====
export interface DocumentGenerator {
  render(templateCode: string, vars: Record<string, unknown>, caseId?: string): Promise<RenderResult>;
  validateVars(templateCode: string, vars: Record<string, unknown>): Promise<ValidationResult>;
  exportDoc(docId: string, format: 'docx'|'pdf'): Promise<{ fileId: string; expireAt: string }>;
}
export interface RenderResult { docId: string; renderedText: string; lawRefs: string[]; disclaimer: string; }

// ===== services/legal/memoryManager.ts =====
export interface MemoryEntry { type: 'preference'|'case'|'dialog'|'usage'; key: string; value: unknown; ts: string; }
export interface MemoryManager {
  saveMemory(entry: MemoryEntry): Promise<void>;
  getRelevantMemories(intent: IntentType): Promise<MemoryEntry[]>;
  updateCase(caseData: CaseRecord): Promise<void>;
  getCaseTimeline(caseId: string): Promise<TimelineNode[]>;
  cleanupOldest(n: number): Promise<void>;
}

// ===== services/legal/caseTracker.ts =====
export interface CaseTracker {
  create(input: CaseCreateInput): Promise<CaseRecord>;
  list(userId: string, status?: string): Promise<CaseRecord[]>;
  get(caseId: string, userId: string): Promise<CaseRecord | null>;
  update(caseId: string, patch: Partial<CaseRecord>, userId: string): Promise<CaseRecord>;
  close(caseId: string, userId: string): Promise<CaseRecord>;
  computeDeadlines(case: CaseRecord): TimelineNode[];
}

// ===== services/legal/notificationService.ts =====
export interface NotificationService {
  send(payload: NotifyPayload): Promise<NotifyResult>;
  subscribe(userId: string, templateId: string, scope: string, authType: 'one_time'|'long_term'): Promise<void>;
  downgradeToInApp(userId: string, payload: NotifyPayload): Promise<void>;   // 订阅授权耗尽时
}

// ===== services/legal/ocrService.ts =====
export interface OcrService {
  recognize(fileId: string, ocrType: 'id_card'|'contract'|'general'): Promise<OcrResult>;
}

// ===== services/legal/authService.ts =====
export interface AuthService {
  resolveUserId(): Promise<string>;                  // openid → userId
  checkOwner(resourceOwnerId: string, callerId: string): boolean;
  requireRole(role: 'ops'|'audit'|'admin'): Promise<void>;
}

// ===== services/legal/auditLog.ts =====
export interface AuditLog {
  write(event: AuditEvent, detail: Record<string, unknown>): Promise<void>;  // 异步、防阻塞
}

// ===== 共享类型 =====
export interface LawRef { ref: string; title?: string; verified?: boolean; }
export interface LawArticleHit { articleId: string; lawName: string; articleNo: string; content: string; score: number; source: 'bm25'|'vector'|'rule'; }
export interface PrecedentHit { caseId: string; caseTitle: string; factsSummary: string; score: number; source: 'bm25'|'vector'; }
export interface FusedHit { id: string; score: number; type: 'law'|'precedent'; payload: unknown; }
export interface TimelineNode { node: string; date: string; remindable: boolean; remindedDays: number[]; }
export interface MaterialItem { name: string; required: boolean; note?: string; }
export interface ValidationResult { valid: boolean; errors: VarError[]; }
export interface VarError { key: string; message: string; }
export interface CaseRecord { /* 见 05 case_record */ [k: string]: unknown; }
export interface CaseCreateInput { causeOfAction: string; category: string; stage: string; role: string; facts: string; nextDeadlines?: TimelineNode[]; }
export interface NotifyPayload { userId: string; templateId: string; data: Record<string, string>; scope?: string; }
export interface NotifyResult { ok: boolean; msgId?: string; reason?: string; }
export interface OcrResult { fields: Record<string, string>; structured?: Record<string, unknown>; contentSafe: boolean; }
export type AuditEvent = 'chat_send'|'llm_call'|'doc_generate'|'case_access'|'admin_op'|'auth_event'|'data_delete'|'degradation';
```

## 九、限流配额

### 9.1 内部云函数 API（v2.0）

| API | 单用户/分钟 | 单用户/天 | 全局 QPS |
|-----|------------|----------|---------|
| chat | 20 | 200（LLM 部分 50） | 500 |
| generateDocument | 5 | 30 | 50 |
| searchCase | 20 | 200 | 100 |
| caseCrud | 30 | — | 100 |
| uploadOcr | 10 | 50 | 30 |
| submitFeedback | 5 | 20 | 20 |
| admin | — | — | 20（按角色） |

超限返回 `4291`，`message` 提示对应配额类型。

### 9.2 外部 agent 调用配额（v2.1，权威源见 13 第 4 节）

| 维度 | L-Read | L-Write-Limited | 并发 |
|------|--------|-----------------|------|
| 单外部 agent / 小时 | 1000 | 50 | 10 |
| 单外部 agent / 天 | 10000 | 500 | — |
| 全局 mcpServer / 秒 | 200 | 50 | — |
| 全局 openApiGateway / 秒 | 200 | 50 | — |

- 计数 key：`ratelimit:<agentKey>:<hour|day>:<bucket>`，复用 02 限流框架。
- 超限：MCP 返回 `-32002`；OpenAPI 返回 HTTP 429 + `Retry-After` 响应头，外层 `code` 字段仍用 `4291`。
- 自定义配额：`external_agent_credential.rateLimits` 可覆盖默认值（审批时设定，见 13 第 4.2 节）。
- 熔断：单 agent 错误率 > 30%（5 分钟）触发该 agent 调用降级（非全局熔断），复用 02 第 4.3 节框架。

## 十、流式输出协议

微信小程序不直接支持 HTTP SSE；采用方案：

- **方案 A（推荐）**：云函数 `chat` 一次返回完整结构化结果，客户端用打字机动画模拟流式（适合知识库/规则引擎结果）。
- **方案 B（真流式）**：云函数侧通过 `wx-server-sdk` 的长连接或多次 `callback` 分片回传 LLM 流式 token；客户端订阅分片事件拼装。适用于 LLM 长回答。

协议帧（方案 B）：

```
[chunk] { "delta": "离婚诉讼", "traceId": "..." }
[chunk] { "delta": "立案流程" }
[meta]  { "intent": "process_guide", "route": "knowledge", "lawRefs": [...] }
[disclaimer] { "text": "⚠️ ..." }
[done]  { "msgId": "m2", "sessionId": "sess_xxx" }
```

错误帧优先于 done：`[error] { "code": 5003, "message": "LLM 降级中" }`，客户端据此展示降级提示。

## 十一、与 v1.0/v2.0/v2.1/v2.2/v2.3 的差异声明

- **v1.0 → v2.0**：v1.0 完全未定义接口；v2.0 给出 10 类云函数 API 的请求/响应/错误/限流/幂等/流式协议，以及 8 个核心 Service 模块的 TypeScript 接口桩，覆盖 G17 全部 P0 缺口。
- **v2.0 → v2.1**：新增 `Agent.invoke` 统一接口契约（第三节）+ MCP 端点清单（第四节，6 tools/2 resources/2 prompts）+ OpenAPI 端点清单（第五节，10 个端点）+ 13 个 v2.1 专用错误码（JSON-RPC 协议层 5 个 + 鉴权限流 2 个 + Agent 业务层 6 个）+ 按外部 agent 维度限流配额（9.2 节）。v2.0 内部云函数 API（第六、七节）与 Service 接口桩（第八节）全部保留，v2.1 在其上叠加 Agent 层与对外暴露层。
- **v2.1 → v2.2**：新增 9 个 OpenAPI 端点（5.2 表 v2.2 行：7 个 `/v1/tools/*` POST + `/v1/query-center` + `/v1/materials-center` GET）+ 4 个云函数（第六节：invokeTool/queryCenter/materialCenter/knowledgePipeline）+ 9 个错误码 8001-8009（第二节）+ 7 个 MCP tools（4.2 表 v2.2 行）+ 2 类 Resources（4.3 表 v2.2 行）。v2.2 端点均经 `agentDispatcher` 转发，复用 v2.1 鉴权/限流/审计基础设施。MCP tools 总数 6 → 13，OpenAPI 端点总数 10 → 19，云函数总数 13 → 17。
- **v2.2 → v2.3**：新增 6 个 OpenAPI 端点（5.2 表 v2.3 行：4 个 `/v1/lawyer-reviews/*` + `/v1/answers/{msgId}/trace` + `/v1/data-exports`）+ 10 个错误码 8010-8019（第二节：NLU 8010-8011 / 安全合规 8012-8013 / 律师审核 8014-8016 / 溯源 8017 / 文书推理 8018-8019）+ 4 个对外 MCP tools（`case.reason`/`case.compare`/`law.apply_check` 归属 reasoning Agent，权威源 16；`clause_recommender` 归属 ToolAgent 第 8 工具，权威源 14 第十一节）。`nlu.extract`/`nlu.clarify` 2 个与 `review.*` 3 个 capability 为 L-Internal 不对外，不计入 MCP tools 总数。律师审核端点 L-Internal 不对外部 agent 暴露。OpenAPI 端点总数 19 → 25，错误码总数 9 → 19，MCP tools 总数 13 → 17。
