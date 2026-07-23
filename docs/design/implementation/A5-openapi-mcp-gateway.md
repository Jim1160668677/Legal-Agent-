# A5 · 对外 API 规约化（25 OpenAPI + 17 MCP）

> 阶段：A5（后端业务补齐第五步） | 对应 v2.3 路线图阶段六对外部分 | 前置依赖：A4（12 Agent + OrchestratorAgent + AgentRegistry）
> 技术栈：NestJS Controller（REST）+ JSON-RPC Controller（MCP）+ ApiKey 鉴权 + 限流
> 目标：把内部 Agent 能力通过 25 个 OpenAPI REST 端点 + 17 个 MCP tools 对外暴露，建立统一鉴权/限流/PII边界/审计入口，为外部 AI agent 与传统系统接入提供标准协议。

---

## 一、范围与目标

| 范围 | 说明 |
|------|------|
| OpenAPI Gateway | 25 个 REST 端点（基础能力 10 + 工具资源 9 + 律师审核溯源导出 6） |
| MCP Server | 17 个 JSON-RPC tools（HTTP+SSE，MCP 2025-03 规范） |
| AgentDispatcher | 统一入口：ApiKey 校验 -> scope 校验 -> PII 边界 -> 限流 -> AgentRegistry.lookup -> invoke -> 审计 |
| 鉴权体系 | 外部 agent 凭证（agentKey + apiKey lak_live_<32位>）+ scope + PII 边界 |
| 限流 | 按 agentKey 维度限流（L-Read / L-Write-Limited 不同配额） |
| 统一响应 | {code, message, traceId, data} 信封 + disclaimer/lawRefs 强制约束 |
| 错误码 | 51 个错误码（11 业务域）+ HTTP 状态映射 |
| 文档端点 | /v1/openapi.json（OpenAPI 3.0）+ /v1/docs（Swagger UI） |

**不在 A5 范围**：外部 agent 运营后台（v2.3 阶段六运营部分）、沙箱环境联调（v2.3 阶段六）、真实外部 agent 接入（MVP 仅预留接口）。

---

## 二、前置依赖

- A4：AgentRegistry + 12 Agent + OrchestratorAgent
- A1：PiiService、AuditLog、CacheService、FeatureFlag
- external_agent_credential / external_agent_registry 集合（05 文档 3.15/3.18）

---

## 三、OpenAPI Gateway（25 个 REST 端点）

### 3.1 基础能力端点（10 个）

| 方法+路径 | 用途 | capability | 鉴权 |
|-----------|------|-----------|------|
| GET /v1/law/articles | 法条查询 | law.lookup | apiKey |
| POST /v1/qa | 法律问答 | legal.qa | apiKey |
| GET /v1/cases | 案例检索 | case.search | apiKey |
| GET /v1/process | 流程指导 | process.guide | apiKey |
| GET /v1/materials | 材料清单 | material.checklist | apiKey |
| POST /v1/documents | 文书生成（异步） | document.generate | apiKey |
| GET /v1/documents/{docId} | 文书导出 | document.export | apiKey + 校验 docId 归属 |
| GET /v1/jobs/{jobId} | 异步任务状态查询 | — | apiKey |
| GET /v1/agents | Agent 列表 | — | apiKey |
| GET /v1/agents/{agentId}/card | AgentCard 详情 | — | apiKey |

### 3.2 工具与资源端点（9 个，v2.2）

| 方法+路径 | 用途 | 鉴权 |
|-----------|------|------|
| POST /v1/tools/period-calculator | 期间计算器 | apiKey |
| POST /v1/tools/document-review | 文书审查 | apiKey |
| POST /v1/tools/compensation-query | 赔偿计算 | apiKey |
| POST /v1/tools/license-ocr | 证照 OCR（L3 PII） | apiKey + scope tool.license_ocr |
| POST /v1/tools/law-validity | 法条效力查询 | apiKey |
| POST /v1/tools/cause-classification | 案由分类（L2 PII） | apiKey |
| POST /v1/tools/sentencing-guide | 量刑指导 | apiKey |
| GET /v1/query-center | 官方查询网址目录 | apiKey（直查 official_query_entry） |
| GET /v1/materials-center | 法规资料目录 | apiKey（直查 legal_material） |

### 3.3 律师审核/溯源/导出端点（6 个，v2.3）

| 方法+路径 | 用途 | 鉴权 |
|-----------|------|------|
| POST /v1/lawyer-reviews | 创建律师审核任务 | 律师端+管理员（L-Internal，拒外部 agent） |
| GET /v1/lawyer-reviews/pending | 律师领取待审列表 | 律师端+管理员 |
| POST /v1/lawyer-reviews/{id}/claim | 律师领取任务 | 律师端 |
| POST /v1/lawyer-reviews/{id}/submit | 律师提交标注 | 律师端 |
| GET /v1/answers/{msgId}/trace | 回答溯源查询 | apiKey + scope case.search 或自有 msgId |
| POST /v1/data-exports | 数据可携带权导出（异步） | userId 本人（非 apiKey） |

### 3.4 Controller 实现

```typescript
// src/modules/legal/gateway/openapi.controller.ts
@ApiKeyGuard()                    // 统一 apiKey 鉴权
@ScopeGuard()                     // capability scope 校验
@UseInterceptors(ResponseInterceptor, AuditInterceptor)
@Controller('v1')
class OpenApiController {
  @Get('law/articles')
  async queryArticles(@Query() dto: QueryLawDto, @Credential() cred: Credential): Promise<Envelope<LawArticle[]>> {
    return this.dispatcher.dispatch('law.lookup', dto, cred);
  }

  @Post('documents')
  @HttpCode(202)                   // 异步返回 202 Accepted
  async generateDocument(@Body() dto: GenerateDocDto, @Credential() cred): Promise<Envelope<{ jobId: string }>> {
    return this.dispatcher.dispatch('document.generate', dto, cred);
  }
  // ... 其余 23 端点
}
```

- 所有端点统一经 AgentDispatcher.dispatch 转发
- 异步端点返回 202 + pollLocation（GET /v1/jobs/{jobId}）
- 响应头强制注入 X-Legal-Disclaimer: present
- 幂等：写操作支持 clientRequestId（1 小时窗口）
---

## 四、MCP Server（17 个 JSON-RPC tools）

### 4.1 协议规范

- 传输：HTTP + SSE（Streamable HTTP，MCP 2025-03-26 规范）
- 协议版本头：MCP-Protocol-Version: 2025-03-26
- 会话：Mcp-Session-Id header，24 小时有效
- 鉴权头：Authorization: Bearer lak_live_<32位>

### 4.2 17 个 MCP tools

| tool name | capability | 对应 OpenAPI 端点 |
|-----------|-----------|------------------|
| law_lookup | law.lookup | GET /v1/law/articles |
| legal_qa | legal.qa | POST /v1/qa |
| case_search | case.search | GET /v1/cases |
| process_guide | process.guide | GET /v1/process |
| material_checklist | material.checklist | GET /v1/materials |
| document_generate | document.generate | POST /v1/documents |
| document_export | document.export | GET /v1/documents/{docId} |
| case_analyze | case.analyze | （异步，POST -> 轮询） |
| tool_period_calculator | tool.period_calculator | POST /v1/tools/period-calculator |
| tool_law_validity | tool.law_validity | POST /v1/tools/law-validity |
| tool_cause_classification | tool.cause_classification | POST /v1/tools/cause-classification |
| tool_compensation_query | tool.compensation_query | POST /v1/tools/compensation-query |
| case_reason | case.reason | （v2.3 推理，异步） |
| case_compare | case.compare | （v2.3 推理） |
| law_apply_check | law.apply_check | （v2.3 推理） |
| clause_recommender | tool.clause_recommender | （v2.3 第 8 工具） |
| jobs_get | — | GET /v1/jobs/{jobId} |

另含 2 resources（law_article / case_precedent 只读）+ 2 prompts（legal_qa / document_generate 模板）。

### 4.3 JSON-RPC 实现

```typescript
// src/modules/legal/gateway/mcp.controller.ts
@Controller('mcp')
class McpController {
  @Post()
  async handleJsonRpc(@Body() body: JsonRpcRequest, @Headers() headers): Promise<JsonRpcResponse | void> {
    switch (body.method) {
      case 'tools/list': return this.listTools(headers);           // 从 AgentRegistry.listCards
      case 'tools/call': return this.callTool(body.params, headers); // -> AgentDispatcher.dispatch
      case 'resources/list': ...
      case 'resources/read': ...
      case 'notifications/progress': ...   // SSE 推送异步任务进度
      case 'jobs/get': ...
    }
  }
}
```

- tools/list 从 AgentRegistry.listCards(exposure=L-Read|L-Write-Limited) 生成
- tools/call 经 AgentDispatcher 统一调度
- 异步任务通过 SSE notifications/progress 推送进度，完成时 notifications/job_done

---

## 五、AgentDispatcher（统一调度入口）

```typescript
// src/modules/legal/gateway/agent-dispatcher.service.ts
class AgentDispatcher {
  async dispatch(capability: string, params: object, cred: Credential): Promise<AgentInvokeOutput> {
    // 1. ApiKey 校验（external_agent_credential 集合）
    const credential = await this.verifyApiKey(cred.apiKey);     // 失败抛 -32001
    // 2. scope 校验（凭证须含目标 capability）
    this.assertScope(credential.scopes, capability);             // 失败抛 7002
    // 3. PII 边界检测
    const piiLevel = this.pii.classify(JSON.stringify(params));
    this.pii.assertBoundary(piiLevel, credential.allowedPiiLevel); // 失败抛 7004
    // 4. 限流（按 agentKey 维度）
    await this.rateLimit.check(credential.agentKey, capability);  // 超限抛 -32002 / 4291
    // 5. AgentRegistry.lookup
    const agent = this.registry.lookup(capability);               // 未找到抛 7001
    // 6. agent.invoke
    const ctx = this.buildContext(credential);
    const result = await agent.invoke({ capability, params, piiLevel }, ctx);
    // 7. 审计写入 agent_invoke
    await this.audit.write('agent_invoke', { caller: credential.agentKey, targets: [agent.card.agentId], result: result.ok ? 'success' : 'failed' }, ctx);
    // 8. 出口校验 disclaimer + lawRefs
    this.assertOutputSchema(result);                              // 缺失注入兜底免责 + 告警
    return result;
  }
}
```

---

## 六、鉴权体系

### 6.1 外部 agent 凭证

```typescript
// external_agent_credential 集合
interface ExternalAgentCredential {
  agentKey: string;               // 'tianyan-enterprise'
  displayName: string;
  apiKeyPrefix: string;           // 'lak_live_abcd'（前8位明文，用于识别）
  apiKeyHash: string;             // bcrypt(apiKey)
  scopes: string[];               // ['law.lookup', 'legal.qa', 'case.search']
  exposureLevel: 'L-Read' | 'L-Write-Limited';
  rateLimits: { perMin: number; perDay: number };
  status: 'active' | 'revoked';
  validUntil: Date;
}
```

- API Key 格式：lak_live_<32位随机>
- 申请-审批流程：MVP 阶段预留接口与集合，A5 不建运营后台
- 凭证吊销即时生效（status=revoked 后下次调用返回 -32001）

### 6.2 三层鉴权守卫

| Guard | 职责 | 失败错误码 |
|-------|------|-----------|
| ApiKeyGuard | 校验 lak_live_ 凭证有效性 | -32001 |
| ScopeGuard | 校验凭证 scope 含目标 capability | 7002 |
| PiiLevelGuard | 校验输入 PII 级别不超界 | 7004 |
| RoleGuard | 律师端/管理员角色校验（律师审核端点） | 4032 |
| OwnerGuard | 资源归属校验（docId/msgId） | 4031 |

### 6.3 内部用户鉴权（保留）

- /v1/data-exports 按 userId 本人鉴权（非 apiKey）
- 律师审核 4 端点按律师端 + 管理员角色鉴权（L-Internal 拒外部 agent）
---

## 七、统一响应格式

### 7.1 外层信封

```json
{
  "code": 0,
  "message": "ok",
  "traceId": "uuid",
  "data": { ... }
}
```

### 7.2 data 字段（AgentInvokeOutput）

```json
{
  "ok": true,
  "data": { /* 按 capability outputSchema */ },
  "lawRefs": [{ "ref": "民法典第一百四十三条", "verified": true, "title": "民事法律行为的效力" }],
  "disclaimer": "以上内容仅供参考，不构成法律意见……",
  "verified": true,
  "jobId": "job_xxx",
  "usage": { "durationMs": 120, "tokensIn": 0, "tokensOut": 0, "cacheHit": "L3" },
  "errorCode": 0,
  "errorMessage": ""
}
```

### 7.3 强制约束

- 三字段必填：所有 MCP tool 与 Agent 输出 outputSchema 必含 disclaimer + lawRefs + traceId
- 网关出口二次校验：缺失则注入兜底免责 + 告警（agent_degradation reason=missing_disclaimer）
- OpenAPI 响应头 X-Legal-Disclaimer: present（便于调用方程序化校验）
- 工具类 tool 的 lawRefs 不涉法条时可为空数组，但 disclaimer 必填

---

## 八、错误码体系（11 业务域，51 个）

| 域 | 码段 | 示例 | HTTP |
|----|------|------|------|
| 通用参数文件 | 1xxx | 1001 参数非法 / 1002 文件类型 / 1003 文件超限 | 400 |
| 资源 | 2xxx | 2001 资源不存在 | 404 |
| 文书渲染 | 3xxx | 3001 变量校验失败 / 3002 渲染失败 | 422 |
| NLU/法条校验 | 4xxx | 4001 意图失败 / 4002 法条校验未通过 | 422 |
| 鉴权权限 | 40xx/4291 | 4011 未登录 / 4031 横向越权 / 4032 纵向越权 / 4291 限流 | 401/403/429 |
| LLM 上游 | 5xxx | 5001 内部错误 / 5002 上游错误 / 5003 降级中 / 5004 超时 | 500/502/503/504 |
| OCR/内容安全 | 6xxx | 6001 OCR 失败 / 6002 内容安全拦截 | 422 |
| JSON-RPC 协议 | -32xxx | -32700 parse / -32601 not found / -32001 未授权 / -32002 MCP限流 | — |
| 外部 Agent | 7xxx | 7001 agent不存在 / 7002 越权 / 7003 超时 / 7004 PII边界 / 7005 内容安全 / 7006 法条校验失败 | 404/403/504/422 |
| 工具 | 8001-8007 | 8001 入参非法 / 8002 工具不存在 / 8003 执行失败 / 8004 OCR无结果 / 8005 法条无结果 / 8006 案由低置信 / 8007 量刑要素不足 | 400/404/422 |
| NLU/安全/律师/溯源/文书版本 | 8010-8019 | 8010 NER失败 / 8011 澄清超时 / 8012 敏感操作 / 8013 合规拦截 / 8014-8016 律师审核 / 8017 溯源不存在 / 8018 版本冲突 / 8019 要件不足 | 500/408/403/422/404/409 |

NestJS 实现：ErrorCode 枚举常量 + 领域异常类（如 LawRefValidationError -> 4002）+ HttpExceptionFilter 映射 HTTP 状态。

---

## 九、限流

### 9.1 配额（按 agentKey 维度）

| 维度 | 默认配额 | 超限行为 |
|------|----------|----------|
| L-Read agentKey | 100 次/分钟 | -32002（MCP）/ 4291（OpenAPI） |
| L-Write-Limited agentKey | 10 次/分钟 | -32002 / 4291 |
| 单 agentKey/天 | 10000 次 | 4291 |

### 9.2 实现

- @nestjs/throttler + Redis 计数（按 agentKey + 分钟 bucket）
- 响应头：X-RateLimit-Limit / X-RateLimit-Remaining / X-RateLimit-Reset
- 凭证 rateLimits 字段可覆盖默认配额（审批时设定）

---

## 十、涉及集合（A5 新增/扩展）

| 集合 | A5 变更 |
|------|---------|
| external_agent_credential | 新建，外部 agent 凭证（agentKey/apiKeyHash/scopes/exposureLevel/rateLimits/status） |
| external_agent_registry | 新建，可信外部 agent 目录（agentKey/endpoint/protocol/capabilities/authType/status） |
| agent_invocation_log | 复用 A4，外部 agent 调用记录（callerAgentId='external:<agentKey>'） |
| audit_log | 复用 A1，外部 agent 调用审计 |

---

## 十一、验收标准

| # | 标准 | 验证方式 |
|---|------|---------|
| 1 | 25 OpenAPI 端点 100% 覆盖 | OpenAPI schema validator |
| 2 | /v1/openapi.json 可被 Swagger UI 渲染 | 浏览器验证 |
| 3 | 17 MCP tools schema 100% 合规（含 disclaimer/lawRefs/traceId） | MCP Inspector |
| 4 | tools/list 与 tools/call 端到端联调通过 | MCP Inspector 18 用例（6 tools × 正常/边界/非法） |
| 5 | ApiKey 鉴权：有效凭证通过，无效/吊销返回 -32001 | 安全测试 |
| 6 | scope 校验：L-Read 凭证调 L-Write 端点返回 7002 | 安全测试 |
| 7 | PII 边界：L4 输入被拒 7004 | 安全测试 |
| 8 | 限流：超限返回 4291 / -32002 + X-RateLimit 头 | 压测 |
| 9 | 律师审核端点拒外部 agent（L-Internal） | 安全测试 |
| 10 | 异步端点返回 202 + pollLocation，轮询 GET /v1/jobs/{jobId} | 集成测试 |
| 11 | 响应头 X-Legal-Disclaimer: present 100% 注入 | 集成测试 |
| 12 | outputSchema 缺 disclaimer -> 兜底注入 + 告警 | 故障注入 |
| 13 | 幂等：clientRequestId 1 小时窗口内重复返回同结果 | 集成测试 |
| 14 | 错误码 51 个 HTTP 状态映射正确 | 单测 |
| 15 | 律师审核 4 端点状态机正确（pending->claimed->submitted） | 集成测试 |

---

## 十二、风险与对策

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| 外部 agent 滥用（高频调用） | 中 | 中 | 按 agentKey 限流 + 配额审批 + 监控告警 |
| PII 跨 agent 泄漏 | 低 | 极高 | 入口 PiiService 检测 + 出口二次脱敏 + 7004 拦截 + 审计 |
| MCP 协议升级不兼容 | 低 | 中 | 协议版本固定 + tools 名稳定 + 破坏性变更新建 tool |
| 外部 agent 故障传染 | 中 | 中 | 外部 agent 不可达返回 7003 + 不影响内部编排 |
| 法律类 App 内容合规风险 | 高 | 高 | 强制 disclaimer + 内容安全 + 合规 block + 引导律师 |
| 错误码体系复杂度 | 中 | 低 | ErrorCode 枚举 + 领域异常类 + 单测全覆盖 |

---

## 十三、交付物清单

- OpenApiController（25 REST 端点）
- McpController（17 tools + 2 resources + 2 prompts，JSON-RPC）
- AgentDispatcher（统一调度：ApiKey/scope/PII/限流/审计）
- 5 个 Guard（ApiKey/Scope/PiiLevel/Role/Owner）
- ErrorCode 枚举 + 领域异常类 + HttpExceptionFilter
- 限流模块（@nestjs/throttler + Redis）
- /v1/openapi.json + /v1/docs Swagger UI
- external_agent_credential / external_agent_registry schema
- MCP Inspector 联调报告

**预计工期**：4 周（与 v2.3 阶段六对外部分一致）。

---

## 十四、A1-A5 总览与后续衔接

| 阶段 | 工期 | 核心交付 | 状态 |
|------|------|---------|------|
| A1 | 4 周 | NestJS 工程 + 意图识别 + 三层混合基础 | 设计完成 |
| A2 | 4 周 | 知识库 + 混合检索 + 向量索引 | 设计完成 |
| A3 | 4 周 | 文书生成 + LLM 增强 + 导出 | 设计完成 |
| A4 | 4 周 | 12 Agent + OrchestratorAgent + 降级 | 设计完成 |
| A5 | 4 周 | 25 OpenAPI + 17 MCP + 鉴权限流 | 设计完成 |
| **合计** | **20 周** | **后端业务补齐完毕，可进入阶段 B（RN 前端）** | — |

**后续衔接**：
- 阶段 B（React Native 前端）：基于 A1-A5 的 API 开发 RN App
- 阶段 C（上架执行）：兼容性测试 -> 上架材料 -> 签名打包 -> 提交审核 -> 处理驳回
- v2.3 阶段七~十（可选增强）：7 LegalTool + 知识采集 + NLU + IRAC 推理 + 律师审核闭环，可在 App 上架后迭代

**关键提醒**：法律类 App 在 App Store 审核极严，A5 的强制 disclaimer + 合规 block + 内容安全机制是应对审核驳回的核心防线，必须在阶段 C 上架前完成验证。
