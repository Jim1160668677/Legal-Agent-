# Legal Agent 发布说明

## v0.1.0（2026-07-29）

### 概述

Legal Agent v0.1.0 首个正式发布版本。基于 NestJS 10 + TypeScript + MongoDB + Redis 的法律 AI 后端服务，提供法律问答、文书生成、案件分析、图像识别等能力，面向云服务器 Docker 部署。

### 新增功能

#### 图像识别多模型主备切换（v2.4）
- 双模型主备：主 `glm-4v-flash`（免费）/ 备 `glm-4v-plus`，复用智谱 API Key
- 自动故障切换：主 provider 失败自动切备，返回 `fallbackUsed` 标记
- 被动健康监测：调用结果驱动，冷却期 30s 自动恢复，渐进退避（1.5x/次，上限 300s）
- REST API 三端点：
  - `POST /v1/vision/recognize`（URL / Base64 识别）
  - `POST /v1/vision/upload`（multipart 文件上传识别）
  - `GET /v1/vision/health`（provider 健康状态）
- `ToolOcrService` 集成：`LicenseOcrTool` 经 ToolAgent 注入可用
- 审计事件：`vision_call` 已加入 AuditEvent 联合类型

#### 核心能力（既有模块，本版纳入发布）
- 8 意图编排（legal_qa / document_generate / process_guide / case_analysis / case_reasoning / material_checklist / general_qa / tool_invoke）
- 8 法律工具（期限计算 / 文书审查 / 赔偿查询 / 证照 OCR / 法条效力 / 案由分类 / 量刑指引 / 条款推荐）
- 文书生成链路（模板 → 变量填充 → DOCX/PDF 导出，无外部重依赖）
- NLU 域（实体抽取 + 多轮澄清 + 复合意图拆分）
- 法律推理域（事实相似度 / 法条适用 / 案例比对 / IRAC 推理）
- 律师审核五合一闭环（抽样 / 状态机 / 双轨评分 / 合规扫描 / 标注回流）
- 智谱 GLM 集成（glm-4.7-flash 免费模型 + 深度思考模式）

### 安全加固（本版重点）

| 类别 | 措施 |
|---|---|
| 限流 | 全局 ThrottlerGuard（100/60s/IP）+ Chat per-user 20/min |
| RBAC | RolesGuard 全局注册，律师审核后台限 ops/admin |
| 越权防护 | `assertOwner` 统一校验，文书/任务 owner 隔离 |
| PII 加密 | 强制注入（移除降级），生产缺密钥拒绝启动 |
| CORS | 空白名单 = 禁止跨域（origin:false） |
| Swagger | 生产环境强制关闭 `/docs` |
| 日志脱敏 | pino redact 覆盖 authorization/cookie/password |
| 错误外泄 | 原生 Error 信封返回"内部错误"，stack 仅落日志 |
| 密钥管理 | `.env` gitignored，`.env.example` 全占位，源码无硬编码 |
| JWT 强度 | `JWT_SECRET` 校验 min(32) |

### 质量指标

| 指标 | 值 |
|---|---|
| TypeScript 类型检查 | 零错误 |
| ESLint | 零错误 |
| 单元测试 | 1012 项全通过 |
| 意图识别准确率 | 97.5%（200 题） |
| 检索 Recall@10 | 100%（50 题） |
| 文书生成准确率 | 100%（20 题） |
| 编排计划命中率 | 100%（70 题） |
| 工具调用准确率 | 100%（80 题） |
| 律师审核准确率 | 100%（62 题） |
| BM25 检索 P50 | <30ms（5K 文档） |

### 部署信息

- **目标平台**：云服务器 Docker 部署（详见 `DEPLOYMENT.md`）
- **运行时**：Node.js 18+ LTS
- **依赖服务**：MongoDB 7 + Redis 7
- **镜像构建**：`docker build -t legal-agent:0.1.0 .`（三阶段构建，313MB）
- **npm 加速**：Dockerfile 已配置 `registry.npmmirror.com`（国内镜像）
- **健康探针**：`GET /health`（liveness）+ `GET /health/ready`（readiness）
- **环境变量**：参考 `.env.example`，生产关键项：
  - `NODE_ENV=prod`（注意：合法值为 dev/staging/prod，**非 production**）
  - `PII_ENCRYPTION_KEY`：32+ 字符随机串（必填，生产缺失拒绝启动）
  - `JWT_SECRET`：32+ 字符随机串（必填）
  - `ZHIPU_API_KEY`：智谱 API Key（必填）
  - `MONGO_URI`：含强口令的连接串
  - `SWAGGER_ENABLED=false`（生产）
  - `CORS_ORIGINS`：收紧到具体域名（留空 = 禁止跨域）

### Docker 构建验证

镜像 `legal-agent:0.1.0` 已通过完整构建运行验证：
- 三阶段构建成功（builder → deps → runtime），313MB
- 容器以非 root 用户（app:uid=100）运行
- liveness `/health` → 200，readiness `/health/ready` → 200（mongo+redis up）
- 生产模式 Swagger 强制关闭（`/docs` → 404）
- 内置 HEALTHCHECK（30s 间隔）状态 healthy

构建中修复两个生产阻断 Bug：
1. Dockerfile `NODE_ENV=production` → `prod`（原值不匹配 config 校验，容器无法启动）
2. main.ts Swagger 生产判断 `'production'` → `'prod'`（原值导致生产模式 Swagger 仍暴露）

### 升级/回滚

- 首次发布，无升级路径
- 回滚方案：切换至上一稳定镜像 + 数据库不变更（详见 `DEPLOYMENT.md` 回滚章节）

### 已知限制

- 文书模板需部署时 seed（`npm run seed` 或导入脚本）
- 免费模型 `glm-4.7-flash` 高峰期可能 429 限流（code 1305），应用自动重试
- `retrieval-perf` 性能测试 P50 在 30ms 阈值边缘偶发抖动（CI 噪声，重跑稳定）
