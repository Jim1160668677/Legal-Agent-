# 本地运行时指南

## 概述

Legal Agent 本地运行时模式允许完全离线在本地机器上运行法律智能体服务，无需云依赖。内置本地 MongoDB、本地 NestJS API、Electron 桌面客户端。

## 快速开始

### 开发模式

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
Copy-Item .env.example .env
# 编辑 .env，确认 MONGO_URI=mongodb://localhost:27017/legal-agent，NODE_ENV=local

# 3. 启动（自动启动 NestJS + Electron + 本地 MongoDB）
npm run electron:dev
```

### 构建安装包

```powershell
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

构建产物位于 `electron/release/` 目录。

## 架构

```
electron/
  ├── main.ts        # 主进程：启动 MongoDB + NestJS child + Electron window
  ├── preload.ts     # 预加载脚本（IPC 安全桥）
  └── package.json   # Electron 应用包配置

src/local-mode/
  └── local-mode.module.ts   # 本地模式模块（禁用外部依赖注入）

src/
  ├── main.ts          # NestJS 入口（NODE_ENV=local 时走本地配置）
  ├── app-config/
  │   ├── configuration.ts    # 配置工厂（local 模式无 Redis/JWT 固定值）
  │   └── validation.schema.ts # 环境变量校验（local 模式放宽）
  └── modules/auth/
      └── jwt.strategy.ts      # JwtStrategy（local 模式免认证）
```

## 数据存储

### 数据目录

| 平台 | 路径 |
|------|------|
| Windows | `%APPDATA%\legal-agent\data\` |
| macOS | `~/Library/Application Support/legal-agent/data/` |
| Linux | `~/.config/legal-agent/data/` |

### 子目录

```
data/
  ├── mongodb/          # 本地 MongoDB 数据文件
  ├── backups/          # 自动备份（每天）
  └── logs/             # 应用日志
```

### 手动备份

```bash
# 备份数据目录
cp -r ~/.config/legal-agent/data/mongodb ~/.config/legal-agent/data/backups/mongodb-$(date +%Y%m%d)

# 恢复
cp -r ~/.config/legal-agent/data/backups/mongodb-20260808 ~/.config/legal-agent/data/mongodb
```

## API 访问

本地模式下 API 地址：

- **HTTP API**: `http://127.0.0.1:3000`
- **Swagger UI**: `http://127.0.0.1:3000/docs`
- **健康检查**: `http://127.0.0.1:3000/health`

### 主要端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/auth/login` | POST | 本地模式免登录，任意凭证即可 |
| `/v1/chat` | POST | SSE 流式对话 |
| `/v1/agents` | GET | 列出 Agent 列表 |
| `/v1/documents/async` | POST | 异步文书生成 |
| `/v1/reviews/queue` | GET | 律师审核队列 |

## 移动端对接

移动端通过局域网访问本机 API：

```typescript
import { LegalAgentClient } from '@legal-agent/sdk';

// 本地模式（自动检测 127.0.0.1）
const client = LegalAgentClient.local();

// 或指定本机 IP
const client = new LegalAgentClient({
  baseUrl: 'http://192.168.1.100:3000',
  clientType: 'mobile',
});
```

> **注意**：移动端与本机需在同一局域网。

## 故障排查

### MongoDB 启动失败

```bash
# 检查端口占用
netstat -ano | findstr :27017

# 手动启动 MongoDB（如果自动启动失败）
mongod --dbpath "%APPDATA%\legal-agent\data\mongodb" --port 27017
```

### 端口冲突

```bash
# 修改 .env 中的端口
PORT=3001
```

### 查看日志

```bash
# Electron 日志
type "%APPDATA%\legal-agent\data\logs\main.log"

# NestJS 日志
type "%APPDATA%\legal-agent\data\logs\nestjs.log"
```
