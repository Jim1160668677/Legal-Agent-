# legal-agent — Agnes 大模型接入集成

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
