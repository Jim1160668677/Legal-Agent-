# legal-agent 下一步功能开发与完善计划

> 制定日期：2026-07-24 | 基线：v2.3 设计文档集（A1-A5 + 00-17） | 当前进度：LLM 接入层完成（15 源文件 / 105 测试）
> 目标：从"纯 LLM 库"演进为"可独立部署的 NestJS 法律 AI 服务"，贯通 A1-A5 全链路

---

## 一、执行摘要

### 1.1 当前状态

| 维度 | 现状 | 占 A1-A5 目标比例 |
|------|------|------------------|
| 源文件 | 15 个（src/services/legal/llm/* + src/config/* + src/types/llm.ts） | ~5% |
| 已实现能力 | LlmService 多供应商框架（Agnes 接入：generate/stream/validateLawRefs 桩） | L4 能力层 1/11 |
| 测试用例 | 105 个（76 unit + 23 integration + 6 e2e） | — |
| 工程基建 | ESLint 9 + Prettier 3 + CI + git（commit 852c061） | 脚手架完成 |
| NestJS 骨架 | 未开始 | 0% |
| 意图识别 | 未开始 | 0% |
| 知识库/检索 | 未开始 | 0% |
| 文书生成 | 未开始 | 0% |
| Agent 编排 | 未开始 | 0% |
| 对外 API | 未开始 | 0% |

### 1.2 核心结论

当前项目仅完成 **A3 的前置子模块**（LlmService 接入 Agnes），A1-A5 全链路待开发。下一步必须从 **A1（NestJS 骨架 + 意图识别 + 三层混合基础）** 启动，因为 A2-A5 全部依赖 A1 的工程骨架与平台横切模块。

### 1.3 开发优先级总览

| 优先级 | 阶段 | 工期 | 核心交付 | 阻塞关系 |
|--------|------|------|---------|---------|
| **P0** | A1 NestJS 骨架 + 意图识别 + 三层混合 | 4 周 | 可独立启动的 NestJS 服务 + chat SSE | 起点，无依赖 |
| P1 | A2 知识库 + 混合检索 | 4 周 | RagService + 向量索引 + 5000 法条 | 依赖 A1 |
| P1 | A3 文书生成 + LLM 增强 | 4 周 | DocumentGenerator + Prompt/缓存/熔断 | 依赖 A1+A2 |
| P2 | A4 多 Agent 编排 | 4 周 | 12 Agent + OrchestratorAgent | 依赖 A1-A3 |
| P2 | A5 对外 API 规约化 | 4 周 | 25 OpenAPI + 17 MCP | 依赖 A4 |

**总工期 20 周**，可进入阶段 B（React Native 前端）与阶段 C（上架执行）。
---

## 二、现有功能评估

### 2.1 已实现功能清单（LLM 接入层）

| 模块 | 文件 | 功能 | 质量评级 |
|------|------|------|---------|
| LlmService 门面 | src/services/legal/llm.ts | generate/stream/validateLawRefs/complete | ✅ 优（契约清晰） |
| AgnesProvider | src/services/legal/llm/agnesProvider.ts | OpenAI 兼容协议接入 | ✅ 优（协议透明） |
| ProviderRegistry | src/services/legal/llm/registry.ts | 多供应商注册/切换 | ✅ 优（可扩展） |
| HTTP 封装 | src/services/legal/llm/http.ts | fetch + 超时 + AbortController 合并 + 错误映射 | ✅ 优（超时控制完善） |
| SSE 解析 | src/services/legal/llm/sse.ts | 流式分片解析 | ✅ 优 |
| 指数退避重试 | src/services/legal/llm/retry.ts | 可重试错误判定 + ±25% 抖动 + Retry-After 尊重 | ✅ 优（防惊群） |
| 错误层级 | src/services/legal/llm/errors.ts | 7 类错误（auth/invalid_request/rate_limit/api/timeout/network/parse） | ✅ 优（kind+retryable） |
| 法条提取 | src/services/legal/llm/lawRefExtractor.ts | 正则提取法条引用 | ⚠️ 桩（仅提取不核实） |
| QwenProvider | src/services/legal/llm/qwenProvider.ts | 桩（抛 NotImplementedError） | ⚠️ 预留 |
| 配置 | src/config/ | dotenv + 校验 | ✅ 优 |

### 2.2 性能瓶颈识别

| # | 瓶颈点 | 位置 | 影响 | 严重度 | 改进措施 |
|---|--------|------|------|--------|---------|
| P-1 | **无 LLM 响应缓存** | llm.ts generate() | 相同 prompt 重复调用消耗 token，响应慢 | 中 | A3 接入 llm_cache（promptHash→response，TTL 7d），目标命中率 ≥25% |
| P-2 | **validateLawRefs 全量 unverified** | llm.ts L40-47 | 法条引用无法核实，降级展示影响可信度 | 中 | A2 完成 law_article 集合后，核实逻辑由库内核实补全 |
| P-3 | **无熔断机制** | 无 | LLM 上游故障时无快速失败，请求堆积 | 中 | A3 实现 CircuitBreaker（错误率>30% 触发，60s 半开探测） |
| P-4 | **流式输出无首 token 延迟优化** | agnesProvider stream | 当前 409ms 首 token（可接受），但无 prompt 长度控制 | 低 | A3 Prompt 模板上下文裁剪 |
| P-5 | **集成测试串行执行** | vitest.config fileParallelism:false | 23 集成测试顺序跑较慢（~30s） | 低 | 保持（避免 Agnes 免费用户 429 限流），生产凭证后可并行 |

### 2.3 潜在 Bug 识别

| # | 问题 | 位置 | 风险 | 复现条件 | 修复方案 |
|---|------|------|------|---------|---------|
| B-1 | **validateLawRefs 桩返回空 verified** | llm.ts L43 | 法条引用全部标记"未核实"，LLM 输出可信度降低 | 任何含法条的 LLM 输出 | A2 实现后改为查 law_article 集合核实 |
| B-2 | **QwenProvider stream 的 require-yield** | qwenProvider.ts L34 | ESLint 已 disable，但调用方迭代即抛（设计如此） | 切换到 qwen 供应商并 stream | 保持桩状态，A3+ 如需 Qwen 再实现 |
| B-3 | **超时 AbortController 未处理 unhandledRejection** | http.ts（潜在） | 若 fetch 在 abort 后仍 reject，可能触发 unhandledRejection 警告 | 高并发超时场景 | A1 实施时审查 fetch abort 后的 promise 链 |
| B-4 | **lawRefExtractor 正则边界** | lawRefExtractor.ts | 复杂法条引用格式（如"《民法典》第143条至第145条"）可能漏提取 | 区间法条引用 | A2 评测集驱动补全正则 |

### 2.4 用户体验问题（API 层）

| # | 问题 | 影响 | 改进措施 |
|---|------|------|---------|
| U-1 | **无 /health 端点** | 无法探活，K8s/负载均衡无法健康检查 | A1 §十三验收标准第 1 项：/health 返回 200 |
| U-2 | **无统一错误信封** | 调用方需处理多种错误格式 | A1 全局 HttpExceptionFilter → {code,message,traceId,data:null} |
| U-3 | **无 SSE 帧序列规范文档** | 前端难以实现流式消费 | A1 §十定义帧序列 [chunk]*→[meta]→[disclaimer]→[done] |
| U-4 | **无免责声明强制注入** | 法律合规风险 | A1 ChatController 出口强制注入 + 网关二次校验 |
| U-5 | **无审计日志** | 无法追溯调用链 | A1 AuditLog（异步非阻塞，traceId 贯穿） |
---

## 三、A1 详细开发计划（P0 · 4 周）

> A1 是下一步立即启动的核心阶段。本节按周拆解任务、需求、技术方案、验收。

### A1-W1：NestJS 工程骨架 + 配置 + MongoDB/Redis 接入

**需求**：
- 创建 NestJS 10 应用（main.ts + app.module.ts）
- @nestjs/config + Joi 配置校验（env/port/mongo/redis/jwt/llm/rateLimit）
- MongooseModule.forRootAsync + 9 个 schema（user_profile/dialog_record/law_article/legal_knowledge/intent_eval_set/audit_log/feature_flag/llm_cache/feedback）
- Redis 接入（ioredis，L2 缓存）
- 全局管道/过滤器/拦截器（ValidationPipe + HttpExceptionFilter + ResponseInterceptor）

**技术方案**：
```
src/
├── main.ts                      # helmet + cors + ValidationPipe + 全局过滤器
├── app.module.ts                # 根模块（ConfigModule + MongooseModule + RedisModule）
├── config/configuration.ts      # registerAs('app') + Joi schema
├── common/
│   ├── filters/http-exception.filter.ts
│   ├── interceptors/response.interceptor.ts
│   └── pipes/                   # ValidationPipe 全局
└── infra/
    ├── database/schemas/        # 9 个 Mongoose schema
    └── database/database.module.ts
```

**验收**：
- `npm run start:dev` 服务启动，`GET /health` 返回 200
- MongoDB 连接成功（9 集合可读写）
- Redis 连接成功（set/get 测试通过）
- 配置缺失时 Joi 抛错（启动失败而非静默）

**新增依赖**：@nestjs/core @nestjs/common @nestjs/config @nestjs/mongoose mongoose ioredis joi helmet

### A1-W2：平台横切模块（7 个）

**需求与方案**：
| 模块 | 需求 | 技术方案 |
|------|------|---------|
| AuthService | JWT 鉴权替代 openid | passport-jwt + @nestjs/jwt；access 7d / refresh 30d；mapExternalIdentity 保留微信映射 |
| PiiService | PII 分级 + 脱敏 + L4 加密 | L1-L4 分级；AES-256-GCM 加密；手机号→138****1234 |
| AuditLog | 异步审计（不阻塞主流程） | setImmediate 写 audit_log；traceId 贯穿 |
| Logger | 结构化 JSON 日志 | Pino（性能优于 Winston）；AsyncLocalStorage 传 traceId |
| CacheService | L2 Redis + L3 llm_cache | get/set + getLlmCache + invalidateByLawArticle |
| FeatureFlag | 灰度开关 | feature_flag 集合；userId 哈希取模（替代 openid 哈希） |
| ContentSafety | 内容安全（可插拔） | ContentSafetyProvider 接口；默认腾讯云；命中抛 6002 |

**验收**：
- 7 模块单测覆盖率 ≥ 80%
- JWT 签发/校验/过期/刷新链路通
- PiiService 加密/解密往返一致
- AuditLog 异步写入不阻塞（主流程 < 5ms 增量）

### A1-W3：IntentRouter + RuleEngine + MemoryManager

**需求**：

**IntentRouter**（核心，对齐 07 §一）：
- 8 IntentType：legal_qa/document_generate/process_guide/case_analysis/case_reasoning/material_checklist/tool_invoke/general_qa
- 打分算法：score = Σ(kw.weight × idf × positionBoost) + Σ(pattern.weight × 1.5) + contextBonus
- 置信度路由：≥0.8 直路由；0.5-0.8 LLM 辅助；<0.5 → general_qa
- data/legalIntents.ts 关键词库（8 意图 × 关键词+正则+categoryHints）

**RuleEngine**（规则层）：
- data/lawArticles.ts 常用 200 条法条快取（内存 Map）
- 法条名+条号或关键词精确匹配
- 命中即返回（不向下走，成本最优）

**MemoryManager**：
- dialog_record 读写（TTL 90 天）
- getRelevantMemories（最近 3 轮 + 用户偏好）

**验收**：
- intent_eval_set ≥ 200 条种子数据导入
- top-1 准确率 ≥ 80%（intent-eval 脚本）
- 规则层法条查询 < 100ms
- 6 意图可识别（tool_invoke/case_reasoning 桩路由）

### A1-W4：ChatController（SSE）+ 迁移现有 LlmService + 评测

**需求**：
- ChatController `POST /v1/chat`（SSE 流式）
- 三层混合降级链：rule→knowledge(占位)→llm→人工引导
- **迁移现有 src/services/legal/llm/* 到 NestJS Provider**（原样复用，105 测试不回归）
- 法条引用校验 validateLawRefs（复用现有，仍为桩）
- 免责声明强制注入
- intent-eval.ts 评测脚本 + CI 集成

**技术方案**：
```typescript
@Post('v1/chat')
@UseGuards(JwtAuthGuard)
async chat(@Body() dto: ChatDto, @CurrentUser() user, @Res() res: Response) {
  // SSE 帧序列：[chunk]* → [meta] → [disclaimer] → [done]
}
```

**迁移要点**：
- 现有 LlmServiceImpl 注入为 @Injectable() Provider
- 现有 105 测试保留在 tests/（vitest），NestJS 模块测试新增（Jest）
- 两套测试并行（A1 §十四风险对策）

**验收**（A1 §十三 10 项标准）：
1. NestJS 启动 /health 200 ✅
2. 8 意图识别 top-1 ≥ 80% ✅
3. POST /v1/chat SSE 首 token < 1s ✅
4. 规则层 < 100ms ✅
5. 免责声明 100% 附加 ✅
6. 审计日志写入 ✅
7. JWT 鉴权 + 越权 4031/4032 ✅
8. LLM 降级链生效 ✅
9. intent_eval_set 200 条 ✅
10. **现有 105 测试无回归** ✅
---

## 四、A2-A5 框架计划

### A2 知识库 + 混合检索（P1 · 4 周，依赖 A1）

| 周 | 任务 | 交付物 |
|----|------|--------|
| W1 | KnowledgeBase + legal_knowledge 数据导入（四类流程/材料清单） | KnowledgeBase 模块 + 数据导入脚本 |
| W2 | EmbeddingService + 向量索引（Atlas Vector Search 首选） | EmbeddingService + 索引定义 |
| W3 | RagService 三路召回（BM25+向量+结构化）+ RRF 融合 | RagService.retrieve + RRF 算法 |
| W4 | LawUpdatePipeline 雏形 + 检索评测（50 题金标） | retrieval-eval.ts + Recall@10 ≥ 0.85 |

**关键决策点**：MongoDB Atlas Vector Search（M10+，$60/月）vs Milvus 外挂（开源）。MVP 选 Atlas，规模>50万条迁 Milvus。

**数据需求**：law_article ≥ 5000 条（国家法律法规数据库）、case_precedent ≥ 2000 条（裁判文书网脱敏）。

### A3 文书生成 + LLM 增强（P1 · 4 周，依赖 A1+A2）

| 周 | 任务 | 交付物 |
|----|------|--------|
| W1 | PromptRegistry + LlmService 缓存接入（llm_cache）+ CircuitBreaker | LlmService 增强（现有 105 测试无回归） |
| W2 | DocumentGenerator（DSL 解析 + 变量填充 + 校验） | DocumentGenerator + 4 类模板 |
| W3 | ExportService（docx/pdf + ObjectStorage 抽象） | ExportService + S3/OSS/MinIO 适配器 |
| W4 | JobService 雏形 + 文书评测（20 用例） | 异步文书生成 + document-eval.ts |

**关键决策点**：对象存储选型（S3/阿里云 OSS/MinIO）。开发环境用 MinIO，生产用 S3 或 OSS。

**LLM 层改进**（本阶段闭环 P-1/P-3）：
- 缓存接入：promptHash = sha256(prompt+model+promptVersion)，TTL 7d，命中率 ≥25%
- 熔断：错误率>30%（1 分钟窗口）触发，60s 半开探测，状态存 system_status + Redis

### A4 多 Agent 编排（P2 · 4 周，依赖 A1-A3）

| 周 | 任务 | 交付物 |
|----|------|--------|
| W1 | LegalAgent 接口 + AgentCard + AgentRegistry | agents/types.ts + registry.ts |
| W2 | 8 核心 Agent 包装层（基于 A1-A3 L4 模块） | law-lookup/legal-qa/case-search/process-guide/document/case-analysis/memory/orchestrator |
| W3 | OrchestratorAgent + 7+1 编排计划映射 | orchestrator.ts（**含 A4-N1 修正：补 tool_invoke 计划**） |
| W4 | 4 桩 Agent + JobService 扩展 + 降级链 + 编排评测 | tool/nlu/reasoning/lawyer-review 桩 + 70 用例 |

**A4-N1 修正**（评审报告 P0）：补充 tool_invoke 编排计划（单 agent 直调 tool Agent，命中即返），验收标准改 8 IntentType。

### A5 对外 API 规约化（P2 · 4 周，依赖 A4）

| 周 | 任务 | 交付物 |
|----|------|--------|
| W1 | AgentDispatcher + 5 Guard（ApiKey/Scope/PiiLevel/Role/Owner） | 统一调度入口 + 鉴权体系 |
| W2 | OpenApiController（25 端点）+ /v1/openapi.json | 25 REST 端点 + Swagger UI |
| W3 | McpController（17 tools + 2 resources + 2 prompts） | JSON-RPC + SSE（**含 A5-N1 修正：对齐 tools 与端点**） |
| W4 | 限流 + 错误码 51 个 + MCP Inspector 联调 | @nestjs/throttler + Redis + 联调报告 |

**A5-N1 修正**（评审报告 P0）：补全 MCP tools 至 22 个（17+5），或明确说明"仅 4 高频工具暴露 MCP"；clause_recommender 补 OpenAPI 端点或从 MCP 移除。

---

## 五、现有 LLM 层改进措施

### 5.1 短期改进（A1 阶段同步完成）

| # | 改进项 | 措施 | 验证 | 时机 |
|---|--------|------|------|------|
| I-1 | validateLawRefs 桩 | A1 阶段保持桩，A2 接 law_article 后改为 DB 核实 | A1: 全 unverified；A2: verified 准确率 100% | A1→A2 |
| I-2 | 无审计日志 | A1 迁移时将 LlmService 注入 AuditLog，记录 llm_call 事件 | 审计日志含 promptHash/duration/tokens | A1-W4 |
| I-3 | 无 /health | A1 main.ts 添加 HealthController | GET /health 200 | A1-W1 |
| I-4 | 无统一错误信封 | A1 HttpExceptionFilter | {code,message,traceId,data:null} | A1-W1 |

### 5.2 中期改进（A3 阶段完成）

| # | 改进项 | 措施 | 验证 | 时机 |
|---|--------|------|------|------|
| I-5 | 无 LLM 缓存 | A3 接入 llm_cache（promptHash→response） | 命中率 ≥25% | A3-W1 |
| I-6 | 无熔断 | A3 CircuitBreaker（错误率>30% 触发） | 故障注入测试通过 | A3-W1 |
| I-7 | 无 Prompt 模板管理 | A3 PromptRegistry + 版本 + 灰度 | 模板渲染 + 缺失变量校验 | A3-W1 |

### 5.3 潜在 Bug 修复时机

| Bug | 修复时机 | 方式 |
|-----|---------|------|
| B-1（validateLawRefs 桩） | A2 | 接 law_article 集合核实 |
| B-3（abort unhandledRejection） | A1-W4 | 审查 fetch abort promise 链 + 集成测试 |
| B-4（lawRefExtractor 区间法条） | A2 | 评测集驱动补全正则 |
---

## 六、质量保障：编码规范与测试策略

### 6.1 编码规范保障（已就绪）

| 规范 | 工具 | 配置 | CI 门禁 |
|------|------|------|---------|
| 代码风格 | ESLint 9 flat config | eslint.config.mjs（no-unused-vars error / consistent-type-imports error / no-console warn） | ✅ npm run lint 0 errors |
| 格式化 | Prettier 3 | .prettierrc.json（semi/singleQuote/trailingComma:all/printWidth:100） | ✅ npm run format:check |
| 类型安全 | TypeScript 5 | tsconfig.json（strict） | ✅ npm run typecheck |
| 提交规范 | git | 初始 commit 852c061 | 每次 PR 经 CI |

**A1 实施时规范延续**：
- 所有新文件需通过 lint + format:check + typecheck
- NestJS 模块遵循 `src/modules/{domain}/` 结构，禁止反向依赖
- 禁止 `any`（ESLint warn，建议改 unknown 或具体类型）
- 测试文件 console 允许（eslint override），生产代码仅 console.warn/error

### 6.2 测试策略

| 层级 | 工具 | 范围 | 覆盖率目标 | CI 触发 |
|------|------|------|-----------|---------|
| 单元测试 | vitest（现有 llm 层）+ Jest（NestJS 模块） | 纯逻辑模块 | 行 ≥80%，分支 ≥70% | 每次 push |
| 集成测试 | vitest + 内存 MongoDB（mongodb-memory-server） | 跨模块流程 | 核心流程端到端 | 每次 push |
| E2E 测试 | supertest + NestJS app | API 端点 | 主流程 | 每次 push |
| 评测测试 | 自研 eval 脚本 | 意图/检索/文书准确率 | 见各阶段验收 | 手动 + 周度 |

**A1 测试新增计划**：
- tests/unit/nestjs/：7 平台横切模块单测（Jest）
- tests/integration/：chat SSE 端到端 + 三层降级链
- tests/eval/intent-eval.ts：200 条 intent_eval_set 评测
- **现有 tests/unit/* + tests/integration/agnes/* + tests/e2e/* 保留不回归**

**双测试框架共存**（A1 §十四风险对策）：
- vitest 跑现有 llm 层（76 unit + 23 integration + 6 e2e）
- Jest 跑 NestJS 模块测试
- CI 两个 job 并行：`test:unit`（vitest）+ `test:nestjs`（Jest）

### 6.3 CI 流程增强

当前 CI（4 道门禁）：lint + format:check + typecheck + test:unit

A1 实施后 CI 增强：
```yaml
jobs:
  quality:        # lint + format + typecheck（现有）
  test-llm:       # vitest 跑现有 llm 层 105 用例
  test-nestjs:    # Jest 跑 NestJS 模块测试
  test-e2e:       # supertest 跑 API 端到端
  # 评测测试手动触发（避免消耗 Agnes tokens）
```

---

## 七、关键决策点（需确认）

以下决策影响 A1-A5 实施细节，建议在对应阶段启动前确认：

| # | 决策点 | 选项 | 影响 | 建议默认 | 确认时机 |
|---|--------|------|------|---------|---------|
| D-1 | MongoDB 部署 | Atlas M10+（托管）/ 自建（运维成本） | A1 接入 + A2 向量检索 | Atlas M10（简化运维） | A1-W1 前 |
| D-2 | Redis 部署 | 托管（Redis Cloud）/ 自建 | A1 缓存+限流 | 自建（开发）+ 托管（生产） | A1-W1 前 |
| D-3 | 对象存储 | S3 / 阿里云 OSS / MinIO | A3 文书导出 | MinIO（开发）+ OSS（生产，国内合规） | A3-W3 前 |
| D-4 | 向量索引 | Atlas Vector Search / Milvus | A2 检索性能+成本 | Atlas（MVP）→ Milvus（>50万条） | A2-W2 前 |
| D-5 | 内容安全 Provider | 腾讯云 / 阿里云绿网 | A1 ContentSafety | 腾讯云（默认） | A1-W2 前 |
| D-6 | JWT 短信登录 | A1 密码登录占位 / 直接接短信网关 | A1 AuthService | 密码登录占位（A4 接短信） | A1-W2 前 |
| D-7 | 测试框架 | vitest+Jest 双框架 / 全迁 Jest | A1 测试基建 | 双框架并行（现有不回归） | A1-W1 前 |

---

## 八、风险与对策

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| 意图识别准确率不达标 | 中 | 高 | 评测集先行（200 条）；失败案例回流；关键词库两周一迭代 |
| vitest 与 NestJS Jest 冲突 | 中 | 低 | 双框架并行（vitest 跑 llm 层，Jest 跑模块）；CI 分 job |
| MongoDB 连接池耗尽 | 低 | 中 | Mongoose poolSize 调优；连接复用 |
| 现有 105 测试回归 | 低 | 高 | A1 迁移原样复用 llm 层；CI 每次跑 test:unit 守护 |
| SSE 在 NestJS 网关兼容性 | 中 | 中 | @Sse() 装饰器或手动 res.write；Nginx 关 buffering |
| 法条数据获取合规 | 中 | 高 | 优先国家法律法规数据库公开数据；案例脱敏 |
| Atlas Vector Search 成本 | 低 | 中 | M10 起步；超阈值迁 Milvus |
| LLM 上游故障 | 中 | 中 | A3 熔断 + 降级链（规则→知识→人工引导） |

---

## 九、时间节点总览

```
2026-07-24 ─── 当前（LLM 接入层完成 + 脚手架就绪）
    │
    ├── A1-W1 (07-25 ~ 07-31) NestJS 骨架 + 配置 + MongoDB/Redis
    ├── A1-W2 (08-01 ~ 08-07) 7 平台横切模块
    ├── A1-W3 (08-08 ~ 08-14) IntentRouter + RuleEngine + MemoryManager
    ├── A1-W4 (08-15 ~ 08-21) ChatController SSE + 迁移 + 评测
    │   └── A1 验收：08-21（可独立启动的 NestJS 服务）
    │
    ├── A2-W1~W4 (08-22 ~ 09-18) 知识库 + 混合检索
    ├── A3-W1~W4 (09-19 ~ 10-16) 文书生成 + LLM 增强
    ├── A4-W1~W4 (10-17 ~ 11-13) 12 Agent 编排
    ├── A5-W1~W4 (11-14 ~ 12-11) 25 OpenAPI + 17 MCP
    │
    └── 2026-12-11 ─── A1-A5 后端业务补齐完毕
            │
            └── 进入阶段 B（React Native 前端）+ 阶段 C（上架执行）
```

**里程碑**：
- M1（08-21）：A1 完成，NestJS 服务可独立启动，chat SSE 可用
- M2（09-18）：A2 完成，知识库 + 三路混合检索可用，Recall@10 ≥ 0.85
- M3（10-16）：A3 完成，文书生成全链路 + LLM 缓存/熔断
- M4（11-13）：A4 完成，12 Agent 编排可用
- M5（12-11）：A5 完成，25 OpenAPI + 17 MCP 对外暴露

---

## 十、立即可执行的下一步

1. **确认 D-1 ~ D-7 决策点**（建议优先 D-1 MongoDB / D-7 测试框架）
2. **安装 A1-W1 依赖**：`npm install @nestjs/core @nestjs/common @nestjs/config @nestjs/mongoose mongoose ioredis joi helmet passport-jwt @nestjs/jwt pino`
3. **创建 NestJS 骨架**：main.ts + app.module.ts + config + 9 schema + /health
4. **守护现有资产**：A1 实施全程保持 `npm run test:unit`（76 用例）绿色，确保 llm 层不回归

> 本计划与 [A1-A4-A5-review-report.md](../reviews/A1-A4-A5-review-report.md) 的 2 项 P0 不符合项联动：A4-N1（tool_invoke 编排计划）在 A4-W3 修正，A5-N1（MCP tools 对齐）在 A5-W3 修正，不阻塞 A1 启动。