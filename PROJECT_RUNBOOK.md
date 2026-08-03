# Legal Agent — 项目运行说明

> 版本：v2.3 ｜ 最后更新：2026-08-03

本文档提供 Legal Agent 项目的完整运行指南，涵盖环境准备、本地启动、Docker 容器化部署、常用命令、故障排查与核心接口。

---

## 目录

1. [项目概述](#1-项目概述)
2. [环境要求](#2-环境要求)
3. [本地开发启动](#3-本地开发启动)
4. [Docker 容器化运行](#4-docker-容器化运行)
5. [常用命令速查](#5-常用命令速查)
6. [关键配置项说明](#6-关键配置项说明)
7. [测试运行](#7-测试运行)
8. [核心接口说明](#8-核心接口说明)
9. [故障排查](#9-故障排查)

---

## 1. 项目概述

**Legal Agent** 是基于 NestJS 10 + TypeScript 5.4 构建的智能法律 AI 后端服务，面向普通用户与律师提供全链路法律 AI 能力：

- **12 个专业 Agent** 协作编排（意图路由 / 法律检索 / 文书生成 / 法律推理 / 律师审核等）
- **8 个法律工具**（期间计算 / 文书审核 / 赔偿查询 / 证照 OCR / 法条效力 / 案由分类 / 量刑指导 / 条款推荐）
- **混合检索**（BM25 + 向量 + RRF 融合）
- **PII 数据分级保护**（L1-L4，字段级 AES-256-GCM 加密）
- **审计日志** + **熔断器** + **L3 缓存**
- 前端支持微信小程序（Taro 4.x）、Web（Vite）、iOS 多平台

---

## 2. 环境要求

| 环境 | 最低版本 | 推荐版本 |
|------|---------|---------|
| Node.js | 18.0.0 | 24.15.0+ |
| npm | 9.0.0 | 10.x |
| Docker | 24.0 | 26.x（容器化部署需要）|
| Docker Compose | 2.20 | 2.27+ |

**必需的账号/Key：**

- **Agnes LLM API Key**：[https://platform.agnes-ai.com/settings/apiKeys](https://platform.agnes-ai.com/settings/apiKeys)
- **智谱 GLM API Key**（可选，用于视觉模型 / 可选 LLM 供应商）：[https://open.bigmodel.cn/usercenter/apikeys](https://open.bigmodel.cn/usercenter/apikeys)

---

## 3. 本地开发启动

### 3.1 步骤一：拉取代码

```powershell
cd g:\智能体设计\legal-agent
```

### 3.2 步骤二：安装依赖

```powershell
npm install
```

### 3.3 步骤三：启动基础设施（MongoDB + Redis）

```powershell
docker compose up -d
docker compose ps                          # 确认 mongo 和 redis 状态均为 healthy
```

> 若 Docker Desktop 未启动，请先启动 Docker Desktop 应用。

### 3.4 步骤四：配置环境变量

```powershell
Copy-Item .env.example .env
notepad .env
```

在 `.env` 中至少修改以下关键项：

```env
# 必填
AGNES_API_KEY=sk-你的真实key

# 生产环境必改（开发可忽略）
JWT_SECRET=<32位以上随机字符串>
PII_ENCRYPTION_KEY=<32位以上随机字符串>
SWAGGER_ENABLED=false       # 生产关闭 Swagger
CORS_ORIGINS=               # 生产填写具体域名，如 https://yourdomain.com
```

### 3.5 步骤五：启动应用（开发模式，热重载）

```powershell
npm run start:dev
```

期望日志输出：

```
[Nest] 12345  - 08/03/2026, 10:00:00     LOG [NestApplication] Nest application successfully started
legal-agent NestJS service listening on :3000
```

### 3.6 步骤六：验证服务

```powershell
# 健康检查
curl http://localhost:3000/health
# 期望: {"code":0,"data":{"status":"ok"}}

# 就绪检查
curl http://localhost:3000/health/ready
# 期望: {"code":0,"data":{"status":"ready","checks":{...}}}

# 全链路冒烟测试
.\scripts\smoke-test.ps1
```

---

## 4. Docker 容器化运行

### 4.1 仅基础设施（开发推荐）

```powershell
docker compose up -d mongo redis
```

应用仍通过 `npm run start:dev` 在宿主机运行，享受热重载。

### 4.2 全栈容器化（生产演练）

```powershell
# 构建镜像
docker compose --profile prod up -d --build

# 查看运行状态
docker compose ps

# 查看应用日志
docker compose logs -f app

# 停止所有服务
docker compose down
```

### 4.3 镜像信息

- 镜像名：`legal-agent:latest`
- 镜像大小：约 313MB
- 运行用户：非 root（安全加固）
- 监听端口：3000

---

## 5. 常用命令速查

### 构建与编译

```powershell
npm run build          # TypeScript 编译（产出 dist/）
npm run typecheck      # 仅类型检查（不产出）
```

### 运行

```powershell
npm run start:dev      # 开发模式（热重载，监听 :3000）
npm run start          # 生产模式（使用 dist/ 编译产物）
```

### 测试

```powershell
npm test               # 全量 1037 项测试
npm run test:unit      # 仅单测 1008 项（mock，无外部依赖，快速）
npm run test:agnes     # Agnes 集成测试 + E2E（真实 API 调用）
npm run test:report    # 全量测试 + JSON 报告（reports/test-results.json）
npm run test:watch     # Watch 模式（文件变更自动重跑）
```

### 评测基线

```powershell
npm run eval:intent           # 意图识别评测（目标 ≥ 97%）
npm run eval:retrieval        # 检索评测（目标 Recall@10 = 100%）
npm run eval:document         # 文书生成评测
npm run eval:orchestration    # Agent 编排评测
npm run eval:tool             # 8 法律工具评测（目标 100%）
npm run eval:lawyer-review    # 律师审核评测（62 题，目标 100%）
```

### 数据导入

```powershell
npm run import:knowledge     # 导入法律知识库
npm run import:law           # 导入法条数据
```

### 代码质量

```powershell
npm run lint         # ESLint 检查
npm run format       # Prettier 自动格式化
npm run format:check # Prettier 检查（CI 用）
npm run smoke        # LLM 模块冒烟测试
```

---

## 6. 关键配置项说明

完整配置见 `.env.example`，以下为最常用配置项：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `NODE_ENV` | `dev` | 运行环境（`dev` / `staging` / `prod`） |
| `PORT` | `3000` | 应用监听端口 |
| `MONGO_URI` | `mongodb://localhost:27017/legal-agent` | MongoDB 连接串 |
| `REDIS_URL` | `redis://localhost:6379` | Redis 连接串 |
| `JWT_SECRET` | `dev-secret-...` | JWT 签名密钥，**生产必须替换** |
| `AGNES_API_KEY` | （空） | Agnes LLM API Key |
| `AGNES_DEFAULT_MODEL` | `agnes-2.0-flash` | 默认 LLM 模型 |
| `LLM_TIMEOUT_MS` | `30000` | LLM 调用超时（毫秒） |
| `LLM_MAX_RETRIES` | `3` | LLM 调用最大重试次数 |
| `SWAGGER_ENABLED` | `true` | Swagger UI 开关，**生产设为 `false`** |
| `CORS_ORIGINS` | 开发允许 localhost 多源 | **生产必须填写具体域名白名单** |
| `PII_ENCRYPTION_KEY` | （空，派生自 JWT_SECRET） | PII 字段加密密钥，**生产独立设置** |
| `EMBEDDING_PROVIDER` | `mock` | 向量化供应商（`mock` / `agnes`） |
| `VISION_PRIMARY_MODEL` | `glm-4v-flash` | 视觉模型主选（图像识别） |
| `VISION_FALLBACK_MODEL` | `glm-4v-plus` | 视觉模型备选 |

---

## 7. 测试运行

### 7.1 快速验证（无需 MongoDB / Redis）

```powershell
npm run test:unit
```

纯 mock 单测，无外部依赖，约 260ms 完成。

### 7.2 全量测试（需要 MongoDB + Redis + AGNES_API_KEY）

```powershell
npm test
```

1037 项测试，含集成测试与 E2E 测试。

### 7.3 生成测试报告

```powershell
npm run test:report
# 报告路径：reports/test-results.json
```

### 7.4 业务评测（需要 MongoDB + AGNES_API_KEY）

```powershell
# 顺序执行全部评测
npm run eval:intent
npm run eval:retrieval
npm run eval:document
npm run eval:orchestration
npm run eval:tool
npm run eval:lawyer-review
```

> `eval:retrieval` 和 `eval:lawyer-review` 使用 `@swc-node/register`（依赖 `@Prop` 设计类型元数据），其余评测使用 `tsx`。

---

## 8. 核心接口说明

启动应用后访问 Swagger UI：`http://localhost:3000/docs`

### 8.1 认证

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/auth/login` | POST | 外部身份登录，签发 JWT |
| `/v1/auth/refresh` | POST | Refresh Token 换新 Access Token |

### 8.2 核心业务

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/chat` | POST | SSE 流式问答（12 Agent 编排） |
| `/v1/agents` | GET | 列出对外可见的 Agent Card |
| `/v1/documents/async` | POST | 异步文书生成，返回 jobId |
| `/v1/documents/:docId/export` | GET | 文书导出（docx/pdf） |
| `/v1/vision/recognize` | POST | 图像识别（URL / Base64） |
| `/v1/vision/upload` | POST | 图像识别（文件上传） |
| `/v1/reviews/queue` | GET | 律师审核任务队列 |
| `/v1/answers/:msgId/trace` | GET | 回答溯源 |

### 8.3 健康检查

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | Liveness Probe |
| `/health/ready` | GET | Readiness Probe（mongo + redis） |
| `/v1/vision/health` | GET | 视觉模型健康状态 |

### 8.4 统一响应格式

```jsonc
// 成功
{ "code": 0, "message": "ok", "traceId": "uuid", "data": { ... } }

// 失败
{ "code": <错误码>, "message": "...", "traceId": "uuid", "data": null }
```

---

## 9. 故障排查

### 9.1 MongoDB / Redis 连接失败

```powershell
# 检查容器状态
docker compose ps

# 查看日志
docker compose logs mongo
docker compose logs redis

# 重启基础设施
docker compose down
docker compose up -d
```

### 9.2 端口被占用

```powershell
# 查看占用 3000 端口的进程
netstat -ano | findstr :3000

# 修改端口：编辑 .env
PORT=3001
```

### 9.3 LLM API 调用失败（401 / 429）

- **401 AuthError**：检查 `.env` 中 `AGNES_API_KEY` 是否正确
- **429 RateLimitError**：Agnes 免费额度用尽，等待配额重置（尊重 `Retry-After` 头，系统自动重试 3 次）
- **500 ApiError**：上游服务异常，系统自动熔断并降级为规则引擎 + 知识库兜底

### 9.4 Swagger UI 无法访问

生产环境需关闭：`.env` 中设置 `SWAGGER_ENABLED=false`。

### 9.5 测试失败（单元测试通过，集成测试失败）

```powershell
# 确认基础设施运行
docker compose ps

# 确认 .env 中 AGNES_API_KEY 已填写
grep AGNES_API_KEY .env

# 仅运行集成测试排查
npm run test:agnes
```

### 9.6 Docker 构建失败

```powershell
# 清理旧镜像后重试
docker compose --profile prod down
docker rmi legal-agent:latest 2>$null
docker compose --profile prod up -d --build
```

---

## 附录：项目目录结构

```
legal-agent/
├── src/                          # 后端源码
│   ├── main.ts                   # 应用入口
│   ├── config/                   # 配置加载与校验
│   ├── modules/                  # NestJS 模块
│   │   ├── legal/               # 法律业务模块
│   │   │   ├── vision/          # 视觉识别（多模型主备）
│   │   │   ├── review/          # 律师审核闭环
│   │   │   ├── reasoning/       # 法律推理（IRAC）
│   │   │   ├── nlu/             # NLU（实体抽取/澄清/意图拆分）
│   │   │   ├── retrieval/       # 混合检索（BM25 + 向量 + RRF）
│   │   │   ├── knowledge/       # 知识库
│   │   │   ├── memory/          # 记忆管理
│   │   │   ├── rule/            # 规则引擎
│   │   │   └── llm/             # LLM 服务（缓存 + 熔断）
│   │   ├── auth/                 # 认证（JWT）
│   │   └── platform/             # 平台能力（PII/审计/限流/缓存）
│   ├── services/legal/          # L4 领域服务（可复用）
│   └── infra/                    # 基础设施（存储/导出）
├── tests/                        # 测试（单测/集成/E2E）
├── docs/design/                  # 工程级设计文档（17 篇）
├── 各版本/                       # 多平台前端版本
│   ├── wechat-miniapp/           # 微信小程序（原生）
│   ├── taro/                     # Taro 跨端（微信/H5/鸿蒙）
│   ├── web/                      # Web 端（Vite + React）
│   └── harmonyos/                # 鸿蒙端
├── docker-compose.yml            # 全栈编排
├── Dockerfile                    # 三阶段构建
├── .env.example                  # 环境变量模板
└── package.json                  # 依赖与脚本
```
