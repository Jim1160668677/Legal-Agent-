# legal-agent — NestJS 法律 AI 服务

NestJS 10 + TypeScript 5.4 + MongoDB + Redis 构建的法律 AI 后端服务。包含 12 个 Agent（意图路由 + 混合检索 + 文书生成 + 律师审核闭环）、8 个法律工具、PII 保护、审计日志、SSE 流式响应，1037 项测试 + 6 套评测基线全部通过。

## 项目特性

- **12 Agent 编排**：意图路由（8 意图）→ 混合检索（BM25 + 向量 + 结构化 RRF 融合）→ 文书生成 + 律师审核闭环
- **8 法律工具**：诉讼时效计算 / 赔偿查询 / 证照 OCR / 法条效力 / 案由分类 / 量刑指导 / 条款推荐 / 文书审查
- **NLU 域**：实体抽取（4 层）+ 多轮澄清（状态机）+ 复合意图拆分（拓扑排序）
- **法律推理**：事实比对 + 法条适用 + IRAC 推理链
- **横切能力**：PII 边界 + 审计日志 + 熔断器 + L3 缓存 + 限流 + 优雅关停
- **生产就绪**：Docker 三阶段构建 + SLB 双探针 + 17 项发布清单 + 回滚方案

## 目录

- [快速开始](#快速开始) — 5 步本地启动
- [部署](#部署) — 生产部署完整流程见 [DEPLOYMENT.md](./DEPLOYMENT.md)
- [API 文档](#api-文档) — 主要端点 + Swagger UI
- [测试](#测试) — 单测 / 集成 / 6 套评测基线
- [LlmService 模块（历史）](#llmservice-模块历史) — A1 阶段多供应商框架

## 快速开始

```powershell
# 1. 启动基础设施（mongo + redis）
docker compose up -d
docker compose ps                            # 期望 mongo/redis 都 healthy

# 2. 安装依赖
npm install

# 3. 配置 .env
Copy-Item .env.example .env
# 编辑 .env 填入 AGNES_API_KEY（从 https://platform.agnes-ai.com/settings/apiKeys 获取）

# 4. 启动应用（开发模式，热重载）
npm run start:dev
# 期望日志：legal-agent NestJS service listening on :3000

# 5. 验证
curl http://localhost:3000/health            # {"code":0,"data":{"status":"ok"}}
curl http://localhost:3000/health/ready      # {"code":0,"data":{"status":"ready","checks":{...}}}
.\scripts\smoke-test.ps1                     # 全链路冒烟（health→login→chat→reviews→ready→404→agents）
```

## 部署

生产部署（阿里云 ECS + 托管 MongoDB + Redis 云版 + SLB）完整流程见 [DEPLOYMENT.md](./DEPLOYMENT.md)，包含：

- 11 项必填环境变量清单（含生产收紧项：`SWAGGER_ENABLED=false`、`CORS_ORIGINS=` 白名单、`PII_ENCRYPTION_KEY=` 32+ 字符）
- Docker 三阶段构建（`docker build -t legal-agent .`，镜像 ~313MB，非 root 运行）
- docker-compose 全栈编排（app + mongo + redis 一键起）
- SLB 健康检查配置（`/health` liveness + `/health/ready` readiness）
- 17 项发布清单 + 回滚方案 + 故障排查

## API 文档

启动应用后访问 Swagger UI：`http://localhost:3000/docs`（生产环境 `SWAGGER_ENABLED=false` 关闭）。

主要端点：

| 端点 | 方法 | 鉴权 | 说明 |
|------|------|------|------|
| `/v1/auth/login` | POST | 无 | 外部身份登录，签发 JWT |
| `/v1/auth/refresh` | POST | JWT | refresh token 换新 access |
| `/v1/chat` | POST | JWT | SSE 流式问答（12 Agent 编排） |
| `/v1/agents` | GET | JWT | 列出对外可见的 AgentCard |
| `/v1/documents/async` | POST | JWT | 异步文书生成（返回 jobId） |
| `/v1/documents/:docId/export` | GET | JWT | 文书导出（docx/pdf） |
| `/v1/reviews/queue` | GET | JWT | 律师审核任务队列 |
| `/v1/answers/:msgId/trace` | GET | JWT | 答案溯源 |
| `/health` | GET | 无 | liveness 探针 |
| `/health/ready` | GET | 无 | readiness 探针（mongo+redis） |

统一响应信封：`{ code: 0, message: 'ok', traceId, data }`（成功） / `{ code: <错误码>, message, traceId, data: null }`（失败）。

## 测试

```powershell
npm test                  # 全量 1037 项（含集成，需 mongo+redis+AGNES_API_KEY）
npm run test:unit         # 仅单测 1008 项（mock，无外部依赖，快）
npm run test:agnes        # Agnes 集成 + E2E（真实 API）
npm run test:report       # 全量 + JSON 报告（reports/test-results.json）
```

6 套评测基线（金标集 + 评测脚本，验证业务准确率）：

```powershell
npm run eval:intent           # 意图识别评测（≥ 97%）
npm run eval:retrieval        # 检索评测（Recall@10 = 100%）
npm run eval:document         # 文书评测
npm run eval:orchestration    # 编排评测
npm run eval:tool             # 8 法律工具评测（100%）
npm run eval:lawyer-review    # 律师审核评测（62 题，100%）
```

> **swc-node vs tsx**：`eval:retrieval` 和 `eval:lawyer-review` 用 `node -r @swc-node/register`（依赖 `@Prop` 的 design:type metadata）；其余 eval 用 tsx。

---

## LlmService 模块（历史）

> 以下为 A1 阶段 LlmService 多供应商框架的原始文档，保留作为历史参考。当前 LLM 层已演进为 [cached-llm.service.ts](./src/modules/legal/llm/cached-llm.service.ts) 包装器模式（L3 缓存 + 熔断 + 法条回写），透明替换 legacy LlmServiceImpl。

legal-agent 项目的 LlmService 多供应商框架，已接入 Agnes 大模型（OpenAI 兼容协议）。含完整错误处理、超时控制、指数退避重试、SSE 流式解析、法条引用校验，附 105 项测试用例（单测 + 真实 API 集成测试 + E2E）。

## 环境准备

### 1. 安装依赖

```powershell
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，填入真实 Agnes API key：

```powershell
Copy-Item .env.example .env
```

`.env` 关键配置：

```env
LLM_PROVIDER=agnes
AGNES_API_KEY=sk-your-real-key-here
AGNES_BASE_URL=https://apihub.agnes-ai.com/v1
AGNES_DEFAULT_MODEL=agnes-2.0-flash

LLM_TIMEOUT_MS=30000
LLM_MAX_RETRIES=3
LLM_RETRY_BASE_DELAY_MS=1000
LLM_LOG_LEVEL=info
```

获取 Agnes API key：`https://platform.agnes-ai.com/settings/apiKeys`

> `.env` 已在 `.gitignore` 中，不会提交。完整 key 仅存本地，不在任何日志/输出中回显。

## 脚本说明

| 命令 | 说明 |
|------|------|
| `npm run build` | TypeScript 编译（tsc，类型检查 + 产出 dist） |
| `npm run typecheck` | 仅类型检查（不产出） |
| `npm run smoke` | 冒烟测试（tsx 直跑，验证 generate/stream/401 三项） |
| `npm test` | 运行全部测试 |
| `npm run test:unit` | 仅单测（mock，不消耗 tokens，快） |
| `npm run test:agnes` | 仅 Agnes 集成测试 + E2E（真实 API） |
| `npm run test:report` | 全量测试 + JSON 报告（`reports/test-results.json`） |
| `npm run test:watch` | watch 模式 |

## 快速验证

```powershell
npm run smoke
```

预期输出：

```
[smoke] generate: "pong" (model=agnes-2.0-flash, 257 tok → 2 tok, finish=stop)
[smoke] stream: "pong"
[smoke] error 401: AuthError
[smoke] OK
```

## 架构

```
LlmService (主类，门面)
    │
    ▼
ProviderRegistry (多供应商注册/切换)
    │
    ├── AgnesProvider (核心实现) ──┐
    │                              ├── http.ts (fetch + 超时 + 错误映射)
    │                              ├── sse.ts (SSE 流解析)
    │                              ├── retry.ts (指数退避重试)
    │                              └── errors.ts (7 类错误层级)
    └── QwenProvider (桩，抛 NotImplemented)
```

### 核心文件

| 文件 | 职责 |
|------|------|
| [src/types/llm.ts](src/types/llm.ts) | LlmService 接口契约（对齐设计文档 06 第八节） |
| [src/services/legal/llm.ts](src/services/legal/llm.ts) | LlmService 主类（generate/stream/validateLawRefs） |
| [src/services/legal/llm/provider.ts](src/services/legal/llm/provider.ts) | LlmProvider 抽象接口 |
| [src/services/legal/llm/agnesProvider.ts](src/services/legal/llm/agnesProvider.ts) | Agnes 核心实现 |
| [src/services/legal/llm/registry.ts](src/services/legal/llm/registry.ts) | ProviderRegistry 切换 |
| [src/services/legal/llm/http.ts](src/services/legal/llm/http.ts) | HTTP 封装 |
| [src/services/legal/llm/errors.ts](src/services/legal/llm/errors.ts) | 7 类错误层级 |
| [src/services/legal/llm/sse.ts](src/services/legal/llm/sse.ts) | SSE 流解析 |
| [src/services/legal/llm/retry.ts](src/services/legal/llm/retry.ts) | 指数退避重试 |
| [src/services/legal/llm/lawRefExtractor.ts](src/services/legal/llm/lawRefExtractor.ts) | 法条引用正则提取 |
| [src/config/](src/config/) | 配置加载与校验 |

### 使用示例

```typescript
import { createLlmService } from './src/services/legal/llm';

const service = createLlmService();

// 非流式
const r = await service.generate('用一句话解释什么是合同。', { maxTokens: 200 });
console.log(r.content, r.usage);

// 流式
for await (const chunk of service.stream('什么是违约责任？')) {
  process.stdout.write(chunk.delta);
}

// 法条校验（MVP：仅正则提取，全部 unverified）
const check = await service.validateLawRefs('根据《民法典》第一百四十三条...');
console.log(check.unverified);
```

### 多供应商切换

```typescript
import { createLlmService } from './src/services/legal/llm';

const service = createLlmService();
// 切换到 Qwen（桩，调用会抛 NotImplementedError）
service.providers.setActive('qwen');
// 切回 Agnes
service.providers.setActive('agnes');
```

## 错误处理

7 类错误，每类带 `kind`（监控分类）与 `retryable`（驱动重试）：

| 错误类 | kind | HTTP | 可重试 |
|--------|------|------|--------|
| AuthError | auth | 401 | 否 |
| InvalidRequestError | invalid_request | 400/4xx | 否 |
| RateLimitError | rate_limit | 429 | 是（尊重 Retry-After） |
| ApiError | api | 5xx | 是（≥500） |
| TimeoutError | timeout | — | 否 |
| NetworkError | network | — | 是 |
| ParseError | parse | — | 否 |

```typescript
import { AuthError, RateLimitError, isLlmError, isRetryable } from './src/services/legal/llm/errors';

try {
  await service.generate('...');
} catch (e) {
  if (e instanceof AuthError) { /* 处理认证失败 */ }
  if (isLlmError(e) && isRetryable(e)) { /* 可重试错误 */ }
}
```

## 测试

### 测试分层

| 层级 | 文件 | 用例 | 说明 |
|------|------|------|------|
| 单元（mock） | `tests/unit/` | 76 | 不消耗 tokens，快（~260ms） |
| 集成（真实 API） | `tests/integration/agnes/` | 23 | 正常/边界/异常/性能 |
| E2E | `tests/e2e/` | 6 | LlmService 主类端到端 |

### 运行测试

```powershell
# 全量（生成 JSON 报告）
npm run test:report

# 仅单测
npm run test:unit

# 仅 Agnes 集成测试
npm run test:agnes
```

> 集成测试调用真实 Agnes API（消耗少量 tokens）。vitest 配置 `fileParallelism: false` 顺序执行，避免免费用户限流（429）。集成测试启用 `maxRetries: 3` 应对瞬态限流。

### 测试报告

完整测试报告见 [reports/agnes-integration-report.md](reports/agnes-integration-report.md)，含测试矩阵、性能指标、错误分类验证、优化建议。

## 设计依据

- [docs/design/06-api-spec.md](docs/design/06-api-spec.md) 第八节 — LlmService 接口契约权威源
- [docs/design/04-module-design.md](docs/design/04-module-design.md) — 多厂商切换要求
- [docs/design/07-core-algorithms.md](docs/design/07-core-algorithms.md) §2.6 — 法条引用校验正则

## 技术栈

- **运行时**：Node.js ≥18（实测 v24.15.0，原生 fetch + AbortController + ReadableStream）
- **运行时依赖**：dotenv
- **开发依赖**：typescript ^5.4 + vitest ^1.6 + tsx + @types/node
- **模块系统**：ESM（`"type": "module"`，Bundler 模式解析）
- **不引入** openai SDK：保持 OpenAI 兼容协议透明
