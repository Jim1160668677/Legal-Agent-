# 12 · MCP Server 与 OpenAPI 暴露规约

> 版本：v2.3 | 日期：2026-07-22 | 状态：设计扩展（v2.3 新增 4 对外 MCP tools + 6 OpenAPI 端点 + 10 错误码 8010-8019）
> 影响范围：04 / 05 / 06 / 13 / 14 / 16 / 17
> 本文为 MCP tool 名、OpenAPI 端点、传输协议权威源。

---

## 一、设计目标

将内部 8 个 Agent（见 11）的能力通过**标准化协议**对外暴露，使外部 AI agent 与传统系统都能调用：

1. **MCP（主）** — 面向 AI agent，提供 tools/resources/prompts 三类能力，原生支持 LLM 工具调用语义。
2. **OpenAPI（兼容）** — 面向传统系统，REST 形式暴露同样能力，自动生成 Swagger 文档。
3. **协议无关** — 两条暴露路径共用同一套 `LegalAgent.invoke` 实现，仅传输层不同。
4. **强制合规** — 输出 schema 强制含 `disclaimer` + `lawRefs` + `traceId`，外部不可剥离。

## 二、部署形态

| 云函数 | 职责 | 触发 |
|--------|------|------|
| `mcpServer` | MCP 协议端点（HTTP+SSE） | HTTP 触发 |
| `openApiGateway` | OpenAPI/REST 端点 + `/v1/openapi.json` | HTTP 触发 |
| `agentDispatcher` | 内部统一入口，接收网关请求 → 调 AgentRegistry | 被 mcpServer/openApiGateway 调用 |

```
外部 agent ──HTTP+SSE──▶ mcpServer ──┐
                                      ├─▶ agentDispatcher ─▶ AgentRegistry ─▶ LegalAgent.invoke
传统系统 ─────HTTPS───▶ openApiGateway┘
```

## 三、MCP Server 规约

### 3.1 传输与端点

- **传输**：HTTP + SSE（Streamable HTTP transport，MCP 2025-03 规范），单端点双向。
- **基础 URL**：`https://<env>.tcloudbaseapp.com/mcp`
- **会话**：`Mcp-Session-Id` header，初始化时由 server 颁发，24 小时有效。
- **协议版本**：`MCP-Protocol-Version: 2025-03-26`，响应头回显。

### 3.2 鉴权

- `Authorization: Bearer <apiKey>` header。
- API Key 形如 `lak_live_<32位>`，由 13 治理流程颁发。
- 鉴权失败返回 JSON-RPC error `-32001`（见 06 错误码）。

### 3.3 Tools（17 个：v2.1 6 个 + v2.2 7 个 + v2.3 4 个）

每个 tool 对应一个 capability，input/output schema 严格匹配 Agent Card。v2.1 6 个 tool（law_lookup / legal_qa / case_search / process_guide / material_checklist / document_generate）见 3.3.1-3.3.6；v2.2 新增 7 个 tool.* 工具类 MCP tools 见 3.3.7-3.3.13，对应 14 中定义的 7 个 LegalTool，capability 归属 ToolAgent；v2.3 新增 4 个对外 MCP tools 见 3.3.14-3.3.17（3 个 reasoning Agent capability `case.reason`/`case.compare`/`law.apply_check`，权威源 16；1 个 ToolAgent 第 8 工具 `clause_recommender`，权威源 14 第十一节）。注：`nlu.extract`/`nlu.clarify` 与 `review.*` 3 个 capability 为 L-Internal，不对外暴露，不计入 MCP tools 总数。

#### 3.3.1 `law_lookup`

```jsonc
{
  "name": "law_lookup",
  "description": "查询法律条文。按法律名+条号精确查，或按关键词检索。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "lawName": { "type": "string" },
      "articleNo": { "type": "string" },
      "query": { "type": "string" },
      "category": { "type": "string", "enum": ["civil","criminal","commercial","administrative","procedural"] }
    },
    "oneOf": [
      { "required": ["lawName","articleNo"] },
      { "required": ["query"] }
    ]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "articles": { "type": "array", "items": { "type": "object", "properties": {
        "lawName": {"type":"string"}, "articleNo": {"type":"string"},
        "content": {"type":"string"}, "status": {"type":"string"}, "sourceUrl": {"type":"string"}
      }}},
      "lawRefs": { "type": "array" },
      "disclaimer": { "type": "string" },
      "traceId": { "type": "string" }
    },
    "required": ["lawRefs","disclaimer","traceId"]
  }
}
```

#### 3.3.2 `legal_qa`

输入：`{ question: string, category?: string }`
输出：`{ answer, lawRefs, disclaimer, traceId, suggestConsultLawyer }`

#### 3.3.3 `case_search`

输入：`{ query, filters?: {category, causeOfAction, courtLevel, judgmentYearFrom, judgmentYearTo, outcomeLabel}, page?, pageSize? }`
输出：`{ total, page, items[], facets, disclaimer, traceId }`

#### 3.3.4 `process_guide`

输入：`{ category, subCategory, stage? }`
输出：`{ steps[], timeline[], lawRefs, disclaimer, traceId }`

#### 3.3.5 `material_checklist`

输入：`{ category, subCategory }`
输出：`{ items[], lawRefs, disclaimer, traceId }`

#### 3.3.6 `document_generate`（受限）

输入：`{ templateCode, vars, caseId?, async?: true }`
- 默认异步（async=true），返回 `jobId` + 通过 `notifications/progress` 推进度。
- 同步模式（async=false）仅允许小文书（< 2000 字），超时 30s。

输出（异步）：`{ jobId, status: "pending", disclaimer, traceId }`
输出（同步）：`{ docId, renderedText, lawRefs, disclaimer, exportReady, traceId }`

#### 3.3.7 `period_calculator`（v2.2，capability: tool.period_calculator）

```jsonc
{
  "name": "period_calculator",
  "description": "法定/指定期限推算，支持日/月/年单位与节假日扣除",
  "inputSchema": {
    "type": "object",
    "properties": {
      "startDate": { "type": "string", "format": "date" },
      "periodType": { "type": "string", "enum": ["statutory", "designated"] },
      "duration": { "type": "number", "minimum": 1, "maximum": 3650 },
      "unit": { "type": "string", "enum": ["day", "month", "year"] },
      "deductHolidays": { "type": "boolean", "default": true },
      "jurisdiction": { "type": "string", "default": "全国" }
    },
    "required": ["startDate", "periodType", "duration", "unit"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "deadline": { "type": "string", "format": "date" },
      "actualDays": { "type": "number" },
      "holidayDeductions": { "type": "array" },
      "calculationTrace": { "type": "string" },
      "lawRefs": { "type": "array" },
      "disclaimer": { "type": "string" },
      "traceId": { "type": "string" }
    },
    "required": ["deadline", "actualDays", "lawRefs", "disclaimer", "traceId"]
  }
}
```

#### 3.3.8 `document_review`（v2.2，capability: tool.document_review）

输入：`{ documentText: string, docType: '起诉状'|'答辩状'|'合同'|'律师函'|'申请书'|'其他' }`
输出：`{ issues: [{type, severity, location, message, suggestion}], lawRefs, disclaimer, traceId }`
- issues.type: `missing_required` | `invalid_law_ref` | `format_issue` | `incomplete_party_info`
- severity: `error` | `warning`

#### 3.3.9 `compensation_query`（v2.2，capability: tool.compensation_query）

输入：`{ causeOfAction: string, region: string, disabilityLevel?: 1-10, income?: {monthlySalary, annualBonus}, dependents?: number, medicalFee?: number }`
输出：`{ items: [{name, formula, amount, basis}], totalAmount, lawRefs, disclaimer, traceId }`

#### 3.3.10 `license_ocr`（v2.2，capability: tool.license_ocr，PII L3）

输入：`{ fileId: string, licenseType?: 'auto'|'business_license'|'id_card'|'lawyer_license'|'organization_code' }`
输出：`{ licenseType, fields: {object}, validation: {checksumValid, notExpired, issues}, confidence, lawRefs?, disclaimer, traceId }`
- 调用前需经 PII 边界检测（输入图像可能含 L3 PII），外部 agent 调用时凭证 scope 必须含 `tool.license_ocr`

#### 3.3.11 `law_validity`（v2.2，capability: tool.law_validity）

输入：`{ lawName?: string, articleNo?: string, articleRef?: string }`（lawName+articleNo 或 articleRef 二选一）
输出：`{ found, lawName, articleNo, title, content, status, effectiveDate, promulgatingBody, legalHierarchy, amendedBy, amends, sourceUrl, statusBadge, lawRefs, disclaimer, traceId }`

#### 3.3.12 `cause_classification`（v2.2，capability: tool.cause_classification，PII L2）

输入：`{ caseDescription: string }`（自由文本案情描述）
输出：`{ topCandidates: [{causeCode, causeName, category, applicableProcedure, confidence}], lawRefs, disclaimer, traceId }`
- 输入 caseDescription 经 PiiService 脱敏后再传 LLM（L2 PII 边界）

#### 3.3.13 `sentencing_guide`（v2.2，capability: tool.sentencing_guide）

输入：`{ charge: string, elements: {amount?: number, times?: number, consequence?: string, priorConviction?: boolean, surrender?: boolean, merit?: boolean} }`
输出：`{ sentencingRange: {min, max, unit}, baseSentence, adjustments: [{type, factor, description}], lawRefs, disclaimer, traceId }`

#### 3.3.14 `case.reason`（v2.3，capability: case.reason，reasoning Agent）

```jsonc
{
  "name": "case.reason",
  "description": "基于 IRAC 框架的法律推理。输入用户问题与案情，输出结构化推理链（争议点/法条规则/事实映射/结论）。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "question": { "type": "string", "description": "用户法律问题" },
      "facts": { "type": "string", "description": "案情事实描述" },
      "caseCause": { "type": "string", "description": "案由（可选，辅助争议点识别）" }
    },
    "required": ["question", "facts"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "issues": { "type": "array", "items": { "type": "object", "properties": { "issueText": {"type":"string"}, "issueType": {"type":"string"}, "relatedLaws": {"type":"array"} } } },
      "rules": { "type": "array", "items": { "type": "object", "properties": { "articleRef": {"type":"string"}, "elements": {"type":"array"} } } },
      "applications": { "type": "array", "items": { "type": "object", "properties": { "result": {"type":"string","enum":["applicable","partial","false"]}, "matched": {"type":"array"}, "missing": {"type":"array"} } } },
      "conclusion": { "type": "string" },
      "confidence": { "type": "number" },
      "reasoningChainId": { "type": "string" },
      "lawRefs": { "type": "array" },
      "disclaimer": { "type": "string" },
      "traceId": { "type": "string" }
    },
    "required": ["conclusion", "lawRefs", "disclaimer", "traceId"]
  }
}
```
- 暴露层级 L-Write-Limited（推理产生 reasoning_chain 持久化，见 05 3.28）；权威源 16 第二节。
- 降级：LLM 不可用时仅规则匹配，warnings 提示；法条适用判定要件不足返回 `8019`。

#### 3.3.15 `case.compare`（v2.3，capability: case.compare，reasoning Agent）

输入：`{ caseA: { facts, factsAttributes }, caseB: { facts, factsAttributes } }`
输出：`{ similarity: number, similarityBreakdown: { factEmbeddingScore, factAttributesScore }, differences: [{dimension, caseAValue, caseBValue}], lawRefs, disclaimer, traceId }`
- 算法：`0.6 × cosine(factEmbedding) + 0.4 × jaccard(factAttributes)`，阈值 ≥0.75 高度相似 / 0.5-0.75 部分相似（见 16 第三节）。
- 暴露层级 L-Write-Limited；权威源 16 第五节。

#### 3.3.16 `law.apply_check`（v2.3，capability: law.apply_check，reasoning Agent）

输入：`{ articleRef: string, facts: { entities: array } }`（articleRef 如"民法典第143条"）
输出：`{ result: 'applicable'|'partial'|'false', matchedElements: array, missingElements: array, lawRefs, disclaimer, traceId }`
- 算法：构成要件抽取 → 逐要件事实匹配 → 聚合判定（见 16 第四节）；要件不足返回 `8019`。
- 暴露层级 L-Write-Limited；权威源 16 第四节。

#### 3.3.17 `clause_recommender`（v2.3，capability: tool.clause_recommender，ToolAgent 第 8 工具）

```jsonc
{
  "name": "clause_recommender",
  "description": "条款推荐。输入文书类型与已填变量，推荐适用条款 top 5。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "docType": { "type": "string", "description": "文书类型，如'house_lease_contract'" },
      "filledVars": { "type": "object", "description": "已填变量键值" },
      "category": { "type": "string", "description": "条款类别（可选）" }
    },
    "required": ["docType", "filledVars"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "recommendedClauses": { "type": "array", "items": { "type": "object", "properties": { "clauseId": {"type":"string"}, "title": {"type":"string"}, "content": {"type":"string"}, "matchScore": {"type":"number"}, "applicable": {"type":"boolean"} } }, "maxItems": 5 },
      "lawRefs": { "type": "array" },
      "disclaimer": { "type": "string" },
      "traceId": { "type": "string" }
    },
    "required": ["recommendedClauses", "disclaimer", "traceId"]
  }
}
```
- 算法：按 docType 过滤 `clause_library` → BM25 召回 → LLM rerank top 5（见 14 第十一节）；降级为仅 BM25 召回。
- 暴露层级 L-Read；piiLevel=L1；cacheable=true，cacheTtl=1d；权威源 14 第十一节。

### 3.4 Resources（2 类 + v2.2 新增 2 类）

只读资源，支持分页与筛选，URI scheme：

- `law_article://?category=civil&page=1&pageSize=20` — 法条库
- `case_precedent://?causeOfAction=离婚纠纷&year=2023` — 案例库
- `official_query_entry://?category=enterprise&region=全国`（v2.2）— 官方查询网址目录
- `legal_material://?category=law_full_text&legalHierarchy=law`（v2.2）— 法规资料目录

`resources/list` 与 `resources/read` 标准方法。

### 3.5 Prompts（2 个）

- `legal_consult_template` — 注入 `{question}`，返回结构化法律咨询 prompt。
- `document_draft_template` — 注入 `{docType, vars}`，返回文书起草 prompt。

### 3.6 MCP 错误码（见 06 完整表）

| JSON-RPC code | 含义 |
|---------------|------|
| `-32700` | parse error |
| `-32600` | invalid request |
| `-32601` | method not found |
| `-32602` | invalid params |
| `-32603` | internal error |
| `-32001` | 未授权 / API Key 无效 |
| `-32002` | 限流 |
| `7001` | agent 不存在 |
| `7002` | capability 未授权 |
| `7003` | agent 超时 |
| `7004` | PII 边界违规（输入含 L4 PII） |
| `7005` | 内容安全拦截 |
| `7006` | 法条引用校验失败（已降级标注） |
| `8001`（v2.2） | 工具入参非法（schema 校验失败） |
| `8002`（v2.2） | 工具不存在（toolId 未注册） |
| `8003`（v2.2） | 工具执行失败（业务异常，如日期越界） |
| `8004`（v2.2） | 证照 OCR 识别失败 |
| `8005`（v2.2） | 法条效力查询无结果 |
| `8006`（v2.2） | 案由分类置信度过低 |
| `8007`（v2.2） | 量刑指导情节要素不足 |
| `8008`（v2.2） | 采集任务并发超限 |
| `8009`（v2.2） | 采集源不可达 |
| `8010`（v2.3） | 实体抽取失败（LLM NER 不可用，降级为正则+词典） |
| `8011`（v2.3） | 澄清会话超时（3 轮未补齐必填字段） |
| `8012`（v2.3） | 敏感操作二次校验失败（文书删除/导出/案件归档前校验未通过） |
| `8013`（v2.3） | 合规风险拦截（AI 回答合规风险评分 block 级） |
| `8014`（v2.3） | 律师审核任务不存在 |
| `8015`（v2.3） | 律师审核任务已被领取（不可重复领取） |
| `8016`（v2.3） | 律师标注字段不合法（评分越界或必填缺失） |
| `8017`（v2.3） | 溯源信息不存在（answer_traceability.msgId 未命中） |
| `8018`（v2.3） | 文书版本冲突（并发修订 parentVersionId 不匹配） |
| `8019`（v2.3） | 法条适用判定要件不足（构成要件抽取失败且无降级） |

> v2.3 错误码 8010-8019 完整定义（含 HTTP 类比与触发示例）见 06 第二节；本表仅列含义。`80xx` 系列由 v2.3 NLU/推理/文书/安全/律师审核 5 大方向引入，与现有 `1xxx`-`8xxx`（v2.2 及以前）不冲突。

### 3.7 异步任务通知

文书生成等长任务通过 `notifications/progress` 推送：

```jsonc
{ "method": "notifications/progress",
  "params": { "jobId": "job_xxx", "progress": 0.6, "stage": "rendering", "traceId": "..." } }
```

完成或失败发 `notifications/job_done`，客户端也可用 `jobs/get` 主动查询。

## 四、OpenAPI 兼容层规约

### 4.1 通用约定

- **基础 URL**：`https://<env>.tcloudbaseapp.com/api/v1`
- **鉴权**：`Authorization: Bearer <apiKey>` 或 `X-API-Key: <apiKey>`
- **限流头**：响应头 `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`
- **版本**：URL 路径 `/v1/`；重大变更升 `/v2/`。
- **文档**：`GET /v1/openapi.json` 返回 OpenAPI 3.0 文档；`GET /v1/docs` 提供 Swagger UI。

### 4.2 端点清单（v2.1 10 个 + v2.2 新增 9 个 + v2.3 新增 6 个，共 25 个）

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

\*document.export 本质是读取已生成文书，归 L-Read，但需校验 docId 归属调用方。
\*\*license_ocr 归 L-Read，但输入图像含 L3 PII，外部 agent 调用时凭证 scope 必须显式含 `tool.license_ocr`，且输入 fileId 必须经 UploadService 安全校验。

**v2.2 端点分组约定**：
- `/v1/tools/<toolId>` 端点统一 POST 方法（输入参数较多，GET 不适宜）
- `/v1/query-center` 与 `/v1/materials-center` 为 GET（资源列表查询，支持 `category`/`region`/`page`/`pageSize` 查询参数）
- 9 个 v2.2 端点均通过 `agentDispatcher` 转发至 ToolRegistry 或对应云函数（query-center/materials-center 直查 official_query_entry/legal_material 集合，不经 AgentRegistry）

**v2.3 端点分组约定**：
- `/v1/lawyer-reviews/*` 4 个端点为律师审核闭环（权威源 17），L-Internal 仅律师端 + 管理员可调（13 治理层拒绝外部凭证）
- `/v1/answers/{msgId}/trace` 为回答溯源查询（权威源 17 第四节），L-Read 对外可调（调用方须持有 `case.search` 或自有 msgId）
- `/v1/data-exports` 为数据可携带权导出（《个人信息保护法》第 45 条，权威源 03 12.5），L-Read 但仅用户本人可调（按 userId 鉴权，非 apiKey），异步任务返回 `202 Accepted` + `pollLocation`
- 6 个 v2.3 端点总数：OpenAPI 端点 19 → 25

### 4.3 请求/响应示例

**`GET /v1/law/articles?lawName=民法典&articleNo=143`**

```jsonc
// 200 OK
{
  "code": 0, "message": "ok", "traceId": "uuid",
  "data": {
    "articles": [
      { "lawName":"民法典","articleNo":"第一百四十三条","content":"...","status":"effective",
        "sourceUrl":"https://flk.npc.gov.cn/..." }
    ],
    "lawRefs": [{"ref":"民法典第一百四十三条","verified":true,"title":"民事法律行为的效力"}],
    "disclaimer": "⚠️ 以上内容仅供参考，不构成法律意见，具体问题请咨询专业律师。"
  }
}
```

**`POST /v1/documents`（异步）**

请求：
```jsonc
{ "templateCode":"civil_complaint_divorce",
  "vars":{"plaintiffName":"张三","defendantName":"李四","claim":"...","facts":"...","courtName":"..."} }
```
响应 `202 Accepted`：
```jsonc
{ "code":0,"message":"accepted","traceId":"uuid",
  "data":{ "jobId":"job_xxx","status":"pending","disclaimer":"本文书由 AI 生成，请在提交前由专业律师审核。",
           "pollLocation":"/v1/jobs/job_xxx" } }
```

**`GET /v1/jobs/{jobId}`**

```jsonc
// 进行中
{ "code":0,"data":{ "jobId":"job_xxx","status":"running","progress":0.6,"stage":"rendering" } }
// 完成
{ "code":0,"data":{ "jobId":"job_xxx","status":"succeeded","docId":"doc_xxx",
    "exportLocation":"/v1/documents/doc_xxx","lawRefs":[...],"disclaimer":"..." } }
// 失败
{ "code":0,"data":{ "jobId":"job_xxx","status":"failed","errorCode":3002,"errorMessage":"模板渲染失败" } }
```

### 4.4 错误响应

沿用 06 统一外层：

```jsonc
{ "code": 7004, "message": "输入包含敏感个人信息，外部 agent 不可处理", "traceId":"uuid", "data": null }
```

HTTP 状态码映射：`code 4xx → HTTP 4xx`，`5xx → HTTP 5xx`，`0 → 200/202`。

### 4.5 强制合规约束

- 所有响应 `data` 必须含 `disclaimer` 字段（涉法条响应还须含 `lawRefs`）；网关出口处二次校验，缺失则注入兜底。
- `document.generate` 响应（含异步结果）必须含文书免责，不可由 template 覆盖。
- 响应头追加 `X-Legal-Disclaimer: present` 供调用方快速校验。

## 五、Agent Card 端点

- `GET /v1/agents` — 列出所有对外暴露 agent 的 card 摘要（agentId/name/capabilities/exposure/version）。
- `GET /v1/agents/{agentId}/card` — 完整 Agent Card（含 inputSchema/outputSchema）。
- MCP `tools/list` 返回等价信息（按 MCP tool 格式）。

外部 agent 据此自助发现能力、生成调用代码。

## 六、限流与配额（详见 13）

| 维度 | 默认 | 超限 |
|------|------|------|
| 单外部 agent · L-Read | 1000/小时 | `-32002` / HTTP 429 |
| 单外部 agent · L-Write-Limited | 50/小时 | `-32002` / HTTP 429 |
| 单外部 agent · 并发 | 10 | 429 |
| 全局 · mcpServer | 200 QPS | 429 |

配额按 `externalAgentKey` 维度计，存 `external_agent_credential` 与 Redis/云数据库计数。

## 七、版本管理

- Agent Card `version` 字段语义化版本；不兼容变更升 major。
- MCP tool 名稳定，新增参数向后兼容（可选字段）；破坏性变更新建 tool（如 `law_lookup_v2`）。
- OpenAPI 路径版本 `/v1/`；`/v2/` 用于破坏性变更，`/v1/` 至少维护 12 个月。

## 八、与 v2.0/v2.1/v2.2/v2.3 的关系

- **v2.0**：仅有面向自有小程序的云函数 API（06 第三、四节）。
- **v2.1**：新增面向**外部 agent 与传统系统**的 MCP + OpenAPI 暴露，复用同一套 Agent 实现（11）。错误码（06）扩展 MCP/agent 专用码，不冲突。限流框架（02）扩展按外部 agent 维度，复用同一计数器实现。
- **v2.2（本集）**：在 v2.1 之上新增 7 个 tool.* MCP tools（3.3.7-3.3.13，对应 14 中 7 个 LegalTool）+ 9 个 OpenAPI 端点（4.2 表 v2.2 行）+ 9 个错误码 8001-8009（3.6 表）+ 2 类 Resources（official_query_entry / legal_material）。新增端点均经 `agentDispatcher` 转发，复用 v2.1 鉴权/限流/审计基础设施。MCP tools 总数 6 → 13，OpenAPI 端点总数 10 → 19。
- **v2.3（本集）**：在 v2.2 之上新增 4 个对外 MCP tools（3.3.14-3.3.17：`case.reason`/`case.compare`/`law.apply_check` 归属 reasoning Agent，权威源 16；`clause_recommender` 归属 ToolAgent 第 8 工具，权威源 14 第十一节）+ 6 个 OpenAPI 端点（4.2 表 v2.3 行：4 个 `/v1/lawyer-reviews/*` L-Internal + `/v1/answers/{msgId}/trace` L-Read + `/v1/data-exports` L-Read 异步，权威源 17/03）+ 10 个错误码 8010-8019（3.6 表，权威源 06）。注：`nlu.extract`/`nlu.clarify` 与 `review.*` 3 个 capability 为 L-Internal 不对外，不计入 MCP tools 总数。MCP tools 总数 13 → 17，OpenAPI 端点总数 19 → 25。

## 九、与 11/13/14 的边界

- **11** 定义 Agent 接口与编排；**12** 定义如何把 Agent 暴露给外部；**13** 定义谁可调、调多少、留什么痕；**14**（v2.2 新增）定义 7 个 LegalTool 的接口/schema/算法/评测。
- 四篇权威源：agentId/capability 枚举以 11 为准；MCP tool 名/OpenAPI 端点/传输协议以 12 为准；鉴权/限流配额/审计字段以 13 为准；工具接口与算法以 14 为准。
