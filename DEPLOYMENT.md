# legal-agent 部署手册

本手册覆盖 legal-agent 从本地容器化演练到阿里云生产上线的完整流程。包含 11 项必填环境变量清单、Docker 三阶段构建、docker-compose 全栈编排、SLB 健康检查配置、17 项发布清单、回滚方案与故障排查。

> 适用于版本：v2.3 阶段十（A4 / A5 / Phase 1-4 完成）。技术栈：NestJS 10 + TypeScript 5.4 + MongoDB 7 + Redis 7。

---

## 目录

1. [环境变量清单](#1-环境变量清单)
2. [本地全栈 docker-compose 演练](#2-本地全栈-docker-compose-演练)
3. [Docker 三阶段构建](#3-docker-三阶段构建)
4. [阿里云生产部署](#4-阿里云生产部署)
5. [SLB 健康检查配置](#5-slb-健康检查配置)
6. [发布清单](#6-发布清单17-项)
7. [回滚方案](#7-回滚方案)
8. [故障排查](#8-故障排查)

---

## 1. 环境变量清单

### 1.1 必填 11 项（缺失则启动失败或功能降级）

| # | 环境变量 | 示例值 | 说明 |
|---|---------|--------|------|
| 1 | `NODE_ENV` | `prod` | 运行环境，必须为 `prod`（校验 schema 限定 `dev\|staging\|prod`） |
| 2 | `PORT` | `3000` | 应用监听端口 |
| 3 | `MONGO_URI` | `mongodb://legal:***@mongo:27017/legal_agent?authSource=admin` | MongoDB 连接串，生产用 Atlas M10+ 或副本集 |
| 4 | `REDIS_URL` | `redis://redis:6379` | Redis 连接串，生产用云版 Redis |
| 5 | `JWT_SECRET` | `（32+ 位强随机串）` | JWT 签名密钥，**生产必须替换为强随机串** |
| 6 | `AGNES_API_KEY` | `sk-xxxxxxxxxxxx` | Agnes LLM API key，从 https://platform.agnes-ai.com/settings/apiKeys 获取 |
| 7 | `LLM_PROVIDER` | `agnes` | LLM 供应商，当前仅 `agnes` 可用 |
| 8 | `CORS_ORIGINS` | `https://legal.example.com` | CORS 白名单，**生产必须收紧到具体域名**（逗号分隔，留空 = 允许所有） |
| 9 | `SWAGGER_ENABLED` | `false` | Swagger UI 开关，**生产必须 `false`** 避免暴露 API 文档 |
| 10 | `PII_ENCRYPTION_KEY` | `（32+ 位强随机串）` | PII 加密密钥，**生产必须独立设置**（缺失则由 JWT_SECRET 派生，弱安全） |
| 11 | `LOG_LEVEL` | `info` | 日志级别（`debug\|info\|warn\|error`），生产用 `info` |

### 1.2 可选项（按需配置）

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `JWT_EXPIRES_IN` | `7d` | access token 有效期 |
| `JWT_REFRESH_EXPIRES_IN` | `30d` | refresh token 有效期 |
| `REDIS_KEY_PREFIX` | `legal:` | Redis key 前缀，多实例共享 Redis 时隔离命名空间 |
| `AGNES_BASE_URL` | `https://apihub.agnes-ai.com/v1` | Agnes API 基址 |
| `AGNES_DEFAULT_MODEL` | `agnes-2.0-flash` | 默认模型 |
| `LLM_TIMEOUT_MS` | `30000` | LLM 调用超时 |
| `LLM_MAX_RETRIES` | `3` | LLM 调用最大重试次数 |
| `EMBEDDING_PROVIDER` | `mock` | 向量化供应商（`mock\|agnes`），生产建议 `agnes` |
| `EMBEDDING_API_KEY` | （空） | 向量化 API key（`EMBEDDING_PROVIDER=agnes` 时必填） |
| `EMBEDDING_MODEL` | `agnes-embedding-2.0` | 向量化模型 |
| `RATE_PER_USER_CHAT_PER_MIN` | `20` | 单用户每分钟对话上限 |
| `RATE_PER_USER_LLM_PER_DAY` | `50` | 单用户每日 LLM 调用上限 |
| `RATE_GLOBAL_CHAT_QPS` | `500` | 全局 QPS 上限 |
| `THROTTLE_TTL_MS` | `60000` | 全局 IP 限流窗口（毫秒） |
| `THROTTLE_LIMIT` | `100` | 全局 IP 限流上限（每窗口） |
| `THROTTLE_DAILY_LIMIT` | `10000` | 全局 IP 日限 |

### 1.3 生产环境收紧项（与开发默认值不同）

| 项 | 开发默认 | 生产必改 | 风险 |
|----|---------|---------|------|
| `SWAGGER_ENABLED` | `true` | `false` | 暴露 API 文档与字段结构，便于攻击者构造请求 |
| `CORS_ORIGINS` | （空，允许所有） | 具体域名白名单 | 任意源可携带用户凭据发起请求（CSRF） |
| `JWT_SECRET` | `dev-secret-...` | 32+ 位强随机串 | 弱密钥可被暴力破解伪造 token |
| `PII_ENCRYPTION_KEY` | （空，派生自 JWT_SECRET） | 独立 32+ 位密钥 | 密钥泄露后 PII 与 JWT 同时失陷 |
| `EMBEDDING_PROVIDER` | `mock` | `agnes` | mock 向量召回无效，检索质量降级 |
| `LOG_LEVEL` | `info` | `info` 或 `warn` | `debug` 会记录敏感上下文 |

---

## 2. 本地全栈 docker-compose 演练

docker-compose 提供两种模式：

### 2.1 开发模式（仅基础设施）

应用走本地 `npm run start:dev`，便于热重载与断点调试：

```powershell
# 启动 mongo + redis
docker compose up -d mongo redis

# 检查健康
docker compose ps                            # 期望 mongo/redis 都 healthy
docker compose logs -f mongo redis

# 本地启动应用
npm install
Copy-Item .env.example .env                 # 编辑 .env 填入 AGNES_API_KEY
npm run start:dev
```

### 2.2 全栈容器化演练（生产前预演）

```powershell
# 1. 准备 .env（按 §1.1 填齐 11 项）
Copy-Item .env.example .env
# 编辑 .env：JWT_SECRET / AGNES_API_KEY / PII_ENCRYPTION_KEY 必填

# 2. 构建并启动全栈（app + mongo + redis）
docker compose --profile prod up -d --build

# 3. 验证
docker compose ps                            # 三个服务都 healthy
curl http://localhost:3000/health            # {"code":0,"data":{"status":"ok"}}
curl http://localhost:3000/health/ready      # {"code":0,"data":{"status":"ready","checks":{...}}}

# 4. 查看日志
docker compose logs -f app
docker compose logs -f mongo redis

# 5. 运行冒烟测试
.\scripts\smoke-test.ps1

# 6. 停止与清理
docker compose --profile prod down           # 停止容器，保留数据卷
docker compose --profile prod down -v        # 同时删除数据卷（清空 mongo/redis 数据）
```

### 2.3 镜像大小验收

```powershell
docker images legal-agent:latest
# 期望：约 313MB（node:20-alpine 基础 + 生产 node_modules + dist）
```

---

## 3. Docker 三阶段构建

### 3.1 三阶段说明

| 阶段 | 基础镜像 | 产物 | 说明 |
|------|---------|------|------|
| `builder` | `node:20-alpine` | `dist/` | 安装全部依赖（含 dev）+ `tsc` 编译 |
| `deps` | `node:20-alpine` | `node_modules/` | 仅安装生产依赖（`--omit=dev`） |
| `runtime` | `node:20-alpine` | `dist + 生产 node_modules` | 非 root 用户 + tzdata + healthcheck |

### 3.2 构建命令

```powershell
# 本地构建
docker build -t legal-agent:latest .

# 带版本标签
docker build -t legal-agent:v0.1.0 -t legal-agent:latest .

# 验证镜像
docker run --rm legal-agent:latest node -e "console.log(process.env.NODE_ENV, process.version)"
# 期望：production v20.x.x
```

### 3.3 关键设计点

- **非 root 用户**：`addgroup -S app && adduser -S app -G app`，`USER app` 切换
- **时区**：法律场景对日期敏感（诉讼时效），装 `tzdata` 设置 `Asia/Shanghai`
- **健康检查**：`/health` liveness（不依赖 mongo/redis，避免抖动触发重启循环）
- **`--legacy-peer-deps`**：`@nestjs/testing@11` 与 `@nestjs/common@10` peer 冲突，必须加
- **`.dockerignore`**：排除 `node_modules / dist / .env / tests / docs`，加速构建

---

## 4. 阿里云生产部署

推荐架构：阿里云 ECS（应用） + 托管 MongoDB（Atlas / 阿里云 Mongo） + Redis 云版 + SLB（负载均衡）。

### 4.1 资源规划（参考）

| 资源 | 规格 | 说明 |
|------|------|------|
| ECS（应用） | 2 核 4G × 2 台 | 多实例高可用，挂 SLB |
| 托管 MongoDB | M10+（2 核 4G） | 生产最小规格，副本集 |
| Redis 云版 | 1G 主从 | 启用持久化 |
| SLB | 按量计费 | 7 层 HTTPS，挂 EIP |
| OSS | 通用 bucket | 文书导出 docx/pdf 存储 |
| 日志服务 SLS | 通用 | 应用日志收集 |

### 4.2 部署步骤

```bash
# 1. ECS 准备（每台）
sudo yum install -y docker
sudo systemctl enable --now docker
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# 2. 拉取镜像（或从镜像服务拉取）
docker pull legal-agent:v0.1.0
docker tag legal-agent:v0.1.0 legal-agent:latest

# 3. 准备 .env（按 §1.1 填齐 11 项，生产收紧项必须改）
sudo mkdir -p /opt/legal-agent
sudo vim /opt/legal-agent/.env
sudo chmod 600 /opt/legal-agent/.env                    # 限制权限
sudo chown root:root /opt/legal-agent/.env

# 4. 启动应用（不通过 compose，直接 docker run 便于与 SLB 解耦）
docker run -d \
  --name legal-app \
  --restart unless-stopped \
  --env-file /opt/legal-agent/.env \
  -p 3000:3000 \
  legal-agent:latest

# 5. 验证
curl http://localhost:3000/health
curl http://localhost:3000/health/ready
```

### 4.3 多实例与 SLB

```bash
# ECS-1 与 ECS-2 各起一个 legal-app 容器
# SLB 后端服务器组添加两台 ECS，端口 3000
# SLB 健康检查见 §5
```

---

## 5. SLB 健康检查配置

### 5.1 双探针策略

| 探针 | 端点 | 含义 | 失败后果 |
|------|------|------|---------|
| **liveness** | `GET /health` | 应用进程存活（不查依赖） | 容器重启 / ECS 摘除 |
| **readiness** | `GET /health/ready` | 依赖就绪（mongo + redis） | 摘除流量但不重启 |

### 5.2 SLB 控制台配置

| 项 | liveness | readiness |
|----|---------|-----------|
| 协议 | HTTP | HTTP |
| 端口 | 3000 | 3000 |
| 路径 | `/health` | `/health/ready` |
| 期望 HTTP 状态码 | 200 | 200 |
| 检查间隔 | 10s | 5s |
| 超时 | 5s | 3s |
| 健康阈值 | 2 次 | 2 次 |
| 不健康阈值 | 3 次 | 2 次 |

### 5.3 响应示例

```json
// GET /health（liveness）
{ "code": 0, "message": "ok", "traceId": "...", "data": { "status": "ok" } }

// GET /health/ready（readiness，依赖就绪）
{ "code": 0, "message": "ok", "traceId": "...", "data": { "status": "ready", "checks": { "mongo": true, "redis": true } } }

// GET /health/ready（依赖未就绪，HTTP 503）
{ "code": 0, "message": "ok", "traceId": "...", "data": { "status": "not-ready", "checks": { "mongo": false, "redis": true } } }
```

> readiness 返回 503 时，SLB 应摘除流量但不重启容器（依赖抖动不应触发重启循环）。

---

## 6. 发布清单（17 项）

发布前逐项打勾，全部 ✅ 方可上线：

### 代码与质量
- [ ] 1. 主干 `main` 分支绿色：`npm run lint && npm run typecheck && npm test` 全部通过
- [ ] 2. 全量测试通过（≥ 99%）：`npm test`（含集成，需 mongo + redis + AGNES_API_KEY）
- [ ] 3. 评测基线无回归：6 套 eval 全部达标（`eval:intent ≥ 97%` / `eval:retrieval 100%` / `eval:tool 100%` / `eval:lawyer-review ≥ 93%`）
- [ ] 4. Prettier 格式检查通过：`npm run format:check`

### 容器与镜像
- [ ] 5. `docker build -t legal-agent:v0.1.0 .` 构建成功，镜像 < 350MB
- [ ] 6. 容器内 `node dist/main.js` 启动正常，`/health` 返回 200
- [ ] 7. `.dockerignore` 排除 `.env / node_modules / dist / tests / docs`

### 环境配置
- [ ] 8. `.env` 填齐 §1.1 必填 11 项
- [ ] 9. 生产收紧项已改：`SWAGGER_ENABLED=false` / `CORS_ORIGINS=` 白名单 / `JWT_SECRET` 32+ 位 / `PII_ENCRYPTION_KEY` 独立
- [ ] 10. `.env` 文件权限 `600`，属主 `root:root`
- [ ] 11. `MONGO_URI` / `REDIS_URL` 指向生产实例（非 localhost）

### 部署与验证
- [ ] 12. ECS 上 `docker run` 启动成功，容器状态 `running`
- [ ] 13. `curl http://localhost:3000/health` 返回 200 + `status:ok`
- [ ] 14. `curl http://localhost:3000/health/ready` 返回 200 + `status:ready`
- [ ] 15. `.\scripts\smoke-test.ps1` 全链路冒烟通过（health → login → chat → reviews → ready → 404 → agents）
- [ ] 16. SLB 健康检查配置完成（liveness + readiness 双探针），后端服务器健康

### 监控与日志
- [ ] 17. SLS 日志收集正常，能看到应用 `info` 级日志与 `traceId`

---

## 7. 回滚方案

### 7.1 回滚决策

| 触发条件 | 动作 |
|---------|------|
| 健康检查失败率 > 5%（5 分钟内） | 立即回滚 |
| 核心端点（login/chat）5xx 错误率 > 1% | 立即回滚 |
| LLM 调用全部失败（熔断器持续打开） | 回滚 + 排查 Agnes 服务 |
| 业务评测基线回归 > 5% | 评估后回滚 |

### 7.2 回滚步骤

```bash
# 1. 切换到上一版本镜像（保留至少 2 个历史版本）
docker stop legal-app
docker rm legal-app
docker run -d \
  --name legal-app \
  --restart unless-stopped \
  --env-file /opt/legal-agent/.env \
  -p 3000:3000 \
  legal-agent:v0.0.9                    # 上一版本号

# 2. 验证
curl http://localhost:3000/health
curl http://localhost:3000/health/ready
.\scripts\smoke-test.ps1

# 3. SLB 自动重新加入健康实例（探针通过后流量恢复）
```

### 7.3 数据库回滚

> **重要**：MongoDB schema 变更需配套迁移脚本。如有破坏性变更（删字段/改类型），发布前必须备份。

```bash
# 备份（发布前）
mongodump --uri="$MONGO_URI" --out=/backup/legal-agent-$(date +%Y%m%d-%H%M)

# 回滚（仅在 schema 不兼容时）
mongorestore --uri="$MONGO_URI" --drop /backup/legal-agent-YYYYMMDD-HHMM
```

---

## 8. 故障排查

### 8.1 容器启动失败

| 现象 | 排查 |
|------|------|
| `Nest can't resolve dependencies of the X (?, ?)` | 检查 `import type` 是否误用（DI 需要 value import） |
| `NODE_ENV must be one of [dev, staging, prod]` | `.env` 的 `NODE_ENV` 必须是三者之一，不能是 `production` |
| `ECONNREFUSED 127.0.0.1:27017` | 容器内 `localhost` 不是宿主机，`MONGO_URI` 用 `mongo:27017` |
| `Agnes API 401 Unauthorized` | `AGNES_API_KEY` 错误或过期，到 platform.agnes-ai.com 重新生成 |
| `JWT_SECRET must be 32+ characters` | 生产环境强制 32+ 位，开发环境可放宽 |

### 8.2 健康检查失败

```bash
# liveness 失败（容器重启循环）
docker logs legal-app --tail 100
# 检查应用是否真的崩溃，还是 healthcheck 脚本问题

# readiness 失败（SLB 摘除流量）
curl http://localhost:3000/health/ready
# 检查 data.checks.mongo / data.checks.redis 哪个为 false
docker exec legal-app wget -qO- redis:6379        # 测试容器网络
```

### 8.3 SSE 流式响应被截断

- **SLB 配置**：7 层 SLB 需关闭 buffering（或开启「流式响应透传」）
- **超时**：SLB 空闲超时建议 ≥ 120s（默认 60s 会切断长对话）
- **限流豁免**：ChatController 已 `@SkipThrottle()`，确认未误加限流中间件

### 8.4 性能问题

| 现象 | 排查 |
|------|------|
| `/v1/chat` P95 > 5s | 检查 LLM 调用耗时（Agnes 网络抖动）/ 检索召回耗时 |
| MongoDB CPU 高 | 检查索引（`userId` / `phoneHash` / `articleId` 等），`db.collection.explain()` |
| Redis 内存增长 | 检查限流 key / 缓存 key TTL，确认有 `legal:` 前缀 |
| 镜像 > 350MB | 检查 `.dockerignore`，确认 devDependencies 未被打入 |

### 8.5 日志查看

```bash
# 应用日志
docker logs legal-app -f --tail 200

# 按 traceId 过滤
docker logs legal-app 2>&1 | grep "traceId"

# SLS 查询（生产）
# 索引：traceId / userId / level / func
# 示例：level:error AND func:chat_controller
```

---

## 附录：环境变量完整示例（.env.prod 模板）

> **切勿将此文件提交到 Git**。仅作为模板参考。

```env
# === 必填 11 项 ===
NODE_ENV=prod
PORT=3000
MONGO_URI=mongodb://legal:STRONG_PASSWORD@prod-mongo.example.com:27017/legal_agent?authSource=admin&replicaSet=rs0
REDIS_URL=redis://prod-redis.example.com:6379
JWT_SECRET=REPLACE_WITH_32_PLUS_RANDOM_CHARS_USE_openssl_rand_hex_32
AGNES_API_KEY=sk-your-prod-agnes-key
LLM_PROVIDER=agnes
CORS_ORIGINS=https://legal.example.com,https://admin.legal.example.com
SWAGGER_ENABLED=false
PII_ENCRYPTION_KEY=REPLACE_WITH_INDEPENDENT_32_PLUS_RANDOM_CHARS
LOG_LEVEL=info

# === 可选项（按需）===
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d
REDIS_KEY_PREFIX=legal:prod:
AGNES_BASE_URL=https://apihub.agnes-ai.com/v1
AGNES_DEFAULT_MODEL=agnes-2.0-flash
LLM_TIMEOUT_MS=30000
LLM_MAX_RETRIES=3
EMBEDDING_PROVIDER=agnes
EMBEDDING_API_KEY=sk-your-embedding-key
EMBEDDING_MODEL=agnes-embedding-2.0
EMBEDDING_DIMENSION=1536
RATE_PER_USER_CHAT_PER_MIN=20
RATE_PER_USER_LLM_PER_DAY=50
RATE_GLOBAL_CHAT_QPS=500
THROTTLE_TTL_MS=60000
THROTTLE_LIMIT=100
THROTTLE_DAILY_LIMIT=10000
```

生成强随机密钥：

```bash
# JWT_SECRET / PII_ENCRYPTION_KEY
openssl rand -hex 32                          # 64 位十六进制串（32 字节）
```
