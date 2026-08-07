# 移动端集成指南

## 概述

Legal Agent 移动端 SDK 支持通过本地运行时 API 进行法律咨询、文书生成等操作。移动端与桌面端共享同一套 API，只需修改 baseUrl 即可。

## 安装 SDK

```bash
npm install @legal-agent/sdk
# 或
yarn add @legal-agent/sdk
# 或
pnpm add @legal-agent/sdk
```

## 初始化客户端

### 本地模式（推荐）

```typescript
import { LegalAgentClient } from '@legal-agent/sdk';

// 自动连接本机 127.0.0.1:3000
const client = LegalAgentClient.local();
```

### 手动指定地址

```typescript
import { LegalAgentClient } from '@legal-agent/sdk';

const client = new LegalAgentClient({
  baseUrl: 'http://192.168.1.100:3000',  // 本机局域网 IP
  clientType: 'mobile',
});
```

### 云端模式

```typescript
const client = new LegalAgentClient({
  baseUrl: 'https://api.legal-agent.example.com',
  apiKey: 'your-api-key',
});
```

## 核心 API

### 对话聊天

```typescript
// SSE 流式对话
const frames = client.chat({ message: '帮我分析一份劳动合同的风险' });

for await (const frame of frames) {
  if (frame.type === 'chunk') {
    process.stdout.write(frame.delta);
  } else if (frame.type === 'meta') {
    console.log('意图:', frame.intent);
    console.log('法条引用:', frame.lawRefs);
  } else if (frame.type === 'done') {
    console.log('\n对话完成');
  }
}
```

### 知识库查询

```typescript
const results = await client.listKnowledge({
  keyword: '合同法',
  limit: 10,
});

for (const doc of results.docs) {
  console.log(`${doc.title}: ${doc.snippet}`);
}
```

### 文书生成

```typescript
const result = await client.generateDocument({
  template: '劳动合同',
  data: {
    employer: '某科技有限公司',
    employee: '张三',
    position: '软件工程师',
    salary: 20000,
  },
});

console.log('文档 ID:', result.docId);
console.log('审核状态:', result.reviewStatus);
```

### 律师审核

```typescript
// 提交审核
const review = await client.submitReview({
  docId: 'doc_123',
  type: 'contract',
});

// 查询审核队列
const queue = await client.listReviews({ status: 'pending' });

// 获取审核结果
const result = await client.getReviewResult(review.reviewId);
```

### 案件分析

```typescript
const analysis = await client.analyzeCase({
  caseType: 'labor_dispute',
  facts: '员工张三工作三年后遭遇非法辞退...',
});

console.log('适用法律:', analysis.applicableLaws);
console.log('风险等级:', analysis.riskLevel);
```

## 网络要求

### 局域网访问

移动端与桌面端需在同一局域网：

1. **桌面端**启动本地服务（`npm run electron:dev`）
2. **查找本机 IP**：
   ```bash
   # Windows
   ipconfig | findstr IPv4
   
   # macOS/Linux
   ifconfig | grep inet
   ```
3. **移动端配置**使用本机 IP 而非 127.0.0.1

### 防火墙配置

Windows 防火墙需允许 Node.js 访问 3000 端口：

```powershell
# 添加入站规则
New-NetFirewallRule -DisplayName "Legal Agent API" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

### USB 调试（Android）

通过 ADB 端口转发：

```bash
adb forward tcp:3000 tcp:3000
```

然后移动端使用 `http://10.0.2.2:3000`（Android 模拟器专用回环地址）。

## 错误处理

```typescript
try {
  const result = await client.chat({ message: '你好' });
} catch (error) {
  if (error instanceof NetworkError) {
    console.error('网络连接失败，请检查：');
    console.error('1. 桌面端是否正在运行');
    console.error('2. 移动端是否与桌面端在同一网络');
    console.error('3. 防火墙是否允许 3000 端口');
  } else if (error instanceof AuthError) {
    console.error('认证失败:', error.message);
  }
}
```

## 离线模式

本地运行时完全离线可用，无需互联网连接。所有数据存储在本地 MongoDB，无需云服务。

### 数据同步

如需在多台设备间同步数据：

```typescript
// 导出本地数据
const backup = await client.exportData();
fs.writeFileSync('backup.json', JSON.stringify(backup, null, 2));

// 导入数据
await client.importData(fs.readFileSync('backup.json', 'utf8'));
```

## 安全注意事项

1. **本地模式不启用身份验证**，仅限个人使用
2. **不要在公网暴露** 3000 端口
3. **生产环境**请使用云端 API 并启用认证
