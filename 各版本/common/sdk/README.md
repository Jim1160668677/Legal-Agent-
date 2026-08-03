# @legal-agent/sdk

法律智能体统一SDK，支持多平台客户端接入后端API。

## 安装

```bash
# 本地开发
npm install file:../common/sdk

# 或从npm安装
npm install @legal-agent/sdk
```

## 快速开始

```typescript
import { LegalAgentClient } from '@legal-agent/sdk';

const client = new LegalAgentClient({
  baseUrl: 'https://api.legal-agent.com',
  appVersion: '1.0.0',
  clientType: 'web',
});

// 登录
const loginResult = await client.login('phone', '13800138000');
if (loginResult.ok) {
  client.setTokens(loginResult.data.accessToken, loginResult.data.refreshToken);
}

// 对话（SSE流式）
for await (const frame of client.chat({ message: '你好' })) {
  if (frame.type === 'chunk') {
    process.stdout.write(frame.delta);
  } else if (frame.type === 'done') {
    console.log('\n[对话完成]');
  }
}

// 查询Agent
const agents = await client.listAgents();
if (agents.ok) {
  console.log(agents.data.agents);
}
```

## API端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /v1/auth/login | 外部身份登录 |
| POST | /v1/auth/refresh | 刷新token |
| POST | /v1/chat | SSE流式对话 |
| GET | /v1/agents | 列出Agent |
| GET | /v1/knowledge | 知识库查询 |
| GET | /v1/knowledge/categories | 知识库分类 |
| POST | /v1/documents | 同步生成文书 |
| POST | /v1/documents/async | 异步生成文书 |
| GET | /v1/documents/:id | 查询文书 |
| GET | /v1/documents | 我的文书列表 |
| POST | /v1/documents/:id/export | 导出文书 |
| GET | /v1/jobs/:jobId | 任务状态 |
| POST | /v1/vision/recognize | 图像识别 |

## 响应格式

所有API返回统一信封格式：

```typescript
// 成功
{ code: 0, message: 'ok', traceId: string, data: T }

// 失败
{ code: number, message: string, traceId: string, data: null }
```

## SSE帧格式

```typescript
type ChatFrame =
  | { type: 'chunk'; delta: string }           // 文本增量
  | { type: 'meta'; intent: IntentType; ... }  // 元信息
  | { type: 'disclaimer'; text: string }       // 免责声明
  | { type: 'done'; traceId: string }          // 结束
  | { type: 'error'; code: number; message: string }; // 错误
```
