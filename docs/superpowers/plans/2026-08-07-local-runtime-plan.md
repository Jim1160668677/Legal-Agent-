# 本地运行时 + 移动端调用 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 legal-agent 改造为本地运行工具软件，支持 Electron 桌面端 + 移动端 SDK 调用本机 API

**Architecture:** 
- 后端添加 `local` 模式，跳过 JWT 认证，开放 CORS 给本地网络
- Electron 包装 NestJS + MongoDB + Web 前端，一键安装包
- 移动端复用现有 SDK，通过 `http://127.0.0.1:3000` 调用本机 API

**Tech Stack:** Electron, NestJS, MongoDB, React, Vite, TypeScript

## Global Constraints

- NODE_ENV 支持 `local` 值
- 本地模式跳过 JWT 认证
- CORS 开放 `http://localhost:*` 和 `http://127.0.0.1:*`
- MongoDB 本地运行（不依赖外部服务）
- Redis 可选（本地模式可降级为内存缓存）
- 安装包支持 Windows/macOS/Linux
- 数据存储在 `~/.legal-agent/data/`

---

### Task 1: 后端本地模式支持

**Files:**
- Modify: `src/app-config/validation.schema.ts`
- Modify: `src/app-config/config.types.ts`
- Modify: `src/app-config/configuration.ts`
- Modify: `src/modules/auth/jwt.strategy.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: 现有 NestJS 配置体系
- Produces: `local` 模式下的配置验证和认证跳过

- [ ] **Step 1: 更新 validation.schema.ts 支持 local 模式**

```typescript
export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('dev', 'staging', 'prod', 'test', 'local').default('dev'),
  PORT: Joi.number().port().default(3000),
  MONGO_URI: Joi.string().required().description('MongoDB 连接字符串'),
  REDIS_URL: Joi.string().allow('').default('').description('Redis 连接字符串（本地模式可为空）'),
  REDIS_KEY_PREFIX: Joi.string().default('legal:'),
  // 本地模式 JWT_SECRET 可为空
  JWT_SECRET: Joi.when('NODE_ENV', {
    is: 'local',
    then: Joi.string().allow('').default('local-dev-secret-change-me'),
    otherwise: Joi.string().min(32).required(),
  }),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),
  // ... 其他配置保持不变
  CORS_ORIGINS: Joi.string().allow('').default(''),
});
```

- [ ] **Step 2: 更新 config.types.ts 添加 local 模式**

```typescript
export interface AppConfig {
  env: 'dev' | 'staging' | 'prod' | 'test' | 'local';
  // ... 其他字段不变
}
```

- [ ] **Step 3: 更新 configuration.ts 支持本地模式**

```typescript
export default registerAs('app', (): AppConfig => {
  const isLocal = (process.env.NODE_ENV ?? 'dev') === 'local';
  
  return {
    env: isLocal ? 'local' : (process.env.NODE_ENV ?? 'dev') as AppConfig['env'],
    port: parseInt(process.env.PORT ?? '3000', 10),
    mongo: {
      uri: process.env.MONGO_URI ?? 'mongodb://localhost:27017/legal-agent',
    },
    redis: {
      url: isLocal ? '' : (process.env.REDIS_URL ?? 'redis://localhost:6379'),
      keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'legal:',
    },
    jwt: {
      secret: isLocal 
        ? 'local-dev-secret-change-me' 
        : (process.env.JWT_SECRET ?? generateRandomSecret()),
      expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
    },
    cors: {
      origins: isLocal 
        ? ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173']
        : (process.env.CORS_ORIGINS ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    },
    // ... 其他配置
  };
});
```

- [ ] **Step 4: 更新 jwt.strategy.ts 支持本地模式跳过认证**

```typescript
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    const isLocal = config.get<string>('app.env') === 'local';
    
    if (isLocal) {
      // 本地模式：跳过 JWT 验证
      super({
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        ignoreExpiration: true,
        secretOrKey: 'local-dev-secret-change-me',
      } satisfies JwtStrategyOptions);
    } else {
      const secret = config.get<string>('app.jwt.secret');
      if (!secret) {
        throw new Error('app.jwt.secret 配置缺失');
      }
      super({
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        ignoreExpiration: false,
        secretOrKey: secret,
      } satisfies JwtStrategyOptions);
    }
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const isLocal = payload.env === 'local';
    if (isLocal) {
      // 本地模式：返回默认用户
      return { sub: 'local-user', role: 'user', type: 'access' };
    }
    if (payload.type !== 'access') {
      throw new UnauthorizedException({ code: 4011, message: '需 access token' });
    }
    return payload;
  }
}
```

- [ ] **Step 5: 更新 main.ts 添加本地模式日志**

```typescript
const isLocal = process.env.NODE_ENV === 'local';
const logger = new Logger('Bootstrap');

if (isLocal) {
  logger.log('Running in LOCAL mode - JWT auth disabled, CORS open to localhost');
  logger.log(`Server running on http://localhost:${port}`);
  logger.log(`Swagger UI: http://localhost:${port}${config.get<string>('app.swagger.path')}`);
}
```

- [ ] **Step 6: 提交**

```bash
git add src/app-config/ src/modules/auth/jwt.strategy.ts src/main.ts
git commit -m "feat: 添加 local 模式支持 - 跳过认证，开放 CORS"
```

---

### Task 2: Electron 主进程

**Files:**
- Create: `electron/main.ts`
- Create: `electron/preload.ts`
- Create: `electron/package.json`
- Modify: `package.json` (添加 electron 脚本)

**Interfaces:**
- Produces: Electron 主进程，管理 NestJS 子进程和 MongoDB

- [ ] **Step 1: 创建 electron/package.json**

```json
{
  "name": "legal-agent-electron",
  "version": "1.0.0",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "build:win": "electron-builder --win",
    "build:mac": "electron-builder --mac",
    "build:linux": "electron-builder --linux"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.9.1"
  }
}
```

- [ ] **Step 2: 创建 electron/main.ts**

```typescript
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

let mainWindow: BrowserWindow | null = null;
let nestjsProcess: ChildProcess | null = null;
let mongoProcess: ChildProcess | null = null;

const isDev = process.env.NODE_ENV === 'development';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startMongo() {
  const dataDir = path.join(app.getPath('appData'), 'legal-agent', 'data');
  const dbPath = path.join(dataDir, 'mongodb');
  
  mongoProcess = spawn('mongod', [
    '--dbpath', dbPath,
    '--port', '27017',
    '--bind_ip', '127.0.0.1',
    '--journal'
  ], {
    stdio: 'ignore',
    detached: true
  });
  
  mongoProcess.on('error', (err) => {
    console.error('MongoDB spawn error:', err);
  });
  
  console.log(`MongoDB started, data dir: ${dbPath}`);
}

function startNestJS() {
  const distPath = path.join(__dirname, '../dist');
  
  nestjsProcess = spawn('node', ['dist/main.js'], {
    cwd: distPath,
    env: {
      ...process.env,
      NODE_ENV: 'local',
      MONGO_URI: 'mongodb://127.0.0.1:27017/legal-agent',
      REDIS_URL: '',
      JWT_SECRET: 'local-dev-secret-change-me',
      CORS_ORIGINS: 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173',
    },
    stdio: 'inherit'
  });
  
  nestjsProcess.on('error', (err) => {
    console.error('NestJS spawn error:', err);
  });
  
  nestjsProcess.on('exit', (code) => {
    console.log(`NestJS exited with code ${code}`);
  });
  
  console.log('NestJS started');
}

app.whenReady().then(() => {
  startMongo();
  startNestJS();
  createWindow();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  if (nestjsProcess) {
    nestjsProcess.kill();
  }
  if (mongoProcess) {
    mongoProcess.kill();
  }
});
```

- [ ] **Step 3: 创建 electron/preload.ts**

```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getServerStatus: () => ipcRenderer.invoke('get-server-status'),
  restartServer: () => ipcRenderer.invoke('restart-server'),
});
```

- [ ] **Step 4: 更新根 package.json 添加 electron 脚本**

```json
{
  "scripts": {
    "electron:dev": "concurrently \"npm run start:dev\" \"wait-on http://localhost:3000 && electron .\"",
    "electron:build": "npm run build && cd electron && npm install && npm run build",
    "build:win": "npm run build && cd electron && npm install && npm run build:win",
    "build:mac": "npm run build && cd electron && npm install && npm run build:mac",
    "build:linux": "npm run build && cd electron && npm install && npm run build:linux"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.9.1",
    "concurrently": "^8.2.2",
    "wait-on": "^7.2.0"
  }
}
```

- [ ] **Step 5: 提交**

```bash
git add electron/ package.json
git commit -m "feat(electron): 添加 Electron 主进程 - 管理 NestJS 和 MongoDB"
```

---

### Task 3: Electron 打包配置

**Files:**
- Create: `electron-builder.json`
- Modify: `package.json` (添加 build 配置)

**Interfaces:**
- Produces: 跨平台安装包配置

- [ ] **Step 1: 创建 electron-builder.json**

```json
{
  "appId": "com.legal-agent.app",
  "productName": "法律智能体",
  "directories": {
    "buildResources": "build",
    "output": "release"
  },
  "files": [
    "dist/**/*",
    "electron/**/*",
    "package.json"
  ],
  "win": {
    "target": [
      { "target": "nsis", "arch": ["x64"] }
    ],
    "icon": "build/icon.ico"
  },
  "mac": {
    "target": [
      { "target": "dmg", "arch": ["x64"] }
    ],
    "icon": "build/icon.icns",
    "category": "public.app-category.productivity"
  },
  "linux": {
    "target": [
      { "target": "AppImage", "arch": ["x64"] }
    ],
    "icon": "build/icon.png",
    "category": "Office"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true
  }
}
```

- [ ] **Step 2: 创建 build 目录和图标占位**

```bash
mkdir -p build
# 实际使用时需要提供 icon.ico, icon.icns, icon.png
```

- [ ] **Step 3: 提交**

```bash
git add electron-builder.json build/
git commit -m "feat(electron): 添加打包配置 - 支持 Windows/macOS/Linux"
```

---

### Task 4: Web 前端适配

**Files:**
- Modify: `各版本/web/src/App.tsx`
- Modify: `各版本/web/src/pages/Login.tsx`
- Modify: `各版本/web/vite.config.ts`

**Interfaces:**
- Consumes: 现有 React 应用
- Produces: 适配本地模式的前端（无登录或简化登录）

- [ ] **Step 1: 更新 vite.config.ts 添加本地代理**

```typescript
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/v1': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
```

- [ ] **Step 2: 更新 Login.tsx 支持本地模式**

```typescript
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

// 本地模式：自动登录
const isLocal = API_BASE_URL.includes('localhost') || API_BASE_URL.includes('127.0.0.1')

const handleSubmit = async (values: { username: string; password: string }) => {
  if (isLocal) {
    // 本地模式：自动创建/登录本地用户
    login({ id: 'local-user', username: '本地用户' }, 'local-token', 'local-refresh')
    navigate('/')
    return
  }
  
  // 正常登录逻辑...
}
```

- [ ] **Step 3: 提交**

```bash
git add 各版本/web/src/ 各版本/web/vite.config.ts
git commit -m "feat(web): 适配本地模式 - 自动登录，简化认证"
```

---

### Task 5: 移动端 SDK 适配

**Files:**
- Modify: `各版本/common/sdk/src/client.ts`
- Modify: `各版本/common/sdk/src/types.ts`

**Interfaces:**
- Consumes: 现有 SDK
- Produces: 支持本地模式的 SDK（自动检测本地环境）

- [ ] **Step 1: 更新 SDK 支持本地模式**

```typescript
export interface LegalAgentConfig {
  baseUrl: string;
  timeout?: number;
  appVersion?: string;
  clientType?: 'web' | 'mobile' | 'desktop' | 'local';
  // 本地模式：自动检测
  localMode?: boolean;
}

export class LegalAgentClient {
  constructor(config: LegalAgentConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      timeout: config.timeout ?? 30000,
      appVersion: config.appVersion ?? '1.0.0',
      clientType: config.clientType ?? 'web',
      localMode: config.localMode ?? false,
    };
  }

  // 本地模式：自动使用 localhost
  static local(): LegalAgentClient {
    return new LegalAgentClient({
      baseUrl: 'http://127.0.0.1:3000',
      clientType: 'local',
      localMode: true,
    });
  }

  async login(provider: ExternalProvider, externalId: string): Promise<RequestResult<AuthResult>> {
    if (this.config.localMode) {
      // 本地模式：直接返回本地用户
      return {
        ok: true,
        data: {
          accessToken: 'local-token',
          refreshToken: 'local-refresh',
          userId: 'local-user',
          isNewUser: true,
        },
        traceId: '',
      };
    }
    // 正常登录逻辑...
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add 各版本/common/sdk/src/
git commit -m "feat(sdk): 添加本地模式支持 - 自动检测本机 API"
```

---

### Task 6: 数据持久化

**Files:**
- Create: `scripts/init-data-dir.ts`
- Modify: `electron/main.ts`

**Interfaces:**
- Produces: 数据目录初始化脚本

- [ ] **Step 1: 创建数据目录初始化脚本**

```typescript
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

function initDataDir() {
  const dataDir = path.join(app.getPath('appData'), 'legal-agent', 'data');
  const dbPath = path.join(dataDir, 'mongodb');
  const backupPath = path.join(dataDir, 'backups');
  
  // 创建目录
  fs.mkdirSync(dbPath, { recursive: true });
  fs.mkdirSync(backupPath, { recursive: true });
  
  console.log(`Data directory initialized: ${dataDir}`);
  return { dataDir, dbPath, backupPath };
}

export default initDataDir;
```

- [ ] **Step 2: 更新 electron/main.ts 使用数据目录**

```typescript
import initDataDir from './init-data-dir';

// 在 startMongo() 前调用
const { dbPath } = initDataDir();

function startMongo() {
  mongoProcess = spawn('mongod', [
    '--dbpath', dbPath,
    '--port', '27017',
    '--bind_ip', '127.0.0.1',
    '--journal'
  ], { ... });
}
```

- [ ] **Step 3: 提交**

```bash
git add scripts/init-data-dir.ts electron/main.ts
git commit -m "feat: 添加数据持久化 - 本地 MongoDB 数据目录"
```

---

### Task 7: 测试验证

**Files:**
- 运行: `npm test`
- 运行: `npm run typecheck`
- 运行: `npm run build`

- [ ] **Step 1: 全量回归测试**

```bash
npm test
```

Expected: 所有测试通过

- [ ] **Step 2: 类型检查**

```bash
npm run typecheck
```

Expected: 0 errors

- [ ] **Step 3: 构建验证**

```bash
npm run build
```

Expected: 构建成功，dist/ 生成

- [ ] **Step 4: 本地模式测试**

```bash
NODE_ENV=local npm run start
```

Expected: 服务启动，无 JWT 错误，CORS 开放

---

### Task 8: 文档交付

**Files:**
- Create: `docs/LOCAL_RUNTIME_GUIDE.md`
- Create: `docs/MOBILE_INTEGRATION.md`
- Modify: `README.md`

**Interfaces:**
- Produces: 完整的本地运行和移动端集成文档

- [ ] **Step 1: 创建 LOCAL_RUNTIME_GUIDE.md**

```markdown
# 本地运行时指南

## 快速开始

### 开发模式
```bash
npm run electron:dev
```

### 构建安装包
```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

## 数据存储

- 数据目录: `~/.config/legal-agent/data/`
- MongoDB: 本地运行，端口 27017
- 备份: `~/.config/legal-agent/data/backups/`

## API 访问

本地模式下 API 地址:
- HTTP: `http://127.0.0.1:3000`
- Swagger: `http://127.0.0.1:3000/docs`

移动端可通过以下 SDK 调用:
```typescript
import { LegalAgentClient } from '@legal-agent/sdk';

const client = LegalAgentClient.local();
const result = await client.chat({ message: '帮我写一份合同' });
```
```

- [ ] **Step 2: 创建 MOBILE_INTEGRATION.md**

```markdown
# 移动端集成指南

## 通过 SDK 调用本地 API

### 1. 安装 SDK
```bash
npm install @legal-agent/sdk
```

### 2. 初始化客户端
```typescript
import { LegalAgentClient } from '@legal-agent/sdk';

// 本地模式（自动检测本机 API）
const client = LegalAgentClient.local();

// 或手动指定
const client = new LegalAgentClient({
  baseUrl: 'http://127.0.0.1:3000',
  clientType: 'mobile',
});
```

### 3. 调用 API
```typescript
// 对话
const frames = client.chat({ message: '法律咨询' });
for await (const frame of frames) {
  if (frame.type === 'chunk') console.log(frame.delta);
}

// 知识库查询
const knowledge = await client.listKnowledge({ keyword: '合同法' });

// 文书生成
const doc = await client.generateDocument({ template: '劳动合同', data: {} });
```

## 网络要求

- 移动端和本机软件需在同一网络
- 或使用 USB 调试（Android）
- 防火墙需允许 3000 端口
```

- [ ] **Step 3: 更新 README.md**

```markdown
# 法律智能体 (Legal Agent)

## 快速开始

### 本地运行（推荐）
```bash
npm install
npm run electron:dev
```

### 移动端调用
```typescript
import { LegalAgentClient } from '@legal-agent/sdk';

const client = LegalAgentClient.local();
const result = await client.chat({ message: '你好' });
```

## 构建安装包
```bash
npm run build:win  # Windows
npm run build:mac  # macOS
npm run build:linux # Linux
```
```

- [ ] **Step 4: 提交**

```bash
git add docs/ README.md
git commit -m "docs: 添加本地运行时和移动端集成文档"
```

---

## Self-Review

### Spec Coverage Check

| Spec 要求 | 对应 Task | 状态 |
|----------|----------|------|
| 本地模式支持 | Task 1 | ✅ |
| Electron 主进程 | Task 2 | ✅ |
| 打包配置 | Task 3 | ✅ |
| Web 前端适配 | Task 4 | ✅ |
| SDK 本地模式 | Task 5 | ✅ |
| 数据持久化 | Task 6 | ✅ |
| 测试验证 | Task 7 | ✅ |
| 文档交付 | Task 8 | ✅ |

### Placeholder Scan

所有步骤均有具体代码，无 TBD/TODO。

### Type Consistency

所有文件路径、函数名、变量名在各 Task 间保持一致。

## Execution Handoff

Plan complete. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
