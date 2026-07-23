# A3 · 文书生成 + LLM 集成增强

> 阶段：A3（后端业务补齐第三步） | 对应 v2.3 路线图阶段三 | 前置依赖：A1（NestJS 工程、LlmService、CacheService）、A2（RagService 提供上下文）
> 技术栈：现有 agnesProvider + Prompt 模板版本管理 + docx/pdf 渲染 + 对象存储
> 目标：在已集成的 Agnes LLM 基础上，补齐 Prompt 模板管理、缓存接入、熔断降级；实现法律文书 DSL 解析、变量填充、校验、导出全链路。

---

## 一、范围与目标

| 范围 | 说明 |
|------|------|
| LlmService 增强 | 在现有 agnesProvider 基础上补 Prompt 模板版本管理、缓存接入、熔断 |
| DocumentGenerator | 文书模板 DSL 解析 + 变量填充 + 字段校验 + 渲染 |
| ExportService | docx/pdf 生成 + 对象存储回链（替代微信云存储） |
| 文书模板 | 4 类文书模板（起诉状/合同/律师函/答辩状）|
| 文书 API | document-generate 接口（异步任务，对接 JobService 雏形） |
| 文书评测 | 4 类 × 5 场景 = 20 用例 |

**不在 A3 范围**：ClauseRecommender（v2.3 阶段九）、文书版本管理（v2.3 阶段九）、多 Agent 编排（A4）。

---

## 二、前置依赖

- A1 全部交付物（LlmService、CacheService、AuditLog、PiiService）
- A2 的 RagService（文书生成时检索相关法条作为上下文）
- 对象存储服务（S3/OSS/MinIO，替代微信云存储）
- docx 渲染库（docx-templater 或 officegen）+ pdf 渲染库（puppeteer 或 pdfkit）

---

## 三、LlmService 增强

现有 src/services/legal/llm/ 已实现 agnesProvider/http/sse/retry/errors/lawRefExtractor。A3 在此基础上补齐：

### 3.1 Prompt 模板版本管理

```typescript
// src/modules/legal/llm/prompt-registry.ts
interface PromptTemplate {
  templateId: string;           // 如 'legal_qa_v1', 'document_generate_v1'
  version: number;
  systemPrompt: string;
  userPromptTemplate: string;   // 含 {{variable}} 占位符
  variables: string[];          // 声明所需变量
  status: 'active' | 'deprecated';
}

class PromptRegistry {
  async get(templateId: string, version?: number): Promise<PromptTemplate>;
  async render(templateId: string, vars: Record<string, string>): Promise<{ system: string; user: string }>;
  async listVersions(templateId: string): Promise<PromptTemplate[]>;
}
```

- 模板存储：初期用 src/data/promptTemplates.ts（代码内）；后续迁移 document_template 集合或独立 prompt_template 集合
- 版本管理：新版本灰度发布（FeatureFlag 控制流量百分比）；旧版本保留供回滚
- 渲染：{{variable}} 占位符替换 + 缺失变量校验

### 3.2 缓存接入

```typescript
class LlmService {
  // 增强现有 generate：先查 llm_cache
  async generate(prompt: string, opts?: GenerateOpts): Promise<string> {
    const promptHash = sha256(prompt + opts.model + opts.promptVersion);
    const cached = await this.cache.getLlmCache(promptHash);
    if (cached) { this.audit.write('llm_cache_hit', { promptHash }); return cached; }
    const result = await this.provider.generate(prompt, opts);
    await this.cache.setLlmCache(promptHash, result, 7 * 24 * 3600);
    return result;
  }
}
```

- 缓存键：promptHash = sha256(prompt + model + promptVersion)
- TTL 7 天（llm_cache 集合）
- 法条更新时按 affectedLawArticles 批量失效（A2 的 LawUpdatePipeline 触发）
- 缓存命中率目标 >= 25%

### 3.3 熔断与降级

```typescript
// src/modules/legal/llm/circuit-breaker.ts
class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private errorRate: number = 0;        // 滑动 1 分钟窗口
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') throw new LlmDegradedError(5003);
    // ... 错误率 > 30% 触发 open，60s 后 half-open 探测
  }
}
```

- LLM 调用错误率 > 30%（滑动 1 分钟）触发熔断，60 秒后半开探测
- 熔断期间 route=llm 走降级链（规则 -> 知识库 -> 人工引导）
- 熔断状态存 system_status 集合 + Redis（多实例共享）
- 降级事件写 audit_log(event=degradation)

---

## 四、DocumentGenerator（文书生成核心）

### 4.1 模板 DSL 设计

```typescript
// src/data/documentTemplates.ts
interface DocumentTemplate {
  code: string;                 // 'civil_complaint_v1'（民事起诉状）
  name: string;
  docType: 'complaint' | 'contract' | 'lawyer_letter' | 'defense';
  category: string;             // 'civil' | 'criminal' | 'commercial'
  varsSchema: VarSchema[];      // 变量定义
  template: string;             // DSL 模板（含 {{var}} 与条件块）
  lawRefs: string[];            // 引用法条
  version: number;
  status: 'active' | 'deprecated';
}

interface VarSchema {
  key: string;                  // 'plaintiff_name'
  label: string;                // '原告姓名'
  type: 'string' | 'text' | 'date' | 'number' | 'party_group';
  required: boolean;
  validation?: { pattern?: string; maxLength?: number };
}
```

### 4.2 DSL 语法

```
{{plaintiff_name}}，男/女，{{plaintiff_id_no}}，住{{plaintiff_address}}。

诉讼请求：
{{#each claims}}
  {{index}}. {{content}}
{{/each}}

事实与理由：
{{facts}}

此致
{{court_name}}人民法院

具状人：{{plaintiff_name}}
{{date}}
```

- {{var}}：变量替换
- {{#each list}}...{{/each}}：循环（诉讼请求多条、当事人多方）
- {{#if condition}}...{{/if}}：条件块（如有/无委托代理人）

### 4.3 接口

```typescript
interface DocumentGenerateResult {
  docId: string;
  renderedText: string;
  varsFilled: Record<string, any>;
  lawRefs: LawRef[];
  disclaimer: string;
  exportReady: boolean;
}

class DocumentGenerator {
  // 同步生成（简单文书）
  async generate(dto: { templateCode: string; vars: Record<string, any>; caseId?: string }, ctx: RequestContext): Promise<DocumentGenerateResult>;
  // 异步生成（复杂文书，对接 JobService）
  async generateAsync(dto: GenerateDto, ctx: RequestContext): Promise<{ jobId: string }>;
  // 校验变量
  validateVars(templateCode: string, vars: Record<string, any>): ValidationResult;
  // 渲染 DSL
  render(template: DocumentTemplate, vars: Record<string, any>): string;
}
```

### 4.4 生成流程

1. 按 templateCode 加载 DocumentTemplate（document_template 集合）
2. validateVars：校验必填变量 + 类型 + 格式（缺失抛 3001，格式错抛 3001）
3. 检索相关法条：RagService.retrieve(facts, intent=document_generate) 获取上下文
4. LLM 增强（可选）：复杂文书用 LLM 补充事实陈述段落
5. render：DSL 解析 + 变量填充 + 条件块/循环处理
6. 法条引用校验：validateLawRefs（来自 A1）
7. 注入免责声明（文尾强制附带）
8. 写 document_record 集合
9. 返回结果或 jobId
---

## 五、ExportService（导出 + 对象存储）

```typescript
class ExportService {
  async exportDocx(docId: string, renderedText: string): Promise<{ fileId: string; downloadUrl: string }>;
  async exportPdf(docId: string, renderedText: string): Promise<{ fileId: string; downloadUrl: string }>;
  async getDownloadUrl(fileId: string, expiresInSec?: number): Promise<string>;  // 预签名 URL
}
```

### 5.1 对象存储抽象（替代微信云存储）

```typescript
// src/infra/storage/object-storage.interface.ts
interface ObjectStorage {
  async upload(key: string, buffer: Buffer, opts?: { contentType?: string }): Promise<{ fileId: string }>;
  async getSignedUrl(key: string, expiresInSec: number): Promise<string>;
  async delete(key: string): Promise<void>;
}
// 适配器：S3StorageAdapter / OSSStorageAdapter / MinIOStorageAdapter
```

- A3 默认接 S3 或阿里云 OSS；开发环境可用 MinIO（本地）
- fileId 语义从微信 cloud:// 改为对象存储 key
- 文书文件私有读，通过预签名 URL 限时访问（默认 1 小时）

### 5.2 渲染实现

- **docx**：用 docx-templater 或 officegen，基于模板 + 变量填充生成 .docx
- **pdf**：用 puppeteer 将 renderedText（HTML 包装）渲染为 PDF，或用 pdfkit 直接绘制
- 导出后写 document_record.exportFileId + 返回预签名 URL

---

## 六、4 类文书模板

| code | 名称 | docType | 核心变量 |
|------|------|---------|---------|
| civil_complaint_v1 | 民事起诉状 | complaint | plaintiff_name/id/address、defendant_name/id、claims[]、facts、court_name |
| standard_contract_v1 | 标准合同模板 | contract | party_a/b、contract_subject、terms[]、sign_date |
| lawyer_letter_v1 | 律师函 | lawyer_letter | sender_firm、recipient、matter、demands[]、deadline |
| civil_defense_v1 | 民事答辩状 | defense | defendant_info、case_no、defense_points[]、court_name |

- 模板存 document_template 集合（code 唯一索引）
- 每模板附 lawRefs（引用法条）+ version（版本管理）
- 文尾强制免责声明（不依赖 LLM 自觉）

---

## 七、涉及集合（A3 新增/扩展）

| 集合 | A3 变更 |
|------|---------|
| document_template | 新建，4 类文书模板 + varsSchema + DSL |
| document_record | 新建，docId/userId/caseId/templateCode/templateVersion/varsFilled(L4加密)/renderedText/exportFileId/status/expireAt |
| llm_cache | 复用 A1，文书生成 LLM 调用缓存 |
| system_status | 复用 A1，熔断状态存储 |

**document_record schema 要点**：
- varsFilled 字段为 L4（PiiService.encrypt 加密入库）
- expireAt：TTL 1 年（案件关闭后）
- idx_userId_createdAt、idx_caseId

---

## 八、JobService 雏形（异步文书生成）

```typescript
// src/modules/legal/job/job.service.ts
class JobService {
  async create(capability: string, params: object, ctx: RequestContext): Promise<{ jobId: string }>;
  async getStatus(jobId: string): Promise<{ status: 'pending'|'running'|'completed'|'failed'; progress: number; result?: any }>;
  async update(jobId: string, update: Partial<JobStatus>): Promise<void>;
}
```

- 异步任务存 agent_job 集合（jobId/capability/params(L4加密)/status/progress/resultFileId/expireAt）
- A3 雏形：简单轮询模式（客户端 GET /v1/jobs/{jobId} 查状态）
- A4 扩展为完整 JobService + 回调/webhook

---

## 九、文书生成评测

- **评测集**：4 类文书 × 5 场景 = 20 用例
- **指标**：
  - 变量填充正确率 100%
  - 字段缺失校验命中率 100%
  - 导出 docx/pdf 打开成功率 100%
  - 文书文尾免责声明 100% 附带
- **脚本**：test/eval/document-eval.ts

---

## 十、验收标准

| # | 标准 | 验证方式 |
|---|------|---------|
| 1 | LlmService 缓存接入，命中率 >= 25% | 监控指标 |
| 2 | 熔断器错误率 > 30% 触发，60s 半开探测 | 故障注入测试 |
| 3 | Prompt 模板版本管理 + 灰度可用 | 功能测试 |
| 4 | 4 类文书模板 DSL 解析 + 变量填充正确 | 单测 |
| 5 | 必填变量缺失抛 3001，格式错抛 3001 | 单测 |
| 6 | 文书生成附法条引用且经校验 | 集成测试 |
| 7 | docx/pdf 导出成功率 100% + 预签名 URL 可下载 | 集成测试 |
| 8 | 文书文尾免责声明 100% 附带 | 单测 |
| 9 | 异步文书生成 jobId 全流程可用 | 集成测试 |
| 10 | LLM 不可用时降级链生效（规则->知识->人工引导） | 故障注入 |
| 11 | varsFilled 字段 L4 加密入库 | 安全测试 |
| 12 | 现有 agnesProvider 105 测试用例无回归 | vitest |

---

## 十一、风险与对策

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| LLM 生成的文书有法律风险 | 中 | 极高 | 强制免责 + 模板约束 + 法条校验 + 引导律师审核 |
| DSL 解析边界 case | 中 | 中 | 20 用例评测覆盖 + 单测 |
| docx/pdf 渲染库兼容性 | 低 | 中 | puppeteer + docx-templater 双方案备选 |
| 对象存储成本 | 低 | 低 | MinIO 开发环境 + S3/OSS 生产 |
| LLM 缓存命中率不足 | 中 | 低 | Prompt 标准化 + promptVersion 管理减少碎片化 |
| 异步任务超时 | 低 | 中 | job 超时 60s + 降级同步生成 |

---

## 十二、交付物清单

- LlmService 增强（PromptRegistry + 缓存接入 + CircuitBreaker）
- DocumentGenerator（DSL 解析 + 变量填充 + 校验 + 渲染）
- ExportService（docx/pdf + ObjectStorage 抽象 + S3/OSS 适配器）
- 4 类文书模板（data/documentTemplates.ts）
- JobService 雏形（异步任务）
- document_template / document_record / agent_job schema
- test/eval/document-eval.ts + 20 用例
- 文书生成 API（POST /v1/documents + GET /v1/documents/{docId}）

**预计工期**：4 周（与 v2.3 阶段三一致）。
