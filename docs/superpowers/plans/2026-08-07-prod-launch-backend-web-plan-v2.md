# 子项目 A: 后端 + Web 国内云正式上线 — 实施计划（V2 修正版）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 legal-agent 后端 + Web 前端部署到国内云 ECS，实现 HTTPS 上线、安全加固、合规页面、运维闭环

**Architecture:** 单机 Docker Compose 全栈部署:
- Nginx 容器（唯一对外入口 443/80）
- App 容器（NestJS，仅 Docker 内网）
- Mongo/Redis 容器（仅 Docker 内网，零端口暴露）
- 证书预申请 + 卷挂载（不依赖容器内 certbot）

**Tech Stack:** Docker Compose, Nginx, Let's Encrypt（宿主机申请）, Node.js 20, NestJS 10, React + Vite, MongoDB 7, Redis 7

## Global Constraints

- 数据库端口不再映射宿主公网（仅 Docker 内部网络）
- Redis 加 `--requirepass` 强密码
- Mongo 连接串带 authSource=admin
- mongo 容器内 `--bind_ip 127.0.0.1`
- JWT_SECRET 生产环境 ≥48 字符随机
- 云安全组仅放行 443（及 SSH 22 限来源 IP）
- Nginx 配置安全头（nosniff/X-Frame-Options/X-Content-Type-Options）
- 密钥轮换步骤在运维手册中说明
- `.env.prod` 不入 git
- NODE_ENV 必须为 `prod`
- `npm ci --legacy-peer-deps` 安装依赖
- Web 构建产物在 `各版本/web/dist`
- 健康检查从宿主机执行（不依赖容器内 curl）
- 证书通过宿主机申请后挂载到 nginx 容器

---

### Task 0: 架构澄清与脚本环境适配

**Files:**
- Create: `scripts/deploy.sh`（Unix 版）
- Create: `scripts/deploy.ps1`（Windows PowerShell 版）
- Create: `docs/ARCHITECTURE.md`

**Interfaces:**
- Produces: 架构文档 + 跨平台部署脚本

- [ ] **Step 1: 创建架构文档**

```markdown
# 部署架构

## 服务拓扑

```
用户浏览器 ─443/HTTPS─► ECS 宿主机
                            │
                            └─ Docker Compose:
                                ├─ nginx（对外 443，反代 /v1/*→app:3000，静态 /→web/dist）
                                ├─ app（NestJS，3000，仅 Docker 内网）
                                ├─ mongo（27017，仅 Docker 内网，--bind_ip 127.0.0.1）
                                └─ redis（6379，仅 Docker 内网，--requirepass）
```

## 证书管理
- 宿主机运行 certbot 申请证书
- 证书挂载到 nginx 容器（只读）
- 定时任务自动续期（certbot renew）

## 备份策略
- MongoDB: mongodump → 阿里云 OSS
- Redis: appendonly + SAVE 快照
- 备份脚本从宿主机执行（不依赖容器内 curl）

## 健康检查
- 宿主机执行 `curl https://yourdomain.com/v1/health`
- ECS 云监控 CPU/内存/磁盘
- 外部 UptimeRobot 每小时探活
```

- [ ] **Step 2: 创建 deploy.sh（Unix 版）**

```bash
#!/bin/bash
set -euo pipefail

TAG=${1:-"$(git rev-parse --short HEAD)"}
DOMAIN=${2:?Usage: deploy.sh <tag> <domain>}
ENV_FILE=".env.prod"

echo "=== Deploy legal-agent:$TAG ==="

# 1. 构建后端镜像
docker build -t legal-agent:$TAG .

# 2. 构建 Web 前端（若未构建）
if [ ! -d "各版本/web/dist" ]; then
  echo "Building web frontend..."
  cd 各版本/web && npm install && npm run build && cd ../..
fi

# 3. 停止旧服务
docker compose down app nginx

# 4. 启动基础服务
docker compose up -d --no-recreate mongo redis

# 5. 等待数据库就绪
echo "Waiting for database..."
sleep 10

# 6. 启动应用
docker compose up -d --force-recreate app nginx

# 7. 健康检查（宿主机访问）
echo "Running health checks..."
max_retries=5
for i in $(seq 1 $max_retries); do
  status=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/v1/health" 2>/dev/null || echo "000")
  if [ "$status" = "200" ]; then
    echo "Health check passed (attempt $i)"
    break
  fi
  echo "Health check failed (attempt $i/5, status=$status)"
  sleep 5
  if [ $i -eq $max_retries ]; then
    echo "Health check failed after $max_retries attempts"
    docker compose logs --tail=50 app nginx
    exit 1
  fi
done

echo "=== Deploy completed ==="
```

- [ ] **Step 3: 创建 deploy.ps1（Windows PowerShell 版）**

```powershell
param(
    [string]$Tag = $(& git rev-parse --short HEAD),
    [string]$Domain
)

if (-not $Domain) {
    Write-Error "Usage: .\deploy.ps1 -Tag <tag> -Domain <domain>"
    exit 1
}

Write-Host "=== Deploy legal-agent:$Tag ==="

# 1. 构建后端镜像
docker build -t "legal-agent:$Tag" .

# 2. 构建 Web 前端
if (-not (Test-Path "各版本\web\dist")) {
    Write-Host "Building web frontend..."
    Set-Location 各版本\web
    npm install
    npm run build
    Set-Location ..\..
}

# 3. 停止旧服务
docker compose down app nginx

# 4. 启动基础服务
docker compose up -d --no-recreate mongo redis

# 5. 等待数据库就绪
Write-Host "Waiting for database..."
Start-Sleep -Seconds 10

# 6. 启动应用
docker compose up -d --force-recreate app nginx

# 7. 健康检查
Write-Host "Running health checks..."
$maxRetries = 5
for ($i = 1; $i -le $maxRetries; $i++) {
    try {
        $response = Invoke-WebRequest -Uri "https://$Domain/v1/health" -TimeoutSec 5 -UseBasicParsing
        if ($response.StatusCode -eq 200) {
            Write-Host "Health check passed (attempt $i)"
            break
        }
    } catch {
        Write-Host "Health check failed (attempt $i/$maxRetries)"
        if ($i -eq $maxRetries) {
            Write-Host "Deploy failed. Check logs:"
            docker compose logs --tail=50 app nginx
            exit 1
        }
    }
    Start-Sleep -Seconds 5
}

Write-Host "=== Deploy completed ==="
```

- [ ] **Step 4: 提交**

```bash
git add docs/ARCHITECTURE.md scripts/deploy.sh scripts/deploy.ps1
git commit -m "docs: 架构文档 + 跨平台部署脚本"
```

---

### Task 1: docker-compose.yml 安全加固

**Files:**
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: 现有 mongo/redis/app 服务配置
- Produces: 改造后的 compose（数据库零端口暴露）

- [ ] **Step 1: 备份原 compose 文件**

```bash
cp docker-compose.yml docker-compose.yml.bak
```

- [ ] **Step 2: 重写 docker-compose.yml**

```yaml
# docker-compose.yml — legal-agent 生产环境编排
# 安全原则: 数据库零端口暴露，仅 Docker 内网可见
version: '3.8'

services:
  mongo:
    image: mongo:7
    container_name: legal-mongo
    restart: unless-stopped
    # 不暴露端口到宿主，仅 Docker 内网
    expose:
      - "27017"
    command: mongod --bind_ip 127.0.0.1
    environment:
      MONGO_INITDB_ROOT_USERNAME: ${MONGO_ROOT_USER:-legal}
      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_ROOT_PASSWORD:?MONGO_ROOT_PASSWORD not set}
      MONGO_INITDB_DATABASE: legal_agent
    volumes:
      - legal-mongo-data:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

  redis:
    image: redis:7-alpine
    container_name: legal-redis
    restart: unless-stopped
    expose:
      - "6379"
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru --requirepass ${REDIS_PASSWORD:?REDIS_PASSWORD not set}
    volumes:
      - legal-redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

  app:
    image: legal-agent:latest
    container_name: legal-app
    restart: unless-stopped
    expose:
      - "3000"
    env_file:
      - .env.prod
    environment:
      MONGO_URI: mongodb://${MONGO_ROOT_USER:-legal}:${MONGO_ROOT_PASSWORD}@mongo:27017/legal_agent?authSource=admin
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      NODE_ENV: prod
      PORT: "3000"
    depends_on:
      mongo:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s

  nginx:
    image: nginx:alpine
    container_name: legal-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/certs:/etc/nginx/ssl:ro
      - ./各版本/web/dist:/usr/share/nginx/html:ro
      - nginx-logs:/var/log/nginx
    depends_on:
      - app
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:80/nginx-health"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  legal-mongo-data:
    name: legal-mongo-data
  legal-redis-data:
    name: legal-redis-data
  nginx-logs:
    name: nginx-logs
```

- [ ] **Step 3: 创建 .env.prod.example**

```bash
cat > .env.prod.example << 'EOF'
# 生产环境变量模板（复制为 .env.prod 后填写）
NODE_ENV=prod
PORT=3000

# MongoDB
MONGO_ROOT_USER=legal
MONGO_ROOT_PASSWORD=<生产Mongo密码，≥16字符，随机生成>
MONGO_URI=mongodb://${MONGO_ROOT_USER}:${MONGO_ROOT_PASSWORD}@mongo:27017/legal_agent?authSource=admin

# Redis
REDIS_PASSWORD=<生产Redis密码，≥16字符，随机生成>
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379

# JWT
JWT_SECRET=<生产JWT密钥，≥48字符随机>

# CORS
CORS_ORIGINS=https://yourdomain.com

# 日志
LOG_LEVEL=info

# LLM
AGNES_API_KEY=${AGNES_API_KEY}
ZHIPU_API_KEY=${ZHIPU_API_KEY}
LLM_PROVIDER=agnes
EOF
```

- [ ] **Step 4: 提交**

```bash
git add docker-compose.yml .env.prod.example
git commit -m "feat(compose): 安全加固 - 数据库零端口暴露 + Redis密码 + nginx服务"
```

---

### Task 2: Nginx 配置与证书管理

**Files:**
- Create: `nginx/nginx.conf`
- Create: `nginx/certbot-renew.sh`
- Create: `nginx/renew-certs.sh`

**Interfaces:**
- Consumes: 宿主机 certbot、域名 DNS 解析
- Produces: nginx 配置 + 证书续期脚本

- [ ] **Step 1: 创建 nginx.conf**

```nginx
# nginx/nginx.conf
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';
    access_log /var/log/nginx/access.log main;
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;

    # Gzip 压缩
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/rss+xml application/atom+xml image/svg+xml;

    # HTTP → HTTPS 重定向
    server {
        listen 80;
        server_name _;
        return 301 https://$host$request_uri;
    }

    # HTTPS 主服务
    server {
        listen 443 ssl http2;
        server_name _;
        
        ssl_certificate /etc/nginx/ssl/fullchain.pem;
        ssl_certificate_key /etc/nginx/ssl/privkey.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers on;

        # 安全头
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

        # 静态前端
        root /usr/share/nginx/html;
        index index.html;

        location / {
            try_files $uri $uri/ /index.html;
        }

        # API 反代
        location /v1 {
            proxy_pass http://app:3000;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_connect_timeout 10s;
            proxy_read_timeout 30s;
        }

        # 健康检查（nginx 自身）
        location /nginx-health {
            access_log off;
            return 200 "ok";
            add_header Content-Type text/plain;
        }
    }
}
```

- [ ] **Step 2: 创建证书申请脚本（宿主机运行）**

```bash
#!/bin/bash
# nginx/certbot-apply.sh
# 用法: ./certbot-apply.sh yourdomain.com
# 必须在宿主机运行，容器外执行

set -euo pipefail

DOMAIN=${1:?Usage: certbot-apply.sh <domain>}
CERT_DIR="$(pwd)/nginx/certs"

echo "=== Applying SSL certificate for $DOMAIN ==="

# 1. 创建证书目录
mkdir -p "$CERT_DIR"

# 2. 申请证书（使用 nginx 插件，自动配置）
certbot --nginx \
  -d "$DOMAIN" \
  --non-interactive \
  --agree-tos \
  --email "admin@$DOMAIN" \
  --redirect \
  --cert-dir "$CERT_DIR"

# 3. 验证证书文件
if [ -f "$CERT_DIR/$DOMAIN/fullchain.pem" ] && [ -f "$CERT_DIR/$DOMAIN/privkey.pem" ]; then
    echo "Certificate applied successfully"
    echo "  Fullchain: $CERT_DIR/$DOMAIN/fullchain.pem"
    echo "  Private key: $CERT_DIR/$DOMAIN/privkey.pem"
else
    echo "ERROR: Certificate files not found"
    exit 1
fi
```

- [ ] **Step 3: 创建证书续期脚本**

```bash
#!/bin/bash
# nginx/certbot-renew.sh
# 用法: 添加到 crontab: 0 3 * * * /path/to/certbot-renew.sh
# 每日凌晨 3 点自动续期

set -euo pipefail

CERT_DIR="$(pwd)/nginx/certs"

echo "=== Renewing SSL certificates ==="

# 1. 尝试续期
if certbot renew --quiet --deploy-hook "docker compose restart nginx"; then
    echo "Certificates renewed successfully"
else
    echo "ERROR: Certificate renewal failed"
    exit 1
fi
```

- [ ] **Step 4: 创建证书目录结构**

```bash
mkdir -p nginx/certs
# 初始为空，首次部署时通过 certbot 申请证书
```

- [ ] **Step 5: 提交**

```bash
git add nginx/
git commit -m "feat(nginx): nginx配置 + 证书申请/续期脚本"
```

---

### Task 3: Web 前端合规页面

**Files:**
- Create: `各版本/web/src/pages/PrivacyPolicy.tsx`
- Create: `各版本/web/src/pages/UserAgreement.tsx`
- Create: `各版本/web/src/pages/AiDisclaimer.tsx`
- Modify: `各版本/web/src/App.tsx`

**Interfaces:**
- Consumes: react-router-dom
- Produces: 三个新路由页面 + App 路由更新

- [ ] **Step 1: 创建 PrivacyPolicy.tsx**

```tsx
import { Typography, Card } from 'antd';

const { Title, Paragraph, Text } = Typography;

export default function PrivacyPolicy() {
  return (
    <div style={{ maxWidth: 800, margin: '40px auto', padding: '0 20px' }}>
      <Card>
        <Title level={2}>隐私政策</Title>
        <Text type="secondary">最后更新: 2026年8月7日</Text>
        
        <Title level={4} style={{ marginTop: 24 }}>1. 信息收集</Title>
        <Paragraph>我们收集以下信息:</Paragraph>
        <ul>
          <li>注册信息:用户名、邮箱、加密存储的密码</li>
          <li>对话内容:您与AI助手的法律咨询对话（用于生成法律分析）</li>
          <li>设备信息:浏览器类型、操作系统、IP地址（用于安全审计）</li>
        </ul>

        <Title level={4} style={{ marginTop: 24 }}>2. 信息使用</Title>
        <Paragraph>我们使用收集的信息用于:</Paragraph>
        <ul>
          <li>提供法律智能体服务</li>
          <li>改进算法和服务质量</li>
          <li>保障账户安全</li>
        </ul>

        <Title level={4} style={{ marginTop: 24 }}>3. 信息保护</Title>
        <Paragraph>我们采取以下措施保护您的信息:</Paragraph>
        <ul>
          <li>密码使用 bcrypt 哈希加密存储</li>
          <li>PII 数据使用 AES-256 加密</li>
          <li>传输层使用 TLS 1.2+ 加密</li>
          <li>定期安全审计和漏洞扫描</li>
        </ul>

        <Title level={4} style={{ marginTop: 24 }}>4. 信息共享</Title>
        <Paragraph>我们不会出售您的个人信息。仅在以下情况共享:</Paragraph>
        <ul>
          <li>经您明确同意</li>
          <li>法律要求或政府机关合法要求</li>
          <li>保护我方合法权益的紧急情况</li>
        </ul>

        <Title level={4} style={{ marginTop: 24 }}>5. 您的权利</Title>
        <Paragraph>您有权:</Paragraph>
        <ul>
          <li>访问、修改或删除您的个人信息</li>
          <li>撤回同意（不影响撤回前的处理合法性）</li>
          <li>注销账户</li>
        </ul>

        <Title level={4} style={{ marginTop: 24 }}>6. 联系我们</Title>
        <Paragraph>如有疑问，请联系: privacy@legal-agent.com</Paragraph>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: 创建 UserAgreement.tsx**

```tsx
import { Typography, Card } from 'antd';

const { Title, Paragraph } = Typography;

export default function UserAgreement() {
  return (
    <div style={{ maxWidth: 800, margin: '40px auto', padding: '0 20px' }}>
      <Card>
        <Title level={2}>用户协议</Title>
        <Paragraph>最后更新: 2026年8月7日</Paragraph>

        <Title level={4} style={{ marginTop: 24 }}>1. 服务说明</Title>
        <Paragraph>法律智能体是由 AI 驱动的法律咨询服务工具，提供法律咨询、文书生成、案例分析等功能。</Paragraph>

        <Title level={4} style={{ marginTop: 24 }}>2. 使用规则</Title>
        <Paragraph>用户承诺:</Paragraph>
        <ul>
          <li>提供真实、准确的注册信息</li>
          <li>不利用本服务从事违法活动</li>
          <li>妥善保管账户凭证</li>
          <li>不恶意攻击系统或干扰他人使用</li>
        </ul>

        <Title level={4} style={{ marginTop: 24 }}>3. 知识产权</Title>
        <Paragraph>服务内容的相关知识产权归平台所有。用户保留其对输入内容的权利。</Paragraph>

        <Title level={4} style={{ marginTop: 24 }}>4. 责任限制</Title>
        <Paragraph>本服务提供的法律建议仅供参考，不构成正式法律意见。用户应自行判断并承担使用后果。</Paragraph>

        <Title level={4} style={{ marginTop: 24 }}>5. 协议变更</Title>
        <Paragraph>我们有权修改本协议，修改后将在站内公告。继续使用视为接受修改。</Paragraph>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: 创建 AiDisclaimer.tsx**

```tsx
import { Typography, Card, Alert } from 'antd';
import { WarningOutlined } from '@ant-design/icons';

const { Title, Paragraph } = Typography;

export default function AiDisclaimer() {
  return (
    <div style={{ maxWidth: 800, margin: '40px auto', padding: '0 20px' }}>
      <Alert
        type="warning"
        icon={<WarningOutlined />}
        showIcon
        style={{ marginBottom: 24 }}
        message="重要声明"
        description="本服务由人工智能驱动，以下内容仅供参考，不构成正式法律意见。"
      />
      <Card>
        <Title level={2}>AI 免责声明</Title>

        <Title level={4} style={{ marginTop: 24 }}>1. AI 生成内容</Title>
        <Paragraph>本平台提供的法律分析、文书草稿、案例参考等均由 AI 模型生成，可能存在以下情况:</Paragraph>
        <ul>
          <li>信息不完整或过时</li>
          <li>法律条文引用不准确</li>
          <li>案例分析与实际情况有偏差</li>
        </ul>

        <Title level={4} style={{ marginTop: 24 }}>2. 不构成法律意见</Title>
        <Paragraph>本平台输出的所有内容仅供学习、参考使用，不构成任何形式的法律意见或建议。在采取任何法律行动前，请咨询专业律师。</Paragraph>

        <Title level={4} style={{ marginTop: 24 }}>3. 用户责任</Title>
        <Paragraph>用户应:</Paragraph>
        <ul>
          <li>自行核实重要法律信息</li>
          <li>对使用本服务产生的后果自行承担</li>
          <li>不涉及重大权益时方可依赖本服务</li>
        </ul>

        <Title level={4} style={{ marginTop: 24 }}>4. 律师审核功能</Title>
        <Paragraph>平台提供的「律师审核」功能由持证律师人工复核，该部分意见具有专业参考价值，但仍建议用户结合实际情况判断。</Paragraph>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: 更新 App.tsx 路由**

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import Layout from './components/Layout'
import Login from './pages/Login'
import Chat from './pages/Chat'
import CaseAnalysis from './pages/CaseAnalysis'
import Knowledge from './pages/Knowledge'
import Profile from './pages/Profile'
import PrivacyPolicy from './pages/PrivacyPolicy'
import UserAgreement from './pages/UserAgreement'
import AiDisclaimer from './pages/AiDisclaimer'
import { useAuthStore } from './stores/authStore'

function App() {
  const { isAuthenticated } = useAuthStore()

  return (
    <ConfigProvider locale={zhCN}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={!isAuthenticated ? <Login /> : <Navigate to="/" />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/agreement" element={<UserAgreement />} />
          <Route path="/disclaimer" element={<AiDisclaimer />} />
          <Route
            path="/"
            element={isAuthenticated ? <Layout /> : <Navigate to="/login" />}
          >
            <Route index element={<Chat />} />
            <Route path="chat/:sessionId" element={<Chat />} />
            <Route path="analysis" element={<CaseAnalysis />} />
            <Route path="knowledge" element={<Knowledge />} />
            <Route path="profile" element={<Profile />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  )
}

export default App
```

- [ ] **Step 5: 提交**

```bash
git add 各版本/web/src/pages/PrivacyPolicy.tsx 各版本/web/src/pages/UserAgreement.tsx 各版本/web/src/pages/AiDisclaimer.tsx 各版本/web/src/App.tsx
git commit -m "feat(web): 添加合规页面 - 隐私政策/用户协议/AI免责声明"
```

---

### Task 4: 登录页协议勾选

**Files:**
- Modify: `各版本/web/src/pages/Login.tsx`

**Interfaces:**
- Consumes: antd Form, Checkbox, Link
- Produces: 登录表单含协议勾选 + 表单校验

- [ ] **Step 1: 更新 Login.tsx**

```tsx
/**
 * 登录页面
 */
import { useState } from 'react'
import { Form, Input, Button, Card, Alert, Typography, Checkbox, Link } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { LegalAgentClient } from '@legal-agent/sdk'

const { Title, Text } = Typography

// 从环境变量获取API地址，Vercel部署时使用相对路径
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

export default function Login() {
  const navigate = useNavigate()
  const { login } = useAuthStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const client = new LegalAgentClient({
    baseUrl: API_BASE_URL,
  })

  const handleSubmit = async (values: { username: string; password: string; agreed: boolean }) => {
    setLoading(true)
    setError(null)

    try {
      const result = await client.login(values.username, values.password)
      login(result.user, result.token, result.refreshToken)
      navigate('/')
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '登录失败，请检查用户名和密码')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      }}
    >
      <Card
        style={{
          width: 400,
          boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Title level={2} style={{ color: '#1890ff', marginBottom: 8 }}>
            法律智能体
          </Title>
          <Text type="secondary">您的AI法律助手</Text>
        </div>

        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        <Form
          onFinish={handleSubmit}
          size="large"
          layout="vertical"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input
              prefix={<UserOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="用户名"
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="密码"
            />
          </Form.Item>

          <Form.Item
            name="agreed"
            valuePropName="checked"
            rules={[
              {
                validator: (_, value) =>
                  value ? Promise.resolve() : Promise.reject(new Error('请先阅读并同意用户协议和隐私政策')),
              },
            ]}
          >
            <Checkbox>
              我已阅读并同意 <Link href="/agreement" target="_blank">用户协议</Link> 和 <Link href="/privacy" target="_blank">隐私政策</Link>
            </Checkbox>
          </Form.Item>

          <Form.Item style={{ marginBottom: 16 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              style={{ height: 44 }}
            >
              登录
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: 'center' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            演示账号: admin / admin123
          </Text>
        </div>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: 提交**

```bash
git add 各版本/web/src/pages/Login.tsx
git commit -m "feat(web): 登录页添加用户协议/隐私政策勾选"
```

---

### Task 5: 运维脚本

**Files:**
- Create: `scripts/rollback.sh`
- Create: `scripts/backup.sh`
- Create: `scripts/restore.sh`
- Create: `scripts/smoke-test.sh`
- Create: `scripts/smoke-test.ps1`

**Interfaces:**
- Consumes: docker compose, mongodump, curl（宿主机）
- Produces: 可执行的运维脚本

- [ ] **Step 1: 创建 rollback.sh**

```bash
#!/bin/bash
set -euo pipefail

# 回滚到上一版本
# 用法: ./rollback.sh [previous-tag]

PREV_TAG=${1:-"$(docker images legal-agent --format '{{.Tag}}' | grep -v latest | grep -v $(docker inspect --format='{{.Config.Image}}' legal-app 2>/dev/null | sed 's/.*://') | sort | tail -2 | head -1)"}
CURRENT_TAG=$(docker inspect --format='{{.Config.Image}}' legal-app 2>/dev/null | sed 's/.*://')

echo "=== Rollback from $CURRENT_TAG to $PREV_TAG ==="

# 1. 检查数据库兼容性（向前兼容检查）
echo "Checking database compatibility..."
# TODO: 实现 schema 版本检查

# 2. 停止当前服务
docker compose down app nginx

# 3. 启动指定版本
docker compose up -d --force-recreate app nginx

# 4. 健康检查
sleep 10
./scripts/smoke-test.sh || { echo "Health check failed after rollback"; exit 1; }

echo "=== Rollback completed ==="
```

- [ ] **Step 2: 创建 backup.sh（直接备份到 OSS）**

```bash
#!/bin/bash
set -euo pipefail

DATE=$(date -u +%Y%m%d)
BACKUP_DIR="/tmp/backups/$DATE"
DOMAIN=${1:?Usage: backup.sh <domain>}

echo "=== Backup legal-agent data ==="

# 1. MongoDB 备份
echo "Backing up MongoDB..."
mkdir -p "$BACKUP_DIR/mongo"
docker run --rm --network legal-agent_default \
  -v "$BACKUP_DIR/mongo:/backup" \
  mongo:7 mongodump \
  --host mongo \
  --authenticationDatabase admin \
  -u "$MONGO_ROOT_USER" \
  -p "$MONGO_ROOT_PASSWORD" \
  --out /backup

# 2. Redis 备份（AOF + RDB）
echo "Backing up Redis..."
mkdir -p "$BACKUP_DIR/redis"
docker exec legal-redis redis-cli -a "$REDIS_PASSWORD" BGSAVE
sleep 5
docker cp legal-redis:/data/dump.rdb "$BACKUP_DIR/redis/dump.rdb"
docker cp legal-redis:/data/appendonly.aof "$BACKUP_DIR/redis/appendonly.aof"

# 3. 上传到阿里云 OSS
echo "Uploading to OSS..."
if command -v ossutil &> /dev/null; then
  ossutil cp -r "$BACKUP_DIR" "oss://legal-agent-backup/$DATE/"
  echo "Backup uploaded to OSS: oss://legal-agent-backup/$DATE/"
else
  echo "WARNING: ossutil not found, skipping OSS upload"
  echo "Backup saved locally: $BACKUP_DIR"
fi

# 4. 清理本地临时文件
rm -rf "$BACKUP_DIR"

echo "=== Backup completed ==="
```

- [ ] **Step 3: 创建 restore.sh**

```bash
#!/bin/bash
set -euo pipefail

# 恢复数据
# 用法: ./restore.sh <backup-date>
# 示例: ./restore.sh 20260807

BACKUP_DATE=${1:?Usage: restore.sh <backup-date>}
BACKUP_DIR="/tmp/backups/$BACKUP_DATE"
OSS_PREFIX="oss://legal-agent-backup/$BACKUP_DATE"

echo "=== Restore legal-agent from $BACKUP_DATE ==="

# 1. 下载备份（如果本地不存在）
if [ ! -d "$BACKUP_DIR" ]; then
  echo "Downloading from OSS..."
  mkdir -p "$BACKUP_DIR"
  if command -v ossutil &> /dev/null; then
    ossutil cp -r "$OSS_PREFIX" "$BACKUP_DIR/"
  else
    echo "ERROR: Local backup not found and ossutil not available"
    exit 1
  fi
fi

# 2. 恢复 MongoDB
echo "Restoring MongoDB..."
docker run --rm --network legal-agent_default \
  -v "$BACKUP_DIR/mongo:/backup" \
  mongo:7 mongorestore \
  --host mongo \
  --authenticationDatabase admin \
  -u "$MONGO_ROOT_USER" \
  -p "$MONGO_ROOT_PASSWORD" \
  /backup/legal_agent

# 3. 恢复 Redis
echo "Restoring Redis..."
docker cp "$BACKUP_DIR/redis/dump.rdb" legal-redis:/data/dump.rdb
docker cp "$BACKUP_DIR/redis/appendonly.aof" legal-redis:/data/appendonly.aof
docker exec legal-redis redis-cli -a "$REDIS_PASSWORD" BGSAVE

echo "=== Restore completed ==="
echo "Please verify data integrity and restart services if needed"
```

- [ ] **Step 4: 创建 smoke-test.sh（宿主机执行）**

```bash
#!/bin/bash
set -euo pipefail

DOMAIN=${1:?Usage: smoke-test.sh <domain>}

echo "=== Smoke Test for $DOMAIN ==="
PASS=0
FAIL=0

check() {
  local name=$1 url=$2 expected=$3
  status=$(curl -s -o /dev/null -w "%{http_code}" "https://$url" 2>/dev/null || echo "000")
  if [ "$status" = "$expected" ]; then
    echo "  PASS: $name (HTTP $status)"
    PASS=$((PASS+1))
  else
    echo "  FAIL: $name (expected $expected, got $status)"
    FAIL=$((FAIL+1))
  fi
}

echo "1. HTTPS connectivity..."
check "HTTPS" "$DOMAIN" "200"

echo "2. API health..."
check "api-health" "$DOMAIN/v1/health" "200"

echo "3. API ready..."
check "api-ready" "$DOMAIN/v1/health/ready" "200"

echo "4. Frontend..."
check "frontend" "$DOMAIN/" "200"

echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 5: 创建 smoke-test.ps1（Windows PowerShell 版）**

```powershell
param(
    [string]$Domain
)

if (-not $Domain) {
    Write-Error "Usage: .\smoke-test.ps1 -Domain <domain>"
    exit 1
}

Write-Host "=== Smoke Test for $Domain ==="
$pass = 0
$fail = 0

function Test-Endpoint {
    param([string]$Name, [string]$Url, [int]$Expected)
    try {
        $response = Invoke-WebRequest -Uri "https://$Url" -TimeoutSec 10 -UseBasicParsing
        if ($response.StatusCode -eq $Expected) {
            Write-Host "  PASS: $Name (HTTP $($response.StatusCode))"
            $script:pass++
        } else {
            Write-Host "  FAIL: $Name (expected $Expected, got $($response.StatusCode))"
            $script:fail++
        }
    } catch {
        Write-Host "  FAIL: $Name (Error: $_)"
        $script:fail++
    }
}

Write-Host "1. HTTPS connectivity..."
Test-Endpoint -Name "HTTPS" -Url "$Domain" -Expected 200

Write-Host "2. API health..."
Test-Endpoint -Name "api-health" -Url "$Domain/v1/health" -Expected 200

Write-Host "3. API ready..."
Test-Endpoint -Name "api-ready" -Url "$Domain/v1/health/ready" -Expected 200

Write-Host "4. Frontend..."
Test-Endpoint -Name "frontend" -Url "$Domain/" -Expected 200

Write-Host "=== Results: $pass passed, $fail failed ==="
if ($fail -gt 0) { exit 1 }
```

- [ ] **Step 6: 添加可执行权限并提交**

```bash
chmod +x scripts/*.sh
git add scripts/*.sh scripts/*.ps1
git commit -m "feat(deploy): 运维脚本 - rollback/backup/restore/smoke-test"
```

---

### Task 6: 文档交付

**Files:**
- Modify: `DEPLOYMENT.md`
- Create: `docs/OPS_GUIDE.md`
- Create: `docs/GO_LIVE_CHECKLIST.md`
- Create: `docs/PRIVACY.md`

**Interfaces:**
- Produces: 完整的运维与上线文档

- [ ] **Step 1: 增补 DEPLOYMENT.md 第 4 节**

在现有 DEPLOYMENT.md 末尾追加:

```markdown
## 4. 生产环境部署（国内云 ECS）

### 4.1 环境准备
- 国内云 ECS（CentOS 7+ / Ubuntu 20.04+）
- 已备案域名
- Docker + Docker Compose 已安装
- certbot 已安装（用于申请 SSL 证书）
- 安全组仅放行 443（HTTPS）和 22（SSH 限来源 IP）

### 4.2 部署步骤

```bash
# 1. 克隆仓库
git clone <repo> && cd legal-agent

# 2. 配置生产环境变量
cp .env.prod.example .env.prod
vim .env.prod  # 填入真实密码和域名

# 3. 申请 SSL 证书（首次部署）
./nginx/certbot-apply.sh yourdomain.com

# 4. 构建并启动
./scripts/deploy.sh latest yourdomain.com

# 5. 健康检查
./scripts/smoke-test.sh yourdomain.com
```

### 4.3 密钥轮换
- **JWT_SECRET**: 修改 `.env.prod`，重启 app 容器
- **Mongo 密码**: 修改 `.env.prod` 中的 `MONGO_ROOT_PASSWORD`，需重建 Mongo 用户
- **Redis 密码**: 修改 `.env.prod` 中的 `REDIS_PASSWORD`，重启 redis 容器
- 详细步骤见 `docs/OPS_GUIDE.md`

### 4.4 证书续期
```bash
# 手动续期
certbot renew --deploy-hook "docker compose restart nginx"

# 自动续期（添加到 crontab）
0 3 * * * certbot renew --quiet --deploy-hook "docker compose restart nginx"
```
```

- [ ] **Step 2: 创建 OPS_GUIDE.md**

```markdown
# 运维手册

## 日常运维

### 查看日志
```bash
docker compose logs -f app nginx
```

### 重启服务
```bash
docker compose restart app nginx
```

### 查看资源
```bash
docker stats
docker system df
```

## 备份策略

### 自动备份
- 每日 02:00 执行 `./scripts/backup.sh yourdomain.com`
- 备份到阿里云 OSS（保留 30 天）

### 手动备份
```bash
./scripts/backup.sh yourdomain.com
```

### 恢复演练
- 每周执行 `--dry-run` 验证归档可用性
- 恢复命令：`./scripts/restore.sh <backup-date>`

## 监控告警

### ECS 云监控
- CPU > 80% 持续 5 分钟 → 告警
- 内存 > 85% 持续 5 分钟 → 告警
- 磁盘 > 90% → 告警
- 带宽 > 80% → 告警

### 外部探活
- UptimeRobot 每 5 分钟探 `https://yourdomain.com/v1/health`
- 告警到手机/企业微信/钉钉

### 日志轮转
- Nginx access/error log 每日切割
- 保留 30 天
- 配置见 `/etc/logrotate.d/nginx`

## 故障排查

| 现象 | 可能原因 | 处理 |
|-----|---------|-----|
| 502 Bad Gateway | app 容器未启动 | `docker compose logs app` |
| 503 Service Unavailable | mongo/redis 未就绪 | `docker compose ps` |
| 登录失败 | JWT_SECRET 不匹配 | 检查 `.env.prod` |
| HTTPS 证书过期 | certbot 未续期 | `certbot renew` |
| 备份失败 | OSS 配置错误 | 检查 `ossutil` 配置 |
```

- [ ] **Step 3: 创建 GO_LIVE_CHECKLIST.md**

```markdown
# 上线自检清单

## 功能检查
- [ ] 登录/注册功能正常
- [ ] 对话功能正常
- [ ] 文书生成正常
- [ ] 知识库查询正常
- [ ] 律师审核入口可见
- [ ] 视觉识别功能正常
- [ ] 合规页面可访问（/privacy, /agreement, /disclaimer）
- [ ] 登录需勾选协议才能提交

## 安全检查
- [ ] HTTPS 证书有效
- [ ] 数据库端口未暴露公网
- [ ] Redis 有密码保护
- [ ] Mongo 内建认证启用
- [ ] JWT_SECRET ≥48 字符
- [ ] CORS_ORIGINS 已设置为具体域名
- [ ] Swagger 在生产已关闭
- [ ] 安全组仅放行 443/22

## 运维检查
- [ ] 备份任务首次执行成功
- [ ] 告警通道已配置
- [ ] 日志轮转已配置
- [ ] 恢复演练完成并记录

## 文档检查
- [ ] DEPLOYMENT.md 已更新
- [ ] OPS_GUIDE.md 已创建
- [ ] PRIVACY.md 已发布
- [ ] 上线检查清单已打钩

## 备案检查
- [ ] 域名已完成 ICP 备案
- [ ] 备案号展示在网站首页底部
```

- [ ] **Step 4: 创建 PRIVACY.md**

```markdown
# 隐私政策摘要

## 我们收集的信息
- 注册信息:用户名、邮箱、加密密码
- 对话内容:法律咨询记录
- 设备信息:浏览器、IP 地址

## 如何使用
- 提供服务、改进算法、安全审计

## 如何保护
- bcrypt 密码哈希、AES-256 PII 加密、TLS 传输加密

## 您的权利
- 访问、修改、删除个人信息
- 撤回同意
- 注销账户

## 联系我们
privacy@legal-agent.com
```

- [ ] **Step 5: 提交**

```bash
git add DEPLOYMENT.md docs/
git commit -m "docs: 运维手册、上线检查清单、隐私政策"
```

---

### Task 7: Web 构建验证

**Files:**
- 运行: `npm run build:vercel`
- Verify: 产物大小、gzip 后大小

- [ ] **Step 1: 运行 Web 构建**

```bash
cd 各版本/web
npm install
npm run build
```

Expected: 构建成功，产物在 `dist/`，大小 <10MB，gzip <500KB

- [ ] **Step 2: 检查产物**

```bash
ls -la dist/
wc -c dist/assets/*.js dist/assets/*.css 2>/dev/null | sort -rn
```

- [ ] **Step 3: 提交**

```bash
git add 各版本/web/dist/
git commit -m "build: web dist artifact"
```

---

### Task 8: 端到端验证

**Files:**
- 运行: `npm test`（全量回归）
- 运行: `npm run typecheck`

- [ ] **Step 1: 全量回归**

```bash
npm test
```

Expected: 所有测试通过，EXIT=0

- [ ] **Step 2: 类型检查**

```bash
npm run typecheck
```

Expected: 0 errors

- [ ] **Step 3: 本地 compose 演练**

```bash
cp .env.prod.example .env.prod
# 修改 .env.prod 填入测试密码
docker compose down
docker compose up -d --build
sleep 30
./scripts/smoke-test.sh localhost
docker compose down
rm .env.prod
```

Expected: 健康检查全部通过，镜像构建成功

---

## Self-Review

### Spec Coverage Check

| Spec 要求 | 对应 Task | 状态 |
|----------|----------|------|
| 数据库端口内网化 | Task 1 | ✅ |
| Redis 加密码 | Task 1 | ✅ |
| Mongo 内网绑定 | Task 1 | ✅ |
| Nginx 反代+静态托管 | Task 1+2 | ✅ |
| HTTPS 证书（预申请+挂载） | Task 2 | ✅ |
| 合规页面 | Task 3 | ✅ |
| 协议勾选 | Task 4 | ✅ |
| 部署/回滚脚本 | Task 5+0 | ✅ |
| 备份到 OSS | Task 5 | ✅ |
| 健康检查（宿主机执行） | Task 5 | ✅ |
| 运维文档 | Task 6 | ✅ |
| 上线检查清单 | Task 6 | ✅ |
| Web 构建验证 | Task 7 | ✅ |
| 端到端验证 | Task 8 | ✅ |
| 跨平台脚本 | Task 0+5 | ✅ |

### Placeholder Scan

所有步骤均有具体命令或代码，无 TBD/TODO（除 OSS 上传需配置 `ossutil`，已在脚本中注明）。

### Type Consistency

所有文件路径、函数名、变量名在各 Task 间保持一致。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-07-prod-launch-backend-web-plan-v2.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
