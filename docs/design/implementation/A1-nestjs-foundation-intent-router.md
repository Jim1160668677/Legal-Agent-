﻿# A1 · NestJS 工程脚手架 + 意图识别 + 三层混合架构基础

> 阶段：A1（后端业务补齐第一步） | 对应 v2.3 路线图阶段一 | 前置依赖：无（起点）
> 技术栈：NestJS 10 + TypeScript 5 + MongoDB 6（Mongoose）+ Redis 7
> 目标：把 legal-agent 从纯后端库升级为可独立部署的 NestJS 服务，打通"鉴权 → 意图识别 → 规则/知识层 → chat SSE 流式"主链路，完成微信云开发 → 独立后端的基础设施迁移。

---

## 一、范围与目标

| 范围 | 说明 |
|------|------|
| NestJS 工程骨架 | 目录结构、配置管理、MongoDB/Redis 接入、全局拦截器/守卫/过滤器 |
| 平台横切模块（7 个） | AuthService(JWT)、PiiService、AuditLog、Logger、CacheService、FeatureFlag、ContentSafety |
| 意图识别 | IntentRouter（8 IntentType、关键词+正则打分、置信度路由、LLM 辅助） |
| 规则层 | RuleEngine（法条/FAQ 精确匹配，无 LLM） |
| 知识层骨架 | KnowledgeBase 占位接口（A2 完整实现检索） |
| 记忆管理 | MemoryManager（会话历史读写） |
| chat 接口 | ChatController（SSE 流式，三层混合降级链） |
| 评测基础 | intent_eval_set >= 200 条 + 评测脚本 |

**不在 A1 范围**：向量检索与 RAG（A2）、文书生成（A3）、多 Agent 编排（A4）、对外 OpenAPI/MCP（A5）。

---

## 二、前置依赖

- Node.js >= 18（实测 v24 兼容）
- MongoDB >= 6.0（推荐 Atlas M10+，便于 A2 直接启用 Vector Search）
- Redis >= 7（缓存与限流计数）
- 现有 src/services/legal/llm/* 代码（agnesProvider/http/sse/retry/errors）**原样复用**，迁入 NestJS Provider
- Agnes API Key（已在 .env）

---

## 三、NestJS 工程结构

```
legal-agent/
├── src/
│   ├── main.ts                      # bootstrap：helmet、cors、ValidationPipe
│   ├── app.module.ts                # 根模块
│   ├── config/                      # @nestjs/config + Joi 校验
│   ├── common/
│   │   ├── filters/http-exception.filter.ts     # 业务异常 → {code,message,traceId,data:null}
│   │   ├── interceptors/            # response / logging / audit
│   │   ├── guards/                  # jwt-auth / role
│   │   ├── decorators/              # @CurrentUser @Audit
│   │   └── pipes/
│   ├── modules/
│   │   ├── auth/                    # AuthService + JwtStrategy + 登录/刷新
│   │   ├── legal/
│   │   │   ├── intent/              # IntentRouter + legalIntents.ts
│   │   │   ├── rule/                # RuleEngine + lawArticles.ts
│   │   │   ├── knowledge/           # KnowledgeBase（A1 占位，A2 实现）
│   │   │   ├── memory/              # MemoryManager
│   │   │   ├── llm/                 # 迁入现有 agnesProvider 等
│   │   │   └── chat/                # ChatController (SSE)
│   │   └── platform/                # PiiService/AuditLog/Logger/CacheService/FeatureFlag/ContentSafety
│   ├── infra/
│   │   ├── database/                # Mongoose schemas
│   │   └── storage/                 # ObjectStorage 抽象（A1 预留接口）
│   └── data/                        # legalIntents.ts、lawArticles.ts
├── test/
│   ├── unit/
│   ├── integration/
│   └── eval/intent-eval.ts
└── .env.example
```

**依赖原则**（沿用 02 六层架构）：common/platform 横切不反向依赖业务；legal/* 为 L4 能力层纯逻辑；modules/legal/chat 为 L3 服务层编排；A4 引入的 Agent 层位于 L3.5，包装 L4。

---

## 四、配置管理

使用 @nestjs/config + Joi 校验，禁止硬编码：

```typescript
export default registerAs('app', () => ({
  env: process.env.NODE_ENV ?? 'dev',
  port: parseInt(process.env.PORT ?? '3000', 10),
  mongo: { uri: process.env.MONGO_URI },
  redis: { url: process.env.REDIS_URL },
  jwt: { secret: process.env.JWT_SECRET, expiresIn: '7d' },
  llm: {
    provider: process.env.LLM_PROVIDER ?? 'agnes',
    agnes: { apiKey: process.env.AGNES_API_KEY, baseUrl: process.env.AGNES_BASE_URL, model: process.env.AGNES_DEFAULT_MODEL },
  },
  rateLimit: { perUserChatPerMin: 20, perUserLlmPerDay: 50, globalChatQps: 500 },
}));
```

环境：dev / staging / prod，密钥一律走环境变量，不入仓库。

---
## 五、MongoDB 接入与 A1 涉及集合

MongooseModule.forRootAsync 注入 ConfigService。A1 需落地的 9 个集合（schema 在 src/infra/database/schemas/）：

| 集合 | Mongoose Schema 要点 | 关键索引 |
|------|---------------------|---------|
| user_profile | userId:String(唯一)、phoneHash:String(sparse唯一)、nameHash、legalPreferences:Object、privacyAcceptedVersion:String | idx_phoneHash、idx_lastActiveAt |
| dialog_record | sessionId:String、userId:String、messages:[{role,content,ts,traceId}]、context:Object、expireAt:Date | idx_userId_updatedAt、idx_sessionId、TTL idx_expireAt(90d) |
| law_article | lawName,articleNo,articleNoInt,category,content,keywords:[String],province,legalHierarchy,status,contentHash | idx_category_articleNoInt、idx_lawName_articleNoInt、idx_keywords(多键)、idx_contentHash |
| legal_knowledge | type,category,subCategory,title,content,structured:Object,lawRefs:[String],tags:[String] | idx_type_category、idx_tags(多键) |
| intent_eval_set | text,expectedIntent,expectedRoute,category,difficulty,source,version:Number | idx_expectedIntent、idx_difficulty |
| audit_log | ts,traceId,userId,event,func,ip,detail:Object,result,expireAt:Date | idx_userId_ts、idx_event_ts、idx_traceId、TTL 180d |
| feature_flag | flagKey(唯一),enabled:Boolean,rolloutPercent:Number,whitelist:[String] | — |
| llm_cache | promptHash(唯一),model,promptVersion,intent,response,affectedLawArticles:[String],hitCount,expireAt:Date | idx_promptHash、idx_affectedLawArticles(多键)、TTL 7d |
| feedback | userId,type,relatedMsgId,content,contact,status,assignee | idx_status_createdAt、idx_userId |

**迁移要点**（来自 05 差异分析）：
- _id 不再复用 openid，改用 ObjectId；userId 为内部 UUID，openid/手机号等外部身份存 user_profile.externalIdentities
- L4 字段（如后续 case_record.facts）在 schema 层标注，由 PiiService 应用层加密后入库
- 脱敏字段（user_profile.name/phone）写入前由 PiiService 哈希/截断
- TTL 索引在 schema 用 expires 显式声明，时区统一 ISO 8601 UTC

---

## 六、平台横切模块（7 个）

### 6.1 AuthService（替代 openid 鉴权）

```typescript
class AuthService {
  async loginByPhone(phone: string, code: string): Promise<{ accessToken: string; refreshToken: string; userId: string }>;
  async verifyJwt(token: string): Promise<JwtPayload>;        // { userId, role?, iat, exp }
  async mapExternalIdentity(provider: 'phone'|'wechat'|'email', externalId: string): Promise<string>; // -> internal userId
  async checkOwner(resourceOwnerId: string, callerId: string): Promise<boolean>;   // 防 4031 横向越权
  async requireRole(caller: JwtPayload, role: 'ops'|'audit'|'admin'): Promise<void>; // 防 4032
}
```

- 用 passport-jwt + @nestjs/jwt；access token 7d，refresh token 30d
- 手机号验证码登录（A1 可先用密码登录占位，短信网关后续接）
- mapExternalIdentity 保留微信 openid -> userId 映射，为未来小程序端共存预留

### 6.2 PiiService

```typescript
class PiiService {
  classify(text: string): PiiLevel;                 // L1 公开 / L2 一般 / L3 敏感 / L4 高敏
  mask(text: string, level: PiiLevel): string;      // 脱敏（手机号 -> 138****1234）
  encrypt(plain: string): string;                   // L4 字段 AES-256-GCM 加密入库
  decrypt(cipher: string): string;
  assertBoundary(inputLevel: PiiLevel, allowedLevel: PiiLevel): void; // 超界抛 7004
}
```

### 6.3 AuditLog（异步非阻塞）

```typescript
class AuditLog {
  async write(event: AuditEvent, detail: object, ctx: RequestContext): Promise<void>;
  // 事件：user_login / chat_send / agent_invoke / degradation / compliance_blocked ...
}
```

- 用 setImmediate 避免阻塞主流程；traceId 贯穿

### 6.4 Logger

- Winston 或 Pino，JSON 行格式，字段对齐 02 第 8.1 节（ts/level/traceId/userId/func/intent/route/durationMs/llmCalled/cacheHit/msg）
- RequestContext 通过 AsyncLocalStorage 传递 traceId

### 6.5 CacheService（替代云函数内存缓存 + llm_cache）

```typescript
class CacheService {
  async get<T>(key: string): Promise<T | null>;      // L2 Redis
  async set<T>(key: string, val: T, ttlSec: number): Promise<void>;
  async getLlmCache(promptHash: string): Promise<string | null>;  // L3 llm_cache 集合
  async invalidateByLawArticle(articleIds: string[]): Promise<void>; // 法条更新时批量失效
}
```

### 6.6 FeatureFlag

- 读 feature_flag 集合，isEnabled(flagKey, userId) 按 rolloutPercent + whitelist 判定
- 灰度维度从 openid 哈希改为 userId 哈希取模

### 6.7 ContentSafety（可插拔 Provider）

```typescript
interface ContentSafetyProvider { checkText(text: string): Promise<{ safe: boolean; reason?: string }>; }
```

- A1 默认接腾讯云内容安全；阿里云绿网作为备选适配器；命中违规抛 6002

---

## 七、IntentRouter（核心）

**权威源**：07 第一节。8 个 IntentType：

| IntentType | 默认 Route | 复杂度 |
|-----------|-----------|--------|
| legal_qa | rule/knowledge | 低 |
| document_generate | llm | 高 |
| process_guide | knowledge | 中 |
| case_analysis | llm | 高 |
| case_reasoning | reasoning | 高 |
| material_checklist | knowledge | 中 |
| tool_invoke | tool | 中 |
| general_qa | llm(兜底) | — |

### 7.1 接口

```typescript
interface IntentResult {
  intent: IntentType;
  confidence: number;
  route: RouteTarget;          // rule|knowledge|llm|tool|reasoning|general_qa
  candidates: { intent: IntentType; score: number }[];
  fallbackUsed: boolean;
  toolIdHint?: string;
}

class IntentRouter {
  async classify(input: string, ctx: DialogContext): Promise<IntentResult>;
  async assistWithLlm(text: string, candidates: IntentType[]): Promise<IntentType>;
}
```

### 7.2 打分算法（关键词+正则加权）

意图定义库 src/data/legalIntents.ts，每意图含 keywords[{word,weight}] + patterns[{regex,weight}] + categoryHints。

```
score(intent) = Σ(命中kw.weight × idf(kw) × positionBoost)
              + Σ(命中pattern.weight × 1.5)
              + contextBonus
```

- idf(kw) = log(N / df(kw))，冷僻词权重更高
- positionBoost：命中在句首前 20% ×1.2
- contextBonus：ctx.lastIntent == intent 且 3 轮内 +0.15
- 归一化：confidence = score(top) / (score(top) + Σ score(others))，sigmoid 平滑

### 7.3 置信度路由

- confidence >= 0.8 -> 直路由
- 0.5 <= confidence < 0.8 -> top3 候选调 assistWithLlm（用 Agnes 轻量模型）
- confidence < 0.5 -> route = general_qa
- 无任何命中 -> 询问式澄清；未响应 -> general_qa

---
## 八、RuleEngine（规则层）

```typescript
interface RuleResult { answer: string; lawRefs: LawRef[]; ruleId: string; }

class RuleEngine {
  async query(input: string): Promise<RuleResult | null>;
}
```

- src/data/lawArticles.ts 常用 200 条法条快取（内存 Map），按法条名+条号或关键词精确匹配
- 命中即返回，不向下走（成本最优）；法条引用直接来自 law_article，verified=true

---

## 九、MemoryManager

```typescript
class MemoryManager {
  async getRelevantMemories(intent: IntentType, userId: string): Promise<MemoryEntry[]>;
  async saveMemory(entry: MemoryEntry, ctx: RequestContext): Promise<void>;
  async getRecentDialog(userId: string, sessionId: string, limit: number): Promise<DialogMessage[]>;
}
```

- 会话历史存 dialog_record，TTL 90 天
- getRelevantMemories 提取最近 3 轮 + 用户偏好（user_profile.legalPreferences）

---

## 十、ChatController（SSE 流式）

```typescript
@Post('v1/chat')
@UseGuards(JwtAuthGuard)
async chat(@Body() dto: ChatDto, @CurrentUser() user, @Res() res: Response): Promise<void> {
  // 1. 限流（4291）
  // 2. ContentSafety 输入校验（6002）
  // 3. MemoryManager.getRelevantMemories
  // 4. 三层混合降级链：
  //    rule 命中? -> 返回 RuleResult
  //    knowledge 命中且置信高? -> KnowledgeBase（A1 占位，A2 实现）
  //    否则 -> LlmService.stream（复用 agnesProvider）
  // 5. 法条引用校验 validateLawRefs
  // 6. 注入免责声明
  // 7. 写审计 chat_send
  // 8. SSE 帧序列：[chunk]* -> [meta] -> [disclaimer] -> [done]
}
```

**SSE 帧格式**（沿用 06 第六节）：

```
[chunk]      { "delta": "离婚诉讼", "traceId": "..." }
[meta]       { "intent": "process_guide", "route": "knowledge", "lawRefs": [...] }
[disclaimer] { "text": "以上内容仅供参考，不构成法律意见……" }
[done]       { "msgId": "m2", "sessionId": "sess_xxx" }
[error]      { "code": 5003, "message": "LLM 降级中" }
```

**降级链**（02 第 4.2 节）：规则 -> 知识库 -> LLM -> 知识库 Top-3 + 引导人工咨询；降级事件写 audit_log(event=degradation) 并告警。

---

## 十一、微信云开发 -> NestJS 迁移映射表

| 原 v2.3（微信云开发） | NestJS 实现 | 改造点 |
|----------------------|------------|--------|
| chat 云函数 | ChatController + SSE | 直接 HTTP/SSE |
| gateway 云函数 | 全局中间件 + Guard + Interceptor | NestJS 标准管道 |
| openid 鉴权 | JWT（passport-jwt） | 新增登录端点；openid 映射保留 |
| 微信云数据库 | Mongoose + MongoDB | schema 显式声明索引 |
| 云函数内存缓存 | Redis（L2） | — |
| llm_cache 集合 | 保留，CacheService 统一抽象 | — |
| 微信内容安全 | ContentSafetyProvider（腾讯云/阿里云） | 可插拔 |
| 微信订阅消息 | A1 不实现（A4 通知模块） | 抽象 NotificationChannel |
| 云存储 | ObjectStorage 接口（S3/OSS 适配器） | A1 预留接口 |
| 云开发日志服务 | Winston/Pino + ELK | — |
| 定时触发器 | @nestjs/schedule | A2/A4 使用 |
| 灰度按 openid 哈希 | 按 userId 哈希 | — |

---
## 十二、评测：intent_eval_set

- **集合**：intent_eval_set >= 200 条，覆盖 8 意图 × 3 难度（easy/medium/hard）
- **来源**：manual + feedback 回流 + synthetic（LLM 合成后人工核）
- **指标**：top-1 >= 80%、top-3 >= 95%、各意图 F1 >= 0.75、fallback 率 <= 10%
- **脚本**：test/eval/intent-eval.ts，CI 跑批，准确率回归 > 2% 阻断合并
- **迭代**：失败案例回流 intent_eval_set(source=feedback)

---

## 十三、验收标准

| # | 标准 | 验证方式 |
|---|------|---------|
| 1 | NestJS 服务可独立启动，/health 返回 200 | curl |
| 2 | 8 类意图可识别，top-1 >= 80% | intent-eval 脚本 |
| 3 | POST /v1/chat SSE 流式可用，首 token < 1s | 集成测试 |
| 4 | 规则层法条查询 < 100ms | 性能测试 |
| 5 | 免责声明 100% 附加 | 单测 + 出口校验 |
| 6 | 审计日志正常写入 audit_log | 数据库验证 |
| 7 | JWT 鉴权生效，越权返回 4031/4032 | 安全测试 |
| 8 | LLM 不可用时降级链生效 | 故障注入测试 |
| 9 | intent_eval_set 200 条 + 评测脚本可跑 | 文件检查 |
| 10 | 现有 agnesProvider 105 测试用例全部通过 | vitest |

---

## 十四、风险与对策

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| 意图准确率不达标 | 中 | 高 | 评测集先行；失败案例回流；关键词库两周一迭代 |
| SSE 在 NestJS 网关兼容性 | 中 | 中 | 用 @Sse() 或手动 res.write；Nginx 关闭 buffering |
| MongoDB 连接池耗尽 | 低 | 中 | Mongoose poolSize 调优 |
| vitest 与 NestJS Jest 冲突 | 中 | 低 | vitest 跑原 llm 层；NestJS 用 Jest 跑模块测试；两套并行 |
| 手机号登录短信网关未接入 | 高 | 中 | A1 先用密码登录占位；短信网关 A4 接 |

---

## 十五、交付物清单

- src/main.ts、src/app.module.ts 及上述目录全部文件
- 9 个 Mongoose schema
- 7 个平台横切模块
- IntentRouter + data/legalIntents.ts（8 意图关键词库）
- RuleEngine + data/lawArticles.ts（200 条快取）
- MemoryManager、ChatController(SSE)
- test/eval/intent-eval.ts + intent_eval_set 200 条种子数据
- .env.example 更新（Mongo/Redis/JWT/限流配置项）
- README.md 更新启动说明

**预计工期**：4 周（与 v2.3 阶段一一致，纯后端，不含小程序前端）。
