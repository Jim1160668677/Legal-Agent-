# legal-agent 架构文档

> 版本：v2.3 ｜ 最后更新：2026-08-07

本文档描述 legal-agent 生产环境架构、证书管理、备份策略、健康检查机制与密钥轮换方案。

---

## 1. 服务拓扑

```
用户浏览器 ──HTTPS(443)──► ECS 宿主机
                                 │
                                 └── Docker Compose：
                                     │
                                     ├── nginx        (对外 443，反代 /v1/*→app:3000，静态 /→web/dist)
                                     ├── app          (NestJS，3000，仅 Docker 内网)
                                     ├── mongo        (27017，仅 Docker 内网)
                                     └── redis        (6379，仅 Docker 内网)
```

### 1.1 端口映射规则

| 服务 | 容器内端口 | 宿主机端口 | 说明 |
|------|-----------|-----------|------|
| nginx | 443 | 443 | HTTPS 入口，唯一暴露端口 |
| nginx | 80 | 80（可选） | HTTP→HTTPS 重定向 |
| app | 3000 | **不映射** | 仅 Docker 内网可达 |
| mongo | 27017 | **不映射** | 仅 Docker 内网可达 |
| redis | 6379 | **不映射** | 仅 Docker 内网可达 |

> **约束：数据库端口（27017、6379）禁止映射到宿主公网。app 的 3000 端口仅通过 nginx 反代访问，不直接暴露。**

### 1.2 服务职责

| 服务 | 技术栈 | 职责 |
|------|--------|------|
| nginx | nginx:1.25-alpine | HTTPS 终结、静态文件服务、反向代理、Gzip 压缩 |
| app | NestJS 10 + Node 20 | 业务 API（/v1/*）、SSE 流式、JWT 认证、限流 |
| mongo | mongo:7 | 持久化存储（用户/对话/法条/知识库） |
| redis | redis:7-alpine | 会话缓存、限流计数、LLM 结果缓存 |

---

## 2. 证书管理流程

证书由宿主机通过 certbot（Let's Encrypt / acme.sh）申请，再挂载到 nginx 容器。

### 2.1 证书申请（宿主机执行）

```bash
# 使用 acme.sh（推荐，轻量无依赖）
# 1. 安装 acme.sh
curl https://get.acme.sh | sh

# 2. 申请证书（HTTP-01 验证）
~/.acme.sh/acme.sh --issue -d legal.example.com --webroot /var/www/legal-agent/nginx-challenge

# 3. 或 DNS-01 验证（推荐用于生产，免开 80 端口）
~/.acme.sh/acme.sh --issue -d legal.example.com --dns dns_ali   # 阿里云 DNS
```

### 2.2 证书挂载（docker-compose.yml）

```yaml
services:
  nginx:
    image: nginx:1.25-alpine
    ports:
      - "443:443"
    volumes:
      - /opt/legal-agent/certs:/etc/nginx/certs:ro   # 证书目录
      - /opt/legal-agent/nginx/conf.d:/etc/nginx/conf.d:ro
      - /opt/legal-agent/static:/usr/share/nginx/html:ro
      - /opt/legal-agent/nginx-challenge:/usr/share/nginx/html/.well-known:ro  # ACME 挑战目录
```

### 2.3 证书续期（宿主机 crontab）

```bash
# 每天 0 点检查并续期（acme.sh 自动重装证书到 nginx 容器）
0 0 * * * ~/.acme.sh/acme.sh --cron --home ~/.acme.sh > /dev/null 2>&1
```

### 2.4 证书目录权限

```bash
sudo mkdir -p /opt/legal-agent/certs
sudo chmod 700 /opt/legal-agent/certs
sudo chown root:root /opt/legal-agent/certs
sudo chmod 600 /opt/legal-agent/certs/*
```

---

## 3. 备份策略

### 3.1 数据卷备份

```bash
# 备份 MongoDB 数据卷
docker run --rm \
  -v legal-mongo-data:/data/db \
  -v /opt/legal-agent/backup:/backup \
  alpine tar czf /backup/mongo-$(date +%Y%m%d-%H%M).tar.gz -C /data/db .

# 备份 Redis 数据卷（RDB 文件）
docker run --rm \
  -v legal-redis-data:/data \
  -v /opt/legal-agent/backup:/backup \
  alpine tar czf /backup/redis-$(date +%Y%m%d-%H%M).tar.gz -C /data redis.aof
```

### 3.2 备份保留策略

| 类型 | 频率 | 保留数量 |
|------|------|---------|
| MongoDB 全量 | 每日 02:00 | 最近 7 天 |
| Redis AOF | 每日 02:30 | 最近 7 天 |
| 应用日志 | 每日压缩 | 最近 14 天 |

### 3.3 备份自动化（宿主机 crontab）

```bash
# /opt/legal-agent/scripts/backup.sh
#!/bin/bash
set -euo pipefail
BACKUP_DIR="/opt/legal-agent/backup"
RETENTION=7
mkdir -p "$BACKUP_DIR"

# MongoDB 备份
docker run --rm \
  -v legal-mongo-data:/data/db \
  -v "$BACKUP_DIR:/backup" \
  alpine sh -c "tar czf /backup/mongo-$(date +%Y%m%d-%H%M).tar.gz -C /data/db ."

# 清理旧备份
find "$BACKUP_DIR" -name "mongo-*.tar.gz" -mtime +${RETENTION} -delete
find "$BACKUP_DIR" -name "redis-*.tar.gz" -mtime +${RETENTION} -delete
```

---

## 4. 健康检查机制

### 4.1 检查层次

| 层次 | 端点 | 检查内容 | 执行位置 |
|------|------|---------|---------|
| Liveness | `GET /health` | 进程存活、内存正常 | 宿主机（外部） |
| Readiness | `GET /health/ready` | mongo + redis 连通 | 宿主机（外部） |
| 应用内 | Docker healthcheck | 同 Liveness（仅用于容器自监控） | 容器内（辅助） |

### 4.2 宿主机健康检查脚本

```bash
#!/bin/bash
DOMAIN="legal.example.com"

# liveness 检查
curl -sf "https://${DOMAIN}/health" || exit 1

# readiness 检查（非零退出 = 未就绪）
READY=$(curl -sf "https://${DOMAIN}/health/ready")
STATUS=$(echo "$READY" | jq -r '.data.status')
[ "$STATUS" = "ready" ] || exit 1
```

### 4.3 监控告警

| 指标 | 告警阈值 | 通知方式 |
|------|---------|---------|
| /health 失败 | 连续 3 次 | 钉钉/企业微信 |
| /health/ready 503 | 持续 5 分钟 | 钉钉/企业微信 |
| 证书过期 | < 7 天 | 钉钉/企业微信 |
| 磁盘使用 | > 80% | 钉钉/企业微信 |
| 内存使用 | > 90% | 钉钉/企业微信 |

---

## 5. 密钥轮换说明

### 5.1 需定期轮换的密钥

| 密钥 | 轮换周期 | 备注 |
|------|---------|------|
| `JWT_SECRET` | 90 天 | 轮换后旧 token 在有效期内仍可用 |
| `PII_ENCRYPTION_KEY` | 90 天 | 需配套重新加密存量 PII 数据 |
| `AGNES_API_KEY` | 按需 | API Key 泄露时立即轮换 |
| MongoDB 密码 | 180 天 | 需同步更新 MONGO_URI |

### 5.2 JWT 密钥轮换步骤

```bash
# 1. 生成新密钥
openssl rand -hex 32

# 2. 更新 .env.prod（宿主机执行）
#    JWT_SECRET=<新密钥>

# 3. 滚动重启 app 容器
docker compose up -d --force-recreate app

# 4. 旧 token 在 JWT_EXPIRES_IN 内仍然有效（无需强制登出）
```

### 5.3 PII 密钥轮换步骤

```bash
# 1. 生成新密钥
openssl rand -hex 32

# 2. 更新 .env.prod

# 3. 运行 PII 重新加密脚本（需离线维护窗口）
docker compose exec app node scripts/rotate-pii-encryption.ts

# 4. 滚动重启
docker compose up -d --force-recreate app
```

### 5.4 密钥存储规范

```bash
# 生产密钥文件权限
sudo chmod 600 /opt/legal-agent/.env.prod
sudo chown root:root /opt/legal-agent/.env.prod

# 密钥不得出现在以下位置：
#   - Git 仓库（.env.prod 已在 .gitignore 中排除）
#   - 容器镜像层（使用 --env-file 而非 ENV 指令）
#   - 应用日志（LOG_LEVEL=info，不打印密钥）
```

---

## 6. 安全加固清单

### 6.1 网络隔离

- [x] mongo/redis 端口不映射到宿主机
- [x] app 服务不直接暴露，仅通过 nginx 反代
- [x] 仅 nginx 暴露 443（HTTPS）端口

### 6.2 证书安全

- [x] 证书文件权限 600，属主 root
- [x] nginx 容器以只读方式挂载证书
- [x] 证书续期在宿主机执行，不进入容器

### 6.3 密钥管理

- [x] .env.prod 不在 git 仓库
- [x] 容器启动使用 `--env-file`，密钥不入镜像
- [x] JWT_SECRET / PII_ENCRYPTION_KEY 生产环境强制 32+ 位

### 6.4 运维安全

- [x] 健康检查从宿主机执行（不依赖容器内 curl）
- [x] 备份数据定期清理，保留 7 天
- [x] ECS 安全组仅开放 443 端口

---

## 7. 部署脚本说明

### 7.1 脚本位置

| 脚本 | 路径 | 平台 |
|------|------|------|
| Bash 版 | `scripts/deploy.sh` | Linux/macOS |
| PowerShell 版 | `scripts/deploy.ps1` | Windows（本地构建） |

### 7.2 使用方式

```bash
# Bash 版
./scripts/deploy.sh --domain legal.example.com --tag v0.1.0

# PowerShell 版
.\scripts\deploy.ps1 -Domain "legal.example.com" -Tag "v0.1.0"
```

### 7.3 参数说明

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `--domain` / `-Domain` | 是 | — | 生产域名，用于健康检查 |
| `--tag` / `-Tag` | 否 | git hash | 应用镜像版本号 |

---

## 8. 附录：完整服务清单

| 服务名 | 镜像 | 版本 | 环境变量 | 健康检查端点 |
|--------|------|------|---------|-------------|
| nginx | nginx:1.25-alpine | 1.25 | CORS_ORIGINS, DOMAIN | N/A（反向代理） |
| app | legal-agent:<TAG> | v0.1.0 | NODE_ENV=prod, JWT_SECRET, AGNES_API_KEY... | GET /health |
| mongo | mongo:7 | 7.x | MONGO_INITDB_ROOT_USERNAME/PASSWORD | mongosh ping |
| redis | redis:7-alpine | 7.x | 无 | redis-cli ping |
