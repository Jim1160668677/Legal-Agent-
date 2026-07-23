# 14 · 法律工具设计

> 版本：v2.3 | 日期：2026-07-22 | 状态：设计扩展（v2.3 新增第 8 LegalTool ClauseRecommender + CitationGraphBuilder 模块）
> 影响范围：03 / 04 / 05 / 06 / 07 / 08 / 09 / 12 / 15 / 16
> 本文为 8 个法律工具的接口、schema、算法与评测权威源；模块名与目录结构以 04 为准，集合与字段以 05 为准，接口契约与错误码以 06 为准，工具算法以 07 为准，UI 线框图以 09 为准，对外协议以 12 为准。

---

## 一、设计目标与定位

### 1.1 目标

v2.2 在 v2.1 多 agent 协作后端之上，新增 7 个独立法律工具；v2.3 追加第 8 个工具 ClauseRecommender，覆盖法律实务中高频、可结构化、可单测的场景：

1. **LawValidityQuery** — 法条效力查询（现行有效状态 + 颁布机关 + 修订历史 + 法律位阶）
2. **PeriodCalculator** — 期间计算器（法定/指定期限推算 + 节假日扣除）
3. **LicenseOcr** — 证照 OCR（营业执照/身份证/律师证等结构化识别 + 校验）
4. **DocumentReviewer** — 文书审核（必填项/法条引用/格式/当事人信息反向校验）
5. **CompensationQuery** — 赔偿标准查询（人身损害/劳动等赔偿项目计算）
6. **CauseClassifier** — 案由分类（案情描述→案由代码 + 类别 + 适用程序）
7. **SentencingGuide** — 量刑指导（罪名 + 情节要素→量刑幅度 + 基准刑）
8. **ClauseRecommender**（v2.3） — 条款推荐（文书类型 + 已填变量 → 推荐适用条款 top 5）

### 1.2 设计原则

- **统一接口**：所有工具实现 `LegalTool` 接口，经 `ToolRegistry` 注册与发现
- **双模式调用**：用户经 TabBar 工具 Tab 直接调用（经 invokeTool 云函数），或经 OrchestratorAgent 编排 ToolAgent 调用
- **可单测**：工具为纯逻辑模块，数据访问经 repository 注入
- **可缓存**：相同输入的工具结果可缓存（法律数据低频变更）
- **可降级**：工具失败不阻断主流程，返回降级提示或转 LegalQaAgent
- **强制合规**：输出强制含 `disclaimer` + `lawRefs`（涉法条时）

### 1.3 与 v2.1 Agent 的关系

8 工具经 `ToolAgent`（第 9 个专业 Agent，见 04 1.9 节）包装为统一 `LegalAgent` 接口，纳入 AgentRegistry。ToolAgent 持有 8 个 capability（`tool.period_calculator` 等，v2.3 追加 `tool.clause_recommender`），详见 04 Agent ↔ capability 映射表。

## 二、统一接口与类型

### 2.1 LegalTool 接口

```typescript
// src/services/legal/tools/types.ts

export type ToolId =
  | 'period_calculator'
  | 'document_review'
  | 'compensation_query'
  | 'license_ocr'
  | 'law_validity'
  | 'cause_classification'
  | 'sentencing_guide'
  | 'clause_recommender';

export interface LegalTool<TInput = any, TOutput = any> {
  readonly toolId: ToolId;
  readonly name: string;
  readonly description: string;
  readonly category: 'civil' | 'criminal' | 'commercial' | 'administrative' | 'procedural' | 'general';
  readonly inputSchema: JSONSchema;            // 工具入参 schema（JSON Schema Draft 7）
  readonly outputSchema: JSONSchema;           // 工具出参 schema
  readonly piiLevel: 'L1' | 'L2' | 'L3';       // 输入 PII 分级（影响脱敏与日志）
  readonly async: boolean;                      // 是否长任务（文书审核可能异步）
  readonly timeout: number;                     // ms，超时返回 8003
  readonly cacheable: boolean;                  // 是否可缓存
  readonly cacheTtl?: number;                   // 缓存 TTL（秒），cacheable=true 时必填
  invoke(input: TInput, ctx: ToolContext): Promise<ToolResult<TOutput>>;
}
```

### 2.2 ToolContext

```typescript
export interface ToolContext {
  userId: string;                               // openid
  traceId: string;                              // 贯穿链路
  requestId: string;                            // 幂等键（客户端生成 UUID）
  featureFlags: Record<string, boolean>;        // 灰度开关
  repository: ToolRepository;                   // 数据访问注入（便于单测 mock）
  llmService?: LlmService;                      // LLM 辅助（CauseClassifier 等用）
  ocrService?: OcrService;                      // OCR 服务（LicenseOcr 用）
  logger: Logger;
  auditLog: AuditLog;
}
```

### 2.3 ToolResult

```typescript
export interface ToolResult<T = any> {
  success: boolean;
  data?: T;
  lawRefs?: LawRef[];                           // 涉法条时必填
  warnings?: string[];                          // 非阻断性警告
  disclaimer: string;                           // 工具特有免责，强制必填
  duration: number;                             // ms
  fromCache?: boolean;                          // 是否命中缓存
  degraded?: boolean;                           // 是否降级（如 LLM 失败转规则）
}

export interface LawRef {
  ref: string;                                  // 如"民法典第一千零七十九条"
  title: string;                                // 法条标题
  verified: boolean;                            // 是否经 RuleEngine 核实
  sourceUrl?: string;
}
```

### 2.4 LegalToolError

```typescript
export class LegalToolError extends Error {
  constructor(
    public code: 8001 | 8002 | 8003 | 8004 | 8005 | 8006 | 8007 | 8008 | 8009 | 8019,
    message: string,
    public toolId: ToolId,
    public field?: string                       // 入参非法时填字段名
  ) {
    super(message);
  }
}
```

### 2.5 ToolRegistry

```typescript
// src/services/legal/tools/registry.ts

export class ToolRegistry {
  private tools = new Map<ToolId, LegalTool>();

  register(tool: LegalTool): void { /* ... */ }
  get(toolId: ToolId): LegalTool { /* 不存在抛 8002 */ }
  dispatch(toolId: ToolId, input: any, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.get(toolId);
    // 1. 输入 schema 校验（失败抛 8001）
    // 2. 缓存命中检查（cacheable=true 时）
    // 3. 调用 tool.invoke（超时抛 8003）
    // 4. 审计 tool_invoke / tool_invoke_failed
    // 5. 缓存写入
    // 6. 返回 ToolResult
  }
  list(): ToolId[] { /* ... */ }
}
```

## 三、工具实现规范（通用）

### 3.1 输入校验

- 所有工具入参必须先经 `inputSchema` JSON Schema 校验
- 校验失败抛 `LegalToolError(8001, '<字段> <原因>', toolId, field)`
- 日期字符串必须为 ISO 8601（`YYYY-MM-DD`）
- 数值字段必须为非负有限数

### 3.2 缓存策略

- `cacheable=true` 的工具，缓存键为 `sha256(toolId + JSON.stringify(input))`
- 缓存存 `llm_cache` 集合（复用 v2.0 缓存基础设施），`intent` 字段填 `tool_<toolId>`
- 法条/赔偿标准等低频变更数据，TTL 7 天；案由分类等依赖 LLM 的结果，TTL 1 天
- 工具版本变更（`toolVersion` 字段）自动失效旧缓存

### 3.3 降级策略

| 工具 | 主路径 | 降级路径 |
|------|--------|---------|
| LawValidityQuery | law_article 精确查 | 无结果返回 8005，不降级 |
| PeriodCalculator | legal_knowledge + holidays 静态数据 | 节假日数据缺失时降级为"仅扣周末"，warnings 提示 |
| LicenseOcr | OcrService + 证照模板 | OCR 失败返回 8004，不降级 |
| DocumentReviewer | document_template + law_article | LLM 失败降级为"仅规则校验"（必填项 + 格式），warnings 提示 |
| CompensationQuery | legal_knowledge + law_article | 标准缺失返回 warnings + 已知项计算 |
| CauseClassifier | LLM + legal_knowledge | LLM 失败降级为"仅关键词匹配"，置信度<0.5 返回 8006 |
| SentencingGuide | legal_knowledge + law_article | 情节要素不足返回 8007 |

### 3.4 审计与日志

- 每次工具调用写 `audit_log`，event = `tool_invoke`（成功）/ `tool_invoke_failed`（失败）
- detail 字段记录 `{ toolId, inputHash, success, duration, fromCache, degraded, errorCode }`
- 输入不入审计（可能含 PII），仅写 `inputHash = sha256(input)`
- PII 边界：`piiLevel=L3` 的工具（LicenseOcr/DocumentReviewer）输入经 PiiService 脱敏后再写日志

## 四、工具 1：LawValidityQuery（法条效力查询）

### 4.1 用途与场景

用户输入法条号或"法律名 + 条号"，查询该法条的现行有效状态、颁布机关、生效日期、修订历史、法律位阶。常用于核实引用法条是否仍有效。

### 4.2 inputSchema / outputSchema

```jsonc
// inputSchema
{
  "type": "object",
  "properties": {
    "lawName": { "type": "string", "description": "法律名称，如'民法典'" },
    "articleNo": { "type": "string", "description": "法条号，如'第一百四十三条'或'143'" },
    "articleRef": { "type": "string", "description": "完整引用，如'民法典第143条'，与 lawName+articleNo 二选一" }
  },
  "oneOf": [
    { "required": ["lawName", "articleNo"] },
    { "required": ["articleRef"] }
  ]
}

// outputSchema
{
  "type": "object",
  "properties": {
    "found": { "type": "boolean" },
    "lawName": { "type": "string" },
    "articleNo": { "type": "string" },
    "title": { "type": "string" },
    "content": { "type": "string" },
    "status": { "type": "string", "enum": ["effective", "repealed", "amended"] },
    "effectiveDate": { "type": "string", "format": "date" },
    "promulgatingBody": { "type": "string" },
    "legalHierarchy": { "type": "string", "enum": ["constitution","law","administrative_regulation","local_regulation","judicial_interpretation","departmental_rule"] },
    "amendedBy": { "type": "array", "items": { "type": "string" } },
    "amends": { "type": "string", "nullable": true },
    "sourceUrl": { "type": "string" },
    "statusBadge": { "type": "string", "enum": ["effective_green","repealed_red","amended_amber"] }
  },
  "required": ["found", "lawRefs", "disclaimer"]
}
```

### 4.3 数据依赖

- `law_article` 集合（v2.2 扩展字段：`promulgatingBody`/`legalHierarchy`/`amendedBy`/`amends`/`status`/`effectiveDate`）
- 索引：`idx_lawName_articleNoInt`（按法律名 + 条号精确查）

### 4.4 核心算法

```
1. 解析输入：
   - 若 articleRef 提供，正则提取 lawName + articleNo
   - articleNo 支持中文（"第一百四十三条"）与数字（"143"）双格式，统一转为 articleNoInt
2. 查询 law_article：
   - query = { lawName: {$regex: lawName}, articleNoInt: articleNoInt, status: {$in: ['effective','amended']} }
   - 取第一条（同法同条号应唯一）
3. 若未命中，尝试 lawShortName 模糊匹配（如"民法典" → "中华人民共和国民法典"）
4. 若仍未命中，返回 found=false（不抛 8005，由 UI 决定展示空态或错误）
5. 组装输出：
   - statusBadge: effective→green, repealed→red, amended→amber
   - lawRefs: [{ ref: `${lawName}${articleNo}`, title, verified: true, sourceUrl }]
   - disclaimer: "⚠️ 法条效力信息仅供参考，以官方发布为准。"
```

### 4.5 法条依据

工具输出本身即为法条信息，`lawRefs` 字段填该法条自身引用。

### 4.6 免责声明

```
"⚠️ 法条效力信息仅供参考，以官方发布为准。如需正式法律意见，请咨询专业律师。"
```

### 4.7 评测集与指标

- 评测集：50+ 标注样本（覆盖宪法/法律/行政法规/地方性法规/司法解释/部门规章 6 类位阶）
- 指标：现行有效状态准确率 = 100%（必须零错误）
- 边界样本：已废止法条、已修订法条、地方性法规、司法解释

### 4.8 工具元数据

```typescript
{
  toolId: 'law_validity',
  name: '法条效力查询',
  description: '查询法条现行有效状态、颁布机关、生效日期、修订历史、法律位阶',
  category: 'general',
  piiLevel: 'L1',                               // 输入仅法条引用，无 PII
  async: false,
  timeout: 3000,
  cacheable: true,
  cacheTtl: 7 * 24 * 3600                       // 7 天（法条低频变更）
}
```

## 五、工具 2：PeriodCalculator（期间计算器）

### 5.1 用途与场景

用户输入起算日 + 期间类型（法定/指定）+ 期间长度 + 单位（日/月/年）+ 是否扣除节假日，推算截止日。常用于举证期限、上诉期限、答辩期限等法定期间计算。

### 5.2 inputSchema / outputSchema

```jsonc
// inputSchema
{
  "type": "object",
  "properties": {
    "startDate": { "type": "string", "format": "date", "description": "起算日 ISO 8601" },
    "periodType": { "type": "string", "enum": ["statutory", "designated"], "description": "法定期间/指定期间" },
    "duration": { "type": "number", "minimum": 1, "maximum": 3650, "description": "期间长度" },
    "unit": { "type": "string", "enum": ["day", "month", "year"] },
    "deductHolidays": { "type": "boolean", "default": true, "description": "是否扣除节假日（仅法定期间适用）" },
    "jurisdiction": { "type": "string", "default": "全国", "description": "管辖地（影响地方性节假日）" }
  },
  "required": ["startDate", "periodType", "duration", "unit"]
}

// outputSchema
{
  "type": "object",
  "properties": {
    "deadline": { "type": "string", "format": "date", "description": "截止日" },
    "deadlineWeekday": { "type": "string" },
    "actualDays": { "type": "number", "description": "实际天数（含扣除）" },
    "holidayDeductions": {
      "type": "array",
      "items": { "type": "object", "properties": {
        "date": { "type": "string", "format": "date" },
        "reason": { "type": "string", "description": "周六/周日/法定节假日名" }
      }}
    },
    "calculationTrace": { "type": "string", "description": "计算过程可读说明" }
  },
  "required": ["deadline", "actualDays", "lawRefs", "disclaimer"]
}
```

### 5.3 数据依赖

- `legal_knowledge` 集合（type=`case_process`，structured.timeline 中含 `deadlineOffsetDays`）
- `src/shared/holidays.ts` 静态节假日数据（近 3 年全国法定节假日 + 调休，每年初手动更新）
- 法条依据：`民事诉讼法第九十二条`（期间计算通则）、`民法总则第二百条`（期间计算）

### 5.4 核心算法

```
1. 解析 startDate 为 Date 对象
2. 按 unit 计算初始截止日：
   - day: deadline = startDate + duration 天
   - month: deadline = startDate + duration 月（保留日，月末自动顺延至当月最后一天）
   - year: deadline = startDate + duration 年（处理闰年）
3. 若 deductHolidays=true 且 periodType=statutory：
   a. 遍历 startDate+1 至 deadline 区间
   b. 扣除周六、周日
   c. 扣除 holidays.ts 中的法定节假日
   d. 每扣一天，deadline 顺延一天（避免节假日占用期间）
   e. 重复 a-d 直到 deadline 不落在节假日
4. 期间届满日若为节假日，顺延至节后第一个工作日（民事诉讼法第九十二条第四款）
5. 组装输出：
   - actualDays: 实际工作日天数
   - holidayDeductions: 扣除明细
   - calculationTrace: "起算日 2026-07-21 + 15 法定日 - 3 节假日 + 0 顺延 = 截止日 2026-08-05"
   - lawRefs: [{ ref: '民事诉讼法第九十二条', title: '期间', verified: true }]
   - disclaimer: 工具特有
6. 降级：若 holidays.ts 缺失该期间数据，仅扣周末，warnings 提示"节假日数据未覆盖，仅扣周末"
```

### 5.5 法条依据

- `民事诉讼法第九十二条`（期间计算通则）
- `民法总则第二百条`（按日/月/年计算）
- `民事诉讼法第九十二条第四款`（届满日为节假日顺延）

### 5.6 免责声明

```
"⚠️ 本计算结果仅供参考，具体以法院通知为准。如涉及重大期限，请咨询专业律师核实。"
```

### 5.7 评测集与指标

- 评测集：50+ 标注样本（覆盖日/月/年单位 × 法定/指定期间 × 跨节假日/调休/闰年）
- 指标：截止日计算准确率 ≥ 99%（节假日扣除逻辑零错误）
- 边界样本：跨年、闰年 2 月 29 日、月末顺延、调休上班日（如周六补班）

### 5.8 工具元数据

```typescript
{
  toolId: 'period_calculator',
  name: '期间计算器',
  description: '法定/指定期限推算，支持日/月/年单位与节假日扣除',
  category: 'procedural',
  piiLevel: 'L1',                               // 输入仅日期与参数，无 PII
  async: false,
  timeout: 3000,
  cacheable: true,
  cacheTtl: 30 * 24 * 3600                      // 30 天（节假日数据年度更新）
}
```

## 六、工具 3：LicenseOcr（证照 OCR）

### 6.1 用途与场景

用户上传证照图片（营业执照/身份证/律师执业证/组织机构代码证等），识别证照类型并结构化提取关键字段，进行校验（统一社会信用代码校验位、身份证位校验、有效期检查）。常用于建档时当事人信息录入、企业资质核验。

### 6.2 inputSchema / outputSchema

```jsonc
// inputSchema
{
  "type": "object",
  "properties": {
    "fileId": { "type": "string", "description": "云存储文件 ID" },
    "licenseType": { "type": "string", "enum": ["auto", "business_license", "id_card", "lawyer_license", "organization_code"], "default": "auto" }
  },
  "required": ["fileId"]
}

// outputSchema
{
  "type": "object",
  "properties": {
    "licenseType": { "type": "string", "enum": ["business_license", "id_card", "lawyer_license", "organization_code"] },
    "fields": { "type": "object", "description": "按证照类型动态字段" },
    "validation": {
      "type": "object",
      "properties": {
        "checksumValid": { "type": "boolean", "description": "统一社会信用代码/身份证校验位" },
        "notExpired": { "type": "boolean", "description": "有效期检查" },
        "issues": { "type": "array", "items": { "type": "string" } }
      }
    },
    "confidence": { "type": "number", "description": "整体识别置信度 0-1" },
    "rawOcrText": { "type": "string", "description": "OCR 原始文本（调试用，生产可屏蔽）" }
  },
  "required": ["licenseType", "fields", "validation", "disclaimer"]
}
```

### 6.3 数据依赖

- `OcrService`（v2.0 既有，调用腾讯云 OCR 或微信 OCR 插件）
- 证照模板（前端静态数据 `src/data/licenseTemplates.ts`，定义各证照字段映射与校验规则）
- 不依赖云数据库集合

### 6.4 核心算法

```
1. 从云存储读取 fileId 对应图片
2. 调用 OcrService.recognize(fileId) 获取 OCR 文本
3. 若 licenseType=auto：
   a. 关键词匹配判断证照类型
      - 含"营业执照"+"统一社会信用代码" → business_license
      - 含"中华人民共和国居民身份证" → id_card
      - 含"律师执业证" → lawyer_license
      - 含"组织机构代码证" → organization_code
   b. 无法判断返回 8004（未识别到证照）
4. 按 licenseType 应用对应模板：
   - business_license: 提取统一社会信用代码/注册号/企业名称/法定代表人/注册资本/成立日期/营业期限/经营范围
   - id_card: 提取姓名/性别/民族/出生日期/住址/身份证号
   - lawyer_license: 提取律师姓名/执业证号/事务所/执业证类别/发证日期
   - organization_code: 提取代码/机构名称/机构类型/地址
5. 校验：
   - 统一社会信用代码：18 位校验位算法（GB 32100-2015）
   - 身份证号：18 位校验位算法（GB 11643-1999）
   - 营业期限/执业证有效期：与当前日期比较，notExpired 字段
6. confidence = 各字段置信度加权平均
7. 组装输出 + disclaimer
8. 降级：OCR 返回空或质量过低返回 8004
```

### 6.5 法条依据

本工具不直接引用法条，`lawRefs` 可空。涉及统一社会信用代码校验依据 GB 32100-2015（国家标准，非法律）。

### 6.6 免责声明

```
"⚠️ 证照识别结果仅供参考，请与原件核对。统一社会信用代码/身份证校验位通过不代表证照真实有效。"
```

### 6.7 评测集与指标

- 评测集：50+ 标注样本（覆盖 4 类证照 × 清晰/模糊/倾斜/反光 4 种图像质量）
- 指标：
  - 字段识别准确率 ≥ 90%
  - 统一社会信用代码/身份证号关键字段 ≥ 95%
  - 证照类型自动识别准确率 ≥ 95%
  - 校验位判断准确率 100%
- 边界样本：旧版营业执照（无统一社会信用代码）、过有效期证照、手写填证

### 6.8 工具元数据

```typescript
{
  toolId: 'license_ocr',
  name: '证照 OCR',
  description: '营业执照/身份证/律师证等证照结构化识别与校验',
  category: 'general',
  piiLevel: 'L3',                               // 输入含证照图像，含 PII（姓名/身份证号）
  async: false,
  timeout: 10000,                               // OCR 耗时较长
  cacheable: false,                              // 同一 fileId 结果可缓存，但 fileId 唯一性高，缓存收益低
}
```

**PII 处理**：
- 输入 fileId 经 UploadService 上传前已做内容安全检测
- 输出 `fields` 含 PII（姓名/身份证号），写入审计前经 PiiService 脱敏
- `rawOcrText` 在生产环境默认不返回（featureFlag `tool.license_ocr.raw_text` 控制）

## 七、工具 4：DocumentReviewer（文书审核）

### 7.1 用途与场景

用户粘贴或上传文书文本 + 选择文书类型，工具对文书进行反向校验，输出四类问题：必填项缺失、法条引用错误、格式问题、当事人信息不全。常用于立案前自检、合同签订前审查、律师函发出前核对。

### 7.2 inputSchema / outputSchema

```jsonc
// inputSchema
{
  "type": "object",
  "properties": {
    "documentText": { "type": "string", "maxLength": 50000, "description": "文书全文文本" },
    "docType": { "type": "string", "enum": ["起诉状", "答辩状", "合同", "律师函", "申请书", "其他"], "description": "文书类型" }
  },
  "required": ["documentText", "docType"]
}

// outputSchema
{
  "type": "object",
  "properties": {
    "issues": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": { "type": "string", "enum": ["missing_required", "invalid_law_ref", "format_issue", "incomplete_party_info"] },
          "severity": { "type": "string", "enum": ["error", "warning"] },
          "location": { "type": "string", "description": "问题位置（段落/行号/字段名）" },
          "message": { "type": "string", "description": "问题描述" },
          "suggestion": { "type": "string", "description": "修改建议" }
        },
        "required": ["type", "severity", "message", "suggestion"]
      }
    },
    "summary": {
      "type": "object",
      "properties": {
        "errorCount": { "type": "number" },
        "warningCount": { "type": "number" },
        "passRate": { "type": "number", "description": "校验通过率 0-1" }
      }
    }
  },
  "required": ["issues", "summary", "disclaimer"]
}
```

### 7.3 数据依赖

- `document_template`（按 docType 加载 varsSchema，校验必填项）
- `law_article`（RuleEngine 核实文书引用的法条是否存在且现行有效）
- 文书格式规则静态数据 `src/data/documentFormatRules.ts`（标题/此致/落款/日期格式正则）

### 7.4 核心算法

```
1. 入参 documentText 长度校验（≤ 50000 字符），超限返回 8001
2. 按 docType 加载 document_template（如 civil_complaint_divorce 等）
3. 必填项检测（missing_required）：
   a. 遍历 template.varsSchema，对每个 required=true 的变量
   b. 用正则在 documentText 中提取对应值（如"原告：(.+?)"提取 plaintiffName）
   c. 提取失败或为空 → issues 追加 {type: missing_required, severity: error, location: 字段名, message: "缺失必填项 xxx", suggestion: "请补充 xxx"}
4. 法条引用检测（invalid_law_ref）：
   a. 正则提取所有法条引用：/《?[\u4e00-\u9fa5]+》?第[一二三四五六七八九十百千]+条/
   b. 对每条引用调 RuleEngine.query 核实
   c. 未命中或 status=repealed → issues 追加 {type: invalid_law_ref, severity: error, location: 引用文本, message: "法条引用错误/已废止", suggestion: "请核实法条号或引用现行有效版本"}
5. 格式检测（format_issue）：
   a. 标题格式：起诉状须含"民事起诉状"标题行
   b. "此致"后须跟法院名称
   c. 落款须含起诉人/申请人签名 + 日期
   d. 日期格式校验（YYYY年MM月DD日）
   e. 不符 → issues 追加 {type: format_issue, severity: warning, ...}
6. 当事人信息完整性（incomplete_party_info）：
   a. 原告/被告/申请人/被申请人姓名非空
   b. 身份信息（身份证号/住所/联系方式）至少一项存在
   c. 法人须含统一社会信用代码/法定代表人
   d. 缺失 → issues 追加 {type: incomplete_party_info, severity: warning, ...}
7. 组装 summary：errorCount = issues.filter(severity=error).length, warningCount 同理, passRate = 1 - errorCount / 总检查项
8. 降级：若 RuleEngine 调用超时，法条引用检测跳过，warnings 提示"法条引用校验暂不可用"
9. 组装输出 + disclaimer
```

### 7.5 法条依据

- `民事诉讼法第一百二十一条`（起诉状必要记载事项）
- `民事诉讼法第一百二十二条`（起诉条件）
- 各类文书对应的形式要求（合同法/律师法相关规定）

### 7.6 免责声明

```
"⚠️ 文书审核结果仅供参考，不构成法律意见。审核未检出问题不代表文书完全合规，请在提交前由专业律师审核。"
```

### 7.7 评测集与指标

- 评测集：50+ 标注样本（6 类文书 × 故意注入各类缺陷 + 合规样本）
- 指标：
  - 必填项缺失检出率 ≥ 95%（召回率）
  - 误报率 ≤ 5%（合规样本被误判为有问题）
  - 法条引用错误检出率 ≥ 90%
  - 格式问题检出率 ≥ 85%
- 边界样本：超长文书（接近 50000 字符）、无模板匹配的"其他"类型、含大量法条引用的复杂文书

### 7.8 工具元数据

```typescript
{
  toolId: 'document_review',
  name: '文书审核',
  description: '反向校验文书必填项/法条引用/格式/当事人信息',
  category: 'procedural',
  piiLevel: 'L3',                               // 输入含当事人姓名/事实陈述
  async: false,
  timeout: 8000,                                // 法条引用核实可能多次查 RuleEngine
  cacheable: false,                              // 文书内容唯一性强，缓存意义低
}
```

## 八、工具 5：CompensationQuery（赔偿标准查询）

### 8.1 用途与场景

用户输入案由（人身损害/劳动/医疗等）+ 地区 + 伤残等级 + 收入数据，工具按各省赔偿标准计算赔偿项目明细（医疗费/误工费/护理费/残疾赔偿金/死亡赔偿金/被扶养人生活费/精神损害抚慰金），输出计算公式与总金额。常用于交通事故、工伤、医疗事故等赔偿预估。

### 8.2 inputSchema / outputSchema

```jsonc
// inputSchema
{
  "type": "object",
  "properties": {
    "causeOfAction": { "type": "string", "description": "案由（人身损害赔偿纠纷/提供劳务者受害责任纠纷等）" },
    "region": { "type": "string", "description": "受理法院所在地（省/市）" },
    "disabilityLevel": { "type": "integer", "minimum": 1, "maximum": 10, "description": "伤残等级 1-10 级（10 级最轻）" },
    "income": {
      "type": "object",
      "properties": {
        "monthlySalary": { "type": "number", "minimum": 0 },
        "annualBonus": { "type": "number", "minimum": 0 }
      }
    },
    "dependents": { "type": "integer", "minimum": 0, "maximum": 10, "description": "被扶养人数" },
    "medicalFee": { "type": "number", "minimum": 0, "description": "已发生医疗费" }
  },
  "required": ["causeOfAction", "region"]
}

// outputSchema
{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "赔偿项目名（医疗费/误工费/护理费/残疾赔偿金/被扶养人生活费/精神损害抚慰金）" },
          "formula": { "type": "string", "description": "计算公式（可读）" },
          "amount": { "type": "number", "description": "金额（元）" },
          "basis": { "type": "string", "description": "计算依据（如'2024 年北京城镇居民人均可支配收入 81523 元')" }
        },
        "required": ["name", "formula", "amount"]
      }
    },
    "totalAmount": { "type": "number", "description": "赔偿总额（元）" },
    "calculationTrace": { "type": "string", "description": "完整计算过程可读说明" }
  },
  "required": ["items", "totalAmount", "lawRefs", "disclaimer"]
}
```

### 8.3 数据依赖

- `legal_knowledge`（type=`compensation_standard`，含各省城镇/农村人均可支配收入、人均消费支出、护工日薪、伤残系数表，按 region + 年度索引）
- `law_article`（赔偿范围法条依据）

### 8.4 核心算法

```
1. 按 region 加载 legal_knowledge.compensation_standard（最新年度）
2. 残疾赔偿金计算（disabilityLevel 提供时）：
   a. 伤残系数 = (11 - disabilityLevel) / 10（1 级=1.0，10 级=0.1）
   b. 残疾赔偿金 = 城镇居民人均可支配收入 × 20 年 × 伤残系数
   c. 60 岁以上每增 1 岁减 1 年，75 岁以上按 5 年计算（此处简化，不输入年龄则按 20 年）
3. 误工费计算（income 提供时）：
   a. 日工资 = (monthlySalary × 12 + annualBonus) / 365
   b. 误工费 = 日工资 × 误工天数（默认 90 天，可扩展输入）
4. 护理费计算：
   a. 护理费 = 护工日薪 × 护理天数（默认 30 天，按伤残等级调整）
5. 被扶养人生活费计算（dependents 提供时）：
   a. 被扶养人生活费 = 城镇居民人均消费支出 × 扶养年限 × 伤残系数 ÷ 扶养人数
6. 精神损害抚慰金（disabilityLevel 提供时）：
   a. 按伤残等级查表：1 级 50000，2 级 40000，...，10 级 5000（各地标准不同，按 region 查表）
7. 医疗费直传（medicalFee 提供时）
8. 汇总 items + totalAmount
9. calculationTrace：逐项列出公式 + 代入值 + 结果
10. 降级：若 region 数据缺失，warnings 提示"该地区标准未覆盖，按全国均值计算"，使用全国均值
11. 组装输出 + disclaimer
```

### 8.5 法条依据

- `民法典第一千一百七十九条`（人身损害赔偿范围）
- `民法典第一千一百八十三条`（精神损害赔偿）
- `最高人民法院关于审理人身损害赔偿案件适用法律若干问题的解释`
- 各省高级人民法院发布的赔偿标准通知

### 8.6 免责声明

```
"⚠️ 赔偿金额仅供参考，具体数额以法院判决为准。各地区赔偿标准可能调整，请核对最新数据。如涉及重大索赔，请咨询专业律师。"
```

### 8.7 评测集与指标

- 评测集：50+ 标注样本（10 省份 × 5 伤残等级 × 多种收入/扶养场景）
- 指标：
  - 金额计算准确率 ≥ 95%（与人工核算对比，误差 ≤ 1%）
  - 项目完整率 ≥ 90%（应计算项未漏算）
  - 公式可读性（用户可理解计算过程）
- 边界样本：农村户口 vs 城镇户口、多被扶养人、超高收入、跨年度标准变更

### 8.8 工具元数据

```typescript
{
  toolId: 'compensation_query',
  name: '赔偿标准查询',
  description: '按地区+伤残等级+收入计算人身损害赔偿项目明细',
  category: 'civil',
  piiLevel: 'L2',                               // 输入含收入数据/伤残情况
  async: false,
  timeout: 5000,
  cacheable: true,
  cacheTtl: 86400                                // 24 小时（赔偿标准年度更新）
}
```

## 九、工具 6：CauseClassifier（案由分类）

### 9.1 用途与场景

用户输入案情描述（自由文本），工具推荐 Top-3 案由（案由代码 + 名称 + 类别 + 适用程序 + 置信度）+ 关联法条。常用于立案前案由确定、案件归档分类、检索同类案例。

### 9.2 inputSchema / outputSchema

```jsonc
// inputSchema
{
  "type": "object",
  "properties": {
    "caseDescription": { "type": "string", "maxLength": 2000, "description": "案情描述（自由文本）" }
  },
  "required": ["caseDescription"]
}

// outputSchema
{
  "type": "object",
  "properties": {
    "topCandidates": {
      "type": "array",
      "minItems": 1,
      "maxItems": 3,
      "items": {
        "type": "object",
        "properties": {
          "causeCode": { "type": "string", "description": "案由代码（如 M002）" },
          "causeName": { "type": "string", "description": "案由名称（如 离婚纠纷）" },
          "category": { "type": "string", "enum": ["civil", "criminal", "commercial", "administrative"] },
          "applicableProcedure": { "type": "string", "enum": ["ordinary", "summary", "small_claims", "criminal_procedure"] },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
        },
        "required": ["causeCode", "causeName", "category", "confidence"]
      }
    },
    "reasoning": { "type": "string", "description": "分类推理过程（可读）" }
  },
  "required": ["topCandidates", "lawRefs", "disclaimer"]
}
```

### 9.3 数据依赖

- `legal_knowledge`（type=`cause_classification`，含最高人民法院《民事案件案由规定》《刑事案件罪名规定》结构化数据：causeCode/causeName/category/keywords/applicableProcedure）
- `LlmService`（辅助判定，关键词匹配置信度低时调用）

### 9.4 核心算法

```
1. PiiService.detectAndMask(caseDescription) 脱敏（人名/地名/身份证号替换）
2. 关键词匹配阶段：
   a. 分词 + 同义扩展（如"离婚"扩展"婚姻破裂""感情不和"）
   b. 对 legal_knowledge.cause_classification 逐条匹配 keywords
   c. BM25 打分，召回 Top-10 候选
3. 置信度判定：
   a. 若 top-1 BM25 分数归一化后 ≥ 0.7 → 直接返回 Top-3（仅关键词匹配）
   b. 若 < 0.7 → 调 LlmService 辅助判定
4. LLM 辅助阶段（assistWithLlm）：
   a. 构造 prompt：脱敏案情 + Top-10 候选案由列表 + "请从候选中选择最匹配的 3 个并给出置信度"
   b. LLM 返回 [{causeCode, confidence}] + reasoning
   c. 合并关键词与 LLM 结果：最终 confidence = 0.4 × BM25_score + 0.6 × LLM_score
5. 若 top-1 最终 confidence < 0.5 → 返回 8006（案由置信度过低，建议转 general_qa 或人工咨询）
6. 否则返回 Top-3 + reasoning + lawRefs（各案由关联法条）
7. 降级：LLM 不可用时仅返回关键词匹配 Top-3，warnings 提示"LLM 辅助不可用，仅基于关键词匹配"
8. 组装输出 + disclaimer
```

### 9.5 法条依据

- `最高人民法院民事案件案由规定》（法〔2020〕346 号）
- `最高人民法院关于执行〈中华人民共和国刑法〉确定罪名的规定》
- 各案由关联实体法（如离婚纠纷→民法典婚姻家庭编，故意伤害→刑法第二百三十四条）

### 9.6 免责声明

```
"⚠️ 案由分类仅供参考，具体案由以法院立案为准。如分类置信度较低，建议咨询专业律师确定准确案由。"
```

### 9.7 评测集与指标

- 评测集：50+ 标注样本（民事/刑事/商事/行政 4 类 × 各 12+ 案由，含同义词/方言/模糊描述）
- 指标：
  - Top-3 命中率 ≥ 85%（金标案由在 Top-3 内）
  - Top-1 准确率 ≥ 70%
  - 平均置信度 ≥ 0.7
  - 低置信度（< 0.5）触发 8006 比例 ≤ 15%
- 边界样本：多案由竞合（如劳动争议 vs 合同纠纷）、新型纠纷（无明确案由）、极短描述（< 20 字）

### 9.8 工具元数据

```typescript
{
  toolId: 'cause_classification',
  name: '案由分类',
  description: '案情描述→Top-3 案由推荐（含置信度与适用程序）',
  category: 'general',
  piiLevel: 'L2',                               // 输入含案情描述（可能含人名/地名）
  async: false,
  timeout: 6000,                                // LLM 辅助可能耗时
  cacheable: false                               // 案情描述唯一性强
}
```

## 十、工具 7：SentencingGuide（量刑指导）

### 10.1 用途与场景

用户输入罪名 + 情节要素（数额/次数/后果/前科/自首/立功等），工具输出量刑幅度 + 基准刑 + 调节比例（加重/减轻情节列表）+ 法条依据。常用于刑事案件预判、辩护策略制定、量刑协商参考。

### 10.2 inputSchema / outputSchema

```jsonc
// inputSchema
{
  "type": "object",
  "properties": {
    "charge": { "type": "string", "description": "罪名（如 盗窃罪/故意伤害罪/诈骗罪）" },
    "elements": {
      "type": "object",
      "properties": {
        "amount": { "type": "number", "minimum": 0, "description": "涉案数额（元）" },
        "times": { "type": "integer", "minimum": 1, "description": "次数" },
        "consequence": { "type": "string", "description": "后果描述（如 轻伤/重伤/死亡）" },
        "priorConviction": { "type": "boolean", "description": "是否有前科" },
        "surrender": { "type": "boolean", "description": "是否自首" },
        "merit": { "type": "boolean", "description": "是否有立功表现" }
      }
    }
  },
  "required": ["charge", "elements"]
}

// outputSchema
{
  "type": "object",
  "properties": {
    "sentencingRange": {
      "type": "object",
      "properties": {
        "min": { "type": "number", "description": "最低刑期（月）" },
        "max": { "type": "number", "description": "最高刑期（月）" },
        "unit": { "type": "string", "enum": ["month", "year", "fixed_term"] }
      },
      "required": ["min", "max", "unit"]
    },
    "baseSentence": { "type": "number", "description": "基准刑（月）" },
    "adjustments": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": { "type": "string", "enum": ["aggravating", "mitigating"] },
          "factor": { "type": "string", "description": "情节名（如 prior_conviction/surrender/merit）" },
          "description": { "type": "string" },
          "percentage": { "type": "number", "description": "调节比例（%），正为加重，负为减轻" }
        },
        "required": ["type", "factor", "percentage"]
      }
    },
    "calculationTrace": { "type": "string", "description": "完整计算过程" }
  },
  "required": ["sentencingRange", "baseSentence", "adjustments", "lawRefs", "disclaimer"]
}
```

### 10.3 数据依赖

- `legal_knowledge`（type=`sentencing_guide`，含《最高人民法院关于常见犯罪的量刑指导意见》结构化数据：charge → 法定刑档次 → 基准刑 → 情节调节比例表）
- `law_article`（刑法分则各罪名法定刑条款）

### 10.4 核心算法

```
1. 按 charge 加载 legal_knowledge.sentencing_guide
2. 必填情节要素校验：
   a. 财产犯罪（盗窃/诈骗/抢夺）须提供 amount，缺失返回 8007
   b. 多次犯罪（多次盗窃/多次抢劫）须提供 times，缺失返回 8007
   c. 侵害人身犯罪（故意伤害/故意杀人）须提供 consequence，缺失返回 8007
3. 量刑档次定位（按 amount/times/consequence）：
   a. 盗窃罪示例：amount < 1000 → 不构成犯罪；1000-3000 → 3 年以下；3000-30000 → 3-10 年；> 30000 → 10 年以上
   b. 取对应档次的 sentencingRange = {min, max}
4. 基准刑计算：
   a. baseSentence = (min + max) / 2（档次中位数）
5. 情节调节：
   a. priorConviction=true → adjustments 追加 {type: aggravating, factor: prior_conviction, percentage: +10% ~ +20%}
   b. surrender=true → adjustments 追加 {type: mitigating, factor: surrender, percentage: -20% ~ -30%}
   c. merit=true → adjustments 追加 {type: mitigating, factor: merit, percentage: -10% ~ -20%}
   d. 退赃退赔（如 elements 含 restitution，预留）→ -10% ~ -20%
6. 计算最终刑期：
   a. finalSentence = baseSentence × (1 + Σ percentage / 100)
   b. clamp 到 [min, max]：超出 max 取 max，低于 min 取 min
7. 组装 calculationTrace：档次定位 + 基准刑 + 逐项调节 + clamp 结果
8. 降级：若 charge 不在 sentencing_guide 覆盖范围，返回 warnings 提示"该罪名暂未覆盖量刑指导数据，仅返回法定刑幅度"，baseSentence = null
9. 组装输出 + disclaimer
```

### 10.5 法条依据

- `刑法`分则各罪名条款（如盗窃罪→第二百六十四条，故意伤害罪→第二百三十四条）
- `最高人民法院关于常见犯罪的量刑指导意见》（法发〔2017〕7 号）
- 各省高级人民法院量刑实施细则

### 10.6 免责声明

```
"⚠️ 量刑指导仅供参考，不构成法律意见。最终量刑由法院根据全案情况决定，本工具仅基于常见情节估算，未考虑全部量刑因素。如涉及刑事案件，请务必咨询专业刑事辩护律师。"
```

### 10.7 评测集与指标

- 评测集：50+ 标注样本（10 常见罪名 × 5 情节组合，含单一/多重情节）
- 指标：
  - 基准刑幅度准确率 ≥ 90%（档次定位正确）
  - 情节调节正确率 ≥ 85%（调节方向与比例区间正确）
  - 法定刑幅度 100% 准确（必须零错误）
- 边界样本：数额刚好在档次分界线、多重加重情节叠加导致超 max、多重减轻情节导致低 min、罕见罪名（无覆盖数据）

### 10.8 工具元数据

```typescript
{
  toolId: 'sentencing_guide',
  name: '量刑指导',
  description: '罪名+情节要素→量刑幅度+基准刑+调节比例',
  category: 'criminal',
  piiLevel: 'L2',                               // 输入含案件情节（可能含案情细节）
  async: false,
  timeout: 5000,
  cacheable: true,
  cacheTtl: 7 * 86400                            // 7 天（量刑指导意见年度更新）
}
```

## 十一、工具 8：ClauseRecommender（条款推荐，v2.3）

### 11.1 用途与场景

用户在文书生成流程中选择文书类型（如"房屋租赁合同""买卖合同""借款合同"）并填写部分变量后，工具基于文书类型 + 已填变量从条款库（`clause_library`，见 05 3.29）中推荐适用条款 top 5，用户可采纳推荐条款插入文书。常用于合同起草、协议补充、条款复用，减少从零起草负担。

### 11.2 inputSchema / outputSchema

```jsonc
// inputSchema
{
  "type": "object",
  "properties": {
    "docType": { "type": "string", "description": "文书类型，如'房屋租赁合同''买卖合同''借款合同'" },
    "filledVars": { "type": "object", "description": "已填变量键值对，如{rentAmount: 5000, leaseTerm: 12}" },
    "category": { "type": "string", "description": "条款分类筛选（可选），如'违约责任''争议解决''保密条款'" }
  },
  "required": ["docType"]
}

// outputSchema
{
  "type": "object",
  "properties": {
    "recommendedClauses": {
      "type": "array",
      "maxItems": 5,
      "items": {
        "type": "object",
        "properties": {
          "clauseId": { "type": "string" },
          "title": { "type": "string" },
          "content": { "type": "string", "description": "条款正文（含变量占位符）" },
          "matchScore": { "type": "number", "minimum": 0, "maximum": 1, "description": "匹配分" },
          "applicable": { "type": "boolean", "description": "是否与已填变量兼容" },
          "reason": { "type": "string", "description": "推荐理由（可读）" }
        },
        "required": ["clauseId", "title", "content", "matchScore"]
      }
    }
  },
  "required": ["recommendedClauses", "disclaimer"]
}
```

### 11.3 数据依赖

- `clause_library` 集合（v2.3，见 05 3.29）：字段 `clauseId / title / content / docType / category / applicableConditions / source(standard|custom) / version`
- `LlmService`（LLM rerank 辅助）
- BM25 倒排索引（复用 v2.0 既有基础设施，按 `clause_library.content` 建索引）

### 11.4 核心算法

```
1. 按 docType 过滤 clause_library：query = { docType: docType, source: { $in: ['standard', 'custom'] } }
2. 若 category 提供，追加过滤：query.category = category
3. BM25 召回阶段：
   a. 将 filledVars 转为关键词集合（键名 + 值的文本表示）
   b. 对过滤后的条款集做 BM25 打分（以 clause_library.content 为文档，filledVars 关键词为查询）
   c. 召回 Top-20 候选
4. LLM rerank 阶段（assistWithLlm）：
   a. 构造 prompt：docType + filledVars 摘要 + Top-20 候选条款标题与摘要 + "请从中选择最匹配的 5 个并给出 matchScore 与推荐理由"
   b. LLM 返回 [{ clauseId, matchScore, reason, applicable }]
   c. applicable 判定：LLM 根据条款 applicableConditions 与 filledVars 判断兼容性
5. 合并 BM25 与 LLM 结果：finalScore = 0.3 × BM25_norm + 0.7 × LLM_score
6. 取 finalScore Top-5，组装 recommendedClauses
7. 降级：LLM 不可用时仅返回 BM25 Top-5，warnings 提示"LLM rerank 不可用，仅基于关键词匹配"，applicable 字段默认 true
8. 组装输出 + disclaimer
```

### 11.5 法条依据

条款推荐本身不直接引用法条，`lawRefs` 可空。条款库中的标准条款（source=standard）由法务团队依据相关法律法规编写，条款 content 中可能含法条引用，但不由本工具校验（法条引用校验由 DocumentReviewer 工具负责）。

### 11.6 免责声明

```
"⚠️ 推荐条款仅供参考，请在专业律师审核后使用。条款适用性因具体案情而异，本工具推荐不构成法律意见。"
```

### 11.7 评测集与指标

- 评测集：50+ 标注样本（5 类文书 × 10+ 场景，含不同已填变量组合）
- 指标：
  - 条款采纳率 ≥ 60%（用户采纳推荐条款的比例）
  - Top-3 命中率 ≥ 75%（金标条款在 Top-3 内）
  - applicable 判定准确率 ≥ 90%（与人工判断一致）
- 边界样本：空 filledVars（仅 docType）、filledVars 与所有条款均不兼容、自定义条款（source=custom）混入

### 11.8 工具元数据

```typescript
{
  toolId: 'clause_recommender',
  name: '条款推荐',
  description: '文书类型+已填变量→推荐适用条款 top 5（BM25 召回 + LLM rerank）',
  category: 'general',
  piiLevel: 'L1',                               // 输入仅文书类型与变量键值，无 PII
  async: false,
  timeout: 5000,                                // LLM rerank 可能耗时
  cacheable: true,
  cacheTtl: 86400                                // 24 小时（条款库低频变更）
}
```

---

## 十二、工具评测框架

### 12.1 评测集设计

- 每个工具 50+ 标注样本，存 `intent_eval_set` 集合（复用 v2.0 评测基础设施，type 字段填 `tool_<toolId>`）
- 样本来源：人工标注（70%）+ 用户反馈（20%）+ 合成（10%）
- 难度分级：easy / medium / hard，hard 比例 ≥ 30%
- 标注字段：`input` / `expectedOutput` / `expectedLawRefs` / `difficulty` / `annotator`

### 12.2 评测指标

| 工具 | 主指标 | 目标 | 辅助指标 |
|------|--------|------|----------|
| LawValidityQuery | 现行有效状态准确率 | 100% | 查询响应时间 P95 < 500ms |
| PeriodCalculator | 截止日计算准确率 | ≥ 99% | 节假日扣除逻辑零错误 |
| LicenseOcr | 字段识别准确率 | ≥ 90% | 关键字段 ≥ 95%，类型识别 ≥ 95% |
| DocumentReviewer | 必填项缺失检出率 | ≥ 95% | 误报率 ≤ 5% |
| CompensationQuery | 金额计算准确率 | ≥ 95% | 项目完整率 ≥ 90% |
| CauseClassifier | Top-3 命中率 | ≥ 85% | 平均置信度 ≥ 0.7 |
| SentencingGuide | 基准刑幅度准确率 | ≥ 90% | 情节调节正确率 ≥ 85% |
| ClauseRecommender（v2.3） | 条款采纳率 | ≥ 60% | Top-3 命中率 ≥ 75% |

### 12.3 评测流程

```
1. 评测脚本：scripts/eval/tool-eval.ts
2. 每周自动跑全量评测（CI/CD 流水线），结果写 stats_daily
3. 准确率下降 ≥ 3% 触发告警
4. 新工具上线前必须通过评测基线
5. 评测集每月扩充（用户反馈 + 新边界样本）
```

## 十三、安全与合规

### 13.1 PII 边界

| 工具 | piiLevel | PII 类型 | 处理 |
|------|----------|---------|------|
| LawValidityQuery | L1 | 无 | — |
| PeriodCalculator | L1 | 无 | — |
| LicenseOcr | L3 | 姓名/身份证号/住址 | 输出审计前脱敏；rawOcrText 默认不返回 |
| DocumentReviewer | L3 | 当事人姓名/事实陈述 | 输入审计前脱敏；文书内容不入缓存 |
| CompensationQuery | L2 | 收入数据/伤残情况 | 输入审计前脱敏金额精确值（保留数量级） |
| CauseClassifier | L2 | 案情描述 | 输入审计前脱敏（人名/地名替换） |
| SentencingGuide | L2 | 案件情节 | 输入审计前脱敏 |
| ClauseRecommender（v2.3） | L1 | 无 | — |

### 13.2 输入校验

- 所有工具入参先经 `inputSchema` JSON Schema 校验（防注入）
- 文本字段长度上限（防止超长输入消耗资源）
- 数值字段范围校验（duration ≤ 3650 天等）
- LicenseOcr 的 fileId 必须经 UploadService 安全校验（v2.0 既有）

### 13.3 输出免责

- 每个工具输出强制含 `disclaimer` 字段，文案因工具而异（见各工具 4.6/5.6/6.6/11.6 节）
- invokeTool 云函数出口处二次校验 disclaimer 存在，缺失则注入兜底："⚠️ 本工具结果仅供参考，不构成法律意见。"
- 涉法条响应还须含 `lawRefs`，未核实法条标 `verified: false` + 警示

### 13.4 审计事件

| event | 触发 | detail 关键字段 |
|-------|------|----------------|
| `tool_invoke` | 工具调用成功 | toolId, inputHash, duration, fromCache, degraded |
| `tool_invoke_failed` | 工具调用失败 | toolId, inputHash, errorCode, errorMessage |

- 事件写入 `audit_log` 集合，TTL 180 天（沿用 v2.0）
- 输入原文不入审计（仅 inputHash），PII 不留痕
- 运营后台可按 toolId 维度查调用趋势与失败率

## 十四、CitationGraphBuilder（法条引用图谱构建器，v2.3）

### 14.1 定位

`CitationGraphBuilder` 为**模块**而非 LegalTool（不占工具编号），维护 `law_citation_graph` 集合（见 05 3.26），为 15 第十三节法条时效扫描（LawTimelinessScanner 步骤 2 交叉引用扫描）和 16 第五节案例对比（CaseComparator）提供法条引用关系数据基础。

### 14.2 输入 / 输出

| 项 | 说明 |
|----|------|
| 输入 | `case_precedent.citedLaws[]`（案例引用法条列表）+ `document_record.citedLaws[]`（文书引用法条列表） |
| 输出 | 更新 `law_citation_graph` 集合：`articleId → { citingCaseIds[], citingDocIds[], citedCount, lastCitedAt, updatedAt }` |

### 14.3 触发机制

| 触发方式 | 时机 | 范围 |
|---------|------|------|
| 异步事件触发 | 案例/文书入库时（StorageClassifier 阶段三完成 / DocumentGenerator 生成完成） | 单条案例/文书的 citedLaws |
| 定时全量重建 | `cron: 0 0 4 * * *`（每日 04:00） | `law_citation_graph` 全量重建 |

### 14.4 核心算法

```
增量 upsert 模式（事件触发）：
1. 输入：recordId（案例/文书 ID）+ citedLaws[]（法条 articleId 列表）+ recordType（case/document）
2. for articleId in citedLaws:
2.1   graph = law_citation_graph.findOne({ articleId: articleId })
2.2   if not graph:
2.3     graph = { articleId, citingCaseIds: [], citingDocIds: [], citedCount: 0, lastCitedAt: null, updatedAt: now }
2.4   if recordType == 'case':
2.5     if recordId not in graph.citingCaseIds: graph.citingCaseIds.push(recordId)
2.6   else:
2.7     if recordId not in graph.citingDocIds: graph.citingDocIds.push(recordId)
2.8   graph.citedCount = graph.citingCaseIds.length + graph.citingDocIds.length
2.9   graph.lastCitedAt = now
2.10  graph.updatedAt = now
2.11  law_citation_graph.upsert(graph)
3. 审计 citation_graph_updated { articleId, recordType, recordId, citedCount }

全量重建模式（定时触发）：
1. 清空 law_citation_graph
2. 遍历 case_precedent 全量，对每条记录的 citedLaws[] 执行增量 upsert
3. 遍历 document_record 全量，对每条记录的 citedLaws[] 执行增量 upsert
4. 审计 citation_graph_rebuilt { caseCount, docCount, articleCount, durationMs }
```

### 14.5 数据依赖

| 集合 | 用途 | 定义位置 |
|------|------|---------|
| `law_citation_graph` | 输出（法条引用图谱） | 05 3.26（v2.3） |
| `case_precedent` | 输入（案例引用法条） | 05 3.3 |
| `document_record` | 输入（文书引用法条） | 05 3.8 |

### 14.6 降级策略

| 场景 | 降级措施 |
|------|---------|
| 全量重建超时（> 30 分钟） | 保留旧图谱 + 告警 + 人工介入 |
| 单条 upsert 失败 | 跳过 + 审计，不影响其他法条 |
| case_precedent/document_record 无 citedLaws 字段 | 跳过该记录 |

### 14.7 模块实现

- 模块名：`CitationGraphBuilder`
- 所属域：1.10 采集域（见 04）
- 部署：云函数 `knowledgePipeline`（定时触发器）+ 事件触发（StorageClassifier / DocumentGenerator 内联调用）
- 与 15 第十三节 LawTimelinessScanner 协作：CitationGraphBuilder 维护图谱 → LawTimelinessScanner 查询引用关系

---

## 十五、与 v1.0/v2.0/v2.1/v2.2/v2.3 的差异声明

v2.2 新增本文档（14-tool-design.md），定义 7 个法律工具的统一接口、实现规范、评测框架与安全合规。工具经 ToolAgent（见 04 1.9 节）包装为第 9 个专业 Agent，纳入 AgentRegistry，既可被用户经 TabBar 工具 Tab 直接调用（经 invokeTool 云函数），也可被 OrchestratorAgent 在编排中调用。工具复用 v2.0 既有领域模块（OcrService/RuleEngine/KnowledgeBase）与 v2.1 Agent 基础设施（AgentRegistry/AuditLog/CacheService），不引入新基础设施。新增 9 个错误码 8001-8009（见 06），新增 7 个 MCP tools 与 9 个 OpenAPI 端点（见 12）。

- **v2.2 → v2.3**：
  - 新增第十一节"工具 8：ClauseRecommender（条款推荐）"：第 8 个 LegalTool，输入 docType/filledVars/category → BM25 召回 + LLM rerank top 5，依赖 `clause_library` 集合（05 3.29），piiLevel=L1，cacheable=true（TTL 1 天），评测指标条款采纳率 ≥ 60% / Top-3 命中率 ≥ 75%。
  - 新增第十四节"CitationGraphBuilder（法条引用图谱构建器）"：模块（非 LegalTool），维护 `law_citation_graph` 集合（05 3.26），增量 upsert + 每日全量重建，为 15 第十三节 LawTimelinessScanner 交叉引用扫描和 16 第五节 CaseComparator 案例对比提供数据基础。
  - `ToolId` 类型追加 `'clause_recommender'`；`LegalToolError` code 联合类型追加 `8019`（法条适用判定要件不足，属推理域，见 16 第四节）。
  - 评测指标表（12.2 节）追加 ClauseRecommender 行；PII 边界表（13.1 节）追加 ClauseRecommender 行（L1）。
  - 03 第十二·补节 12.4 工具免责表追加 ClauseRecommender disclaimer 行。
  - LegalTool 总数 7 → 8；MCP tools 新增 1 个（`tool.clause_recommender`，见 12）；影响范围追加 03/15/16。
