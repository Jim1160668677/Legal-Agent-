# 法律智能体 API 接口规范

## 概述

本文档定义了所有客户端与后端系统通信的标准接口规范。

## 基础信息

- Base URL: `{environment}/v1`
- 认证方式: JWT Bearer Token
- 数据格式: JSON
- 字符编码: UTF-8

## 通用响应格式

```typescript
interface ApiResponse<T> {
  success: boolean;
  data: T;
  error: {
    code: string;
    message: string;
    details?: any;
  } | null;
  meta: {
    traceId: string;
    timestamp: string;
    requestId?: string;
  };
}

// 分页响应
interface PaginatedResponse<T> extends ApiResponse<T> {
  data: {
    items: T[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
  };
}
```

## 认证接口

### 1. 用户登录
**POST** `/auth/login`

**Request Body:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "accessToken": "string",
    "refreshToken": "string",
    "expiresIn": 604800,
    "user": {
      "id": "string",
      "username": "string",
      "role": "user|lawyer|admin",
      "profile": {}
    }
  }
}
```

### 2. 刷新Token
**POST** `/auth/refresh`

**Request Body:**
```json
{
  "refreshToken": "string"
}
```

### 3. 登出
**POST** `/auth/logout`

## 聊天接口

### 1. 开始对话
**POST** `/chat/sessions`

**Request Body:**
```json
{
  "intent": "string",  // 意图分类
  "context": {}        // 上下文信息
}
```

### 2. 发送消息
**POST** `/chat/sessions/{sessionId}/messages`

**Request Body:**
```json
{
  "content": "string",
  "messageType": "text|image|document",
  "metadata": {}
}
```

**Response (SSE流式):**
```
event: message
data: {"content": "...", "done": false}

event: done
data: {"content": "...", "done": true, "usage": {...}}
```

### 3. 获取历史消息
**GET** `/chat/sessions/{sessionId}/messages?page=1&pageSize=20`

### 4. 删除会话
**DELETE** `/chat/sessions/{sessionId}`

## 意图识别接口

### 1. 识别用户意图
**POST** `/intent/recognize`

**Request Body:**
```json
{
  "query": "string",
  "context": {}
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "intent": "string",
    "confidence": 0.95,
    "subIntents": [],
    "entities": []
  }
}
```

## 知识检索接口

### 1. 检索法律知识
**POST** `/knowledge/retrieve`

**Request Body:**
```json
{
  "query": "string",
  "filters": {
    "category": "string",
    "level": "national|local",
    "year": "number"
  },
  "topK": 10
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "string",
        "title": "string",
        "content": "string",
        "source": "law|regulation|case",
        "relevance": 0.92,
        "citation": "string"
      }
    ],
    "total": 100,
    "tookMs": 45
  }
}
```

## 文档生成接口

### 1. 创建文档任务
**POST** `/documents/tasks`

**Request Body:**
```json
{
  "templateId": "string",
  "data": {},
  "options": {
    "format": "docx|pdf",
    "style": "string"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "taskId": "string",
    "status": "pending",
    "estimatedTime": 30
  }
}
```

### 2. 查询任务状态
**GET** `/documents/tasks/{taskId}`

### 3. 下载文档
**GET** `/documents/tasks/{taskId}/download`

## 案件分析接口

### 1. 创建案件分析
**POST** `/cases/analyze`

**Request Body:**
```json
{
  "caseType": "string",
  "facts": "string",
  "evidence": [],
  "requirements": {}
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "analysisId": "string",
    "irac": {
      "issue": [],
      "rule": [],
      "analysis": [],
      "conclusion": "string"
    },
    "riskAssessment": {},
    "recommendations": []
  }
}
```

### 2. 获取分析结果
**GET** `/cases/analyze/{analysisId}`

### 3. 律师审阅
**POST** `/cases/analyze/{analysisId}/review`

**Request Body:**
```json
{
  "reviewerId": "string",
  "comments": "string",
  "rating": "number",
  "suggestions": []
}
```

## 工具调用接口

### 1. 执行工具
**POST** `/tools/execute`

**Request Body:**
```json
{
  "toolName": "string",
  "parameters": {}
}
```

### 2. 工具列表
**GET** `/tools/list`

## 错误码定义

| 错误码 | 含义 | 处理建议 |
|--------|------|----------|
| AUTH_001 | Token过期 | 自动刷新Token |
| AUTH_002 | Token无效 | 重新登录 |
| RATE_001 | 请求频率超限 | 等待后重试 |
| VALID_001 | 参数校验失败 | 检查请求参数 |
| BUS_001 | 业务逻辑错误 | 检查业务状态 |
| SYS_001 | 系统内部错误 | 联系客服 |

## WebSocket实时通信

### 连接地址
```
ws://{host}/ws/chat?token={jwt}
```

### 消息格式
```typescript
interface WsMessage {
  type: 'chat_message' | 'typing' | 'status' | 'error';
  payload: any;
  timestamp: string;
}
```

## SDK使用示例

### TypeScript
```typescript
import { LegalAgentClient } from '@legal-agent/sdk';

const client = new LegalAgentClient({
  baseUrl: 'https://api.legal-agent.com',
  token: 'your-jwt-token'
});

// 发送消息
const response = await client.chat.sendMessage({
  sessionId: 'xxx',
  content: '你好，我想咨询合同纠纷问题'
});
```

### 微信小程序
```javascript
const { LegalAgentClient } = require('@legal-agent/wechat-sdk');

const client = new LegalAgentClient({
  appId: 'your-app-id'
});

// 自动处理微信登录
const user = await client.auth.loginWithWechat();
```

### Android
```kotlin
val client = LegalAgentClient.Builder()
    .setBaseUrl("https://api.legal-agent.com")
    .build()

client.chat.sendMessage("你好")
    .enqueue(object : Callback<MessageResponse> {
        override fun onResponse(...) { ... }
        override fun onFailure(...) { ... }
    })
```

### iOS
```swift
let client = LegalAgentClient(baseURL: "https://api.legal-agent.com")

client.chat.sendMessage("你好") { result in
    switch result {
    case .success(let message): ...
    case .failure(let error): ...
    }
}
```

### HarmonyOS
```typescript
import { LegalAgentClient } from '@legal-agent/harmony-sdk';

const client = new LegalAgentClient({
  baseUrl: 'https://api.legal-agent.com'
});

const response = await client.chat.sendMessage({
  content: '你好'
});
```
