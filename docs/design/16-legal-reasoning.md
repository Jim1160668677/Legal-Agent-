# 16 · 法律推理架构

> 版本：v2.3 | 日期：2026-07-22 | 状态：新建（v2.3 IRAC 推理框架权威源）
> 影响范围：04 / 05 / 07 / 09 / 11 / 14
> 本文为 IRAC 推理、案情相似度、法条适用判定、案例对比权威源；模块名与目录结构以 04 为准，集合与字段以 05 为准，意图枚举与算法索引以 07 为准，UI 线框图以 09 为准，Agent 编排以 11 为准，工具接口以 14 为准。

---

## 一、设计目标

1. **结构化推理** — 用 IRAC 框架（Issue / Rule / Application / Conclusion）约束 LLM 输出，避免自由发挥导致法律分析不严谨。
2. **可溯源** — 每步推理绑定法条/案例引用，写入 `reasoning_chain` 集合（见 05 3.28），支持事后审计与律师审核（见 17）。
3. **可对比** — 支持案例间事实相似度计算与差异高亮，为用户提供"相似案例参考"而非泛泛分析。
4. **可判定** — 法条适用性判定（applicable / partial / false）而非模糊陈述，提升推理结论的可操作性。

### 1.1 定位

本文档为 `case_reasoning` 意图（见 07 第 1.1 节意图枚举表第 8 行）的算法权威源。`case_reasoning` 与 `case_analysis` 双意图并存：

| 意图 | 触发 | 推理方式 | 成本 | 输出 |
|------|------|---------|------|------|
| `case_analysis` | "这个案子能赢吗""判多重" | 自由 LLM 分析 | 低 | 文本回答 |
| `case_reasoning`（v2.3） | "能赢吗"+复杂案情 / "相似案例" / "怎么辩护" | IRAC 结构化推理 | 高 | reasoning_chain + 结构化回答 |

IntentRouter 按复杂度路由：简单问题走 `case_analysis`，复杂问题（含多实体/多争议点/要求案例对比）走 `case_reasoning`。

### 1.2 与其他文档的关系

| 文档 | 关系 |
|------|------|
| 04 | 模块定义（IracReasoner / FactSimilarityService / CaseComparator / LawApplicationDeterminer，见 04 1.12 法律推理域） |
| 05 | 集合 schema（reasoning_chain，见 05 3.28） |
| 07 | 意图枚举（case_reasoning，见 07 1.1 节）+ 第九节法律推理算法索引 |
| 09 | UI 组件（ReasoningChainView / CaseComparisonView / RelationGraph） |
| 11 | Agent 编排（reasoning Agent，见 11 Agent 清单第 11 行）+ case_reasoning 编排计划 |
| 14 | CitationGraphBuilder（法条引用图谱，见 14 第十四节）为案例对比提供数据 |
| 15 | LawTimelinessScanner（法条时效扫描，见 15 第十三节）为 Rule 抽取提供时效校验 |
| 17 | 律师审核引用 reasoning_chain 进行质量评分与标注回流 |

---

## 二、IRAC 推理框架

`IracReasoner` 模块按 IRAC 四步执行推理，每步输出结构化数据，写入 `reasoning_chain` 集合。

### 2.1 Issue（争议点识别）

**输入**：用户问题 + 实体抽取结果（来自 nlu Agent 的 EntityExtractor，见 07 第八节 8.1）

**算法**：

```
1. 构造 LLM prompt：
   - system: "你是法律分析专家。请从用户问题中识别法律争议点，每个争议点标注类型与关联法条。"
   - user: 用户问题 + entities[] + "请输出 JSON: { issues: [{ issueText, issueType, relatedLaws: [articleId?] }] }"
2. LLM 返回 issues[]
3. 后处理：
   a. 对每个 issue.relatedLaws，调 RagService.verifyArticleId 核实存在性
   b. 不存在的 articleId 移除 + warnings
   c. issueType 归一化到枚举：contract_dispute / tort / property / family / labor / criminal / administrative / other
4. 输出：issues[] = { issueText, issueType, relatedLaws[] }
```

**边界条件**：
- LLM 返回空 issues → 降级为关键词匹配（从用户问题中抽取"违约/侵权/离婚/劳动"等关键词 → issueType 映射）
- 用户问题含多个争议点（复合意图拆分后） → 每子意图独立产出一组 issues

### 2.2 Rule（法条规则抽取）

**输入**：issues[] + RagService 召回法条

**算法**：

```
1. for issue in issues:
1.1   recallKey = issue.issueText + issue.issueType
1.2   articles = RagService.search(recallKey, topK=5)   // BM25 + 向量混合检索
1.3   扩展召回：查 law_citation_graph（见 05 3.26）找出与 issue.relatedLaws 有引用关系的法条
1.4   时效校验：过滤 status=repealed 的法条 + warnings 提示已废止
1.5   for article in articles:
1.6     rule = parseArticle(article)   // 解析法条文本，抽取构成要件与法律后果
1.7     rules.push({
       articleId: article._id,
       articleText: article.content,
       conditions: article.conditions[],      // 构成要件
       legalConsequences: article.consequences[]  // 法律后果
     })
2. 输出：rules[] = { articleId, articleText, conditions[], legalConsequences[] }
```

**法条解析**（parseArticle）：
- 结构化法条（`law_article.structured` 字段已含 conditions/consequences）→ 直接读取
- 非结构化法条 → LLM 辅助抽取（prompt: "请从法条文本中抽取构成要件与法律后果"）

### 2.3 Application（事实映射）

**输入**：rules[].conditions[] + 用户案情实体（来自 nlu Agent）

**算法**：调用 `LawApplicationDeterminer`（见第四节），对每条 rule 判定法条适用性。

**输出**：applications[] = { ruleId, factMatch: `applicable` | `partial` | `false`, matchedFacts[], unmatchedFacts[] }

### 2.4 Conclusion（综合结论）

**输入**：applications[]

**算法**：

```
1. 构造 LLM prompt：
   - system: "你是法律分析专家。请基于法条适用判定结果，综合给出结论。结论须包含：总结、置信度、风险等级、免责声明。"
   - user: JSON.stringify(applications[]) + "请输出 JSON: { summary, confidence, riskLevel, disclaimer, lawRefs[] }"
2. LLM 返回 conclusion
3. 后处理：
   a. confidence 归一化到 [0, 1]
   b. riskLevel 归一化到枚举：low / medium / high
   c. disclaimer 强制附加：⚠️ 以上分析基于公开信息，不构成法律意见，具体问题请咨询专业律师。
   d. lawRefs 从 applications 中聚合所有 applicable/partial 的 rule.articleId
4. 写入 reasoning_chain 集合（见第六节）
5. 写入 answer_traceability（见 05 3.34，由 AnswerTracer 模块处理）
6. 输出：conclusion = { summary, confidence, riskLevel, disclaimer, lawRefs[] }
```

**置信度参考表**：

| applications 聚合 | 建议置信度 | 风险等级 |
|-------------------|-----------|---------|
| 全部 applicable | ≥ 0.8 | low（结论较确定） |
| 部分 partial | 0.5-0.8 | medium（需补充事实） |
| 含 false 或全部 partial | < 0.5 | high（建议咨询律师） |

---

## 三、案情事实相似度算法（FactSimilarityService）

### 3.1 设计目标

量化两份案情描述的相似度，支持案例对比（CaseComparator）与案例召回排序。

### 3.2 算法

```
输入：factA（用户案情文本 + 实体）, factB（案例案情文本 + 结构化属性）
输出：similarity ∈ [0, 1]

1. factEmbedding 相似度（权重 0.6）：
   a. embA = text-embedding-v2(factA.text)   // 768 维向量
   b. embB = text-embedding-v2(factB.text)
   c. cosSim = cosine(embA, embB) ∈ [-1, 1] → 归一化到 [0, 1]：(cosSim + 1) / 2

2. factAttributes 相似度（权重 0.4）：
   a. attrsA = extractAttributes(factA)   // { causeOfAction, partyRoles, disputeAmount, timeline }
   b. attrsB = factB.structuredFields      // 案例已有结构化属性
   c. jaccardSim = jaccard(attrsA, attrsB)   // 集合交并比
   d. 属性权重：
      - causeOfAction: 0.4（案由匹配最重要）
      - partyRoles: 0.2
      - disputeAmount: 0.2（区间重叠）
      - timeline: 0.2

3. similarity = 0.6 × cosSim + 0.4 × jaccardSim
4. 返回 similarity
```

### 3.3 阈值

| 相似度范围 | 判定 | 展示 |
|-----------|------|------|
| ≥ 0.75 | 强相似 | CaseComparisonView 高亮"高度相似" |
| 0.5 - 0.75 | 弱相似 | CaseComparisonView 标注"部分相似" |
| < 0.5 | 不相似 | 不展示 |

### 3.4 边界条件

- factA 或 factB 文本过短（< 20 字）→ factEmbedding 置信度低，权重降至 0.3，factAttributes 升至 0.7
- factB 无 structuredFields → factAttributes 降级为仅 causeOfAction 匹配（权重 1.0）
- text-embedding-v2 不可用 → 降级为仅 factAttributes（权重 1.0）+ warnings

---

## 四、法条适用判定算法（LawApplicationDeterminer）

### 4.1 设计目标

判定用户案情事实是否满足法条的构成要件，产出 `applicable / partial / false` 三级判定，而非模糊陈述。

### 4.2 算法

```
输入：rule.conditions[]（构成要件列表）+ factEntities[]（用户案情实体）
输出：{ factMatch, matchedFacts[], unmatchedFacts[] }

1. 构成要件抽取：
   a. 若 rule.conditions 已结构化 → 直接使用
   b. 若未结构化 → LLM 辅助抽取（prompt: "请从法条文本中抽取构成要件列表"）
   c. 抽取失败 → 抛 LegalToolError(8019, '法条适用判定要件不足', ...) + 降级为 LLM 整体判定

2. 事实匹配（逐要件判定）：
   for condition in rule.conditions:
   2.1   matchResult = matchCondition(condition, factEntities)
        // matchCondition: LLM 判定用户事实是否满足该要件
        // prompt: "法条要件: {condition}。用户事实: {factEntities}。请判定是否满足: yes/no/partial"
   2.2   if matchResult == 'yes': matchedFacts.push(condition)
   2.3   elif matchResult == 'partial': matchedFacts.push(condition + '(部分)')
   2.4   else: unmatchedFacts.push(condition)

3. 聚合判定：
   a. 全部 matched 且无 partial → factMatch = 'applicable'
   b. 含 partial 或部分 unmatched（非关键要件）→ factMatch = 'partial'
   c. 关键要件 unmatched → factMatch = 'false'
   // 关键要件判定：conditions 中标记为 required=true 的要件

4. 返回 { factMatch, matchedFacts, unmatchedFacts }
```

### 4.3 错误码

| 错误码 | 含义 | 触发条件 | 处理 |
|--------|------|---------|------|
| 8019 | 法条适用判定要件不足 | 构成要件抽取失败（法条未结构化 + LLM 抽取失败） | 降级为 LLM 整体判定 + warnings |

### 4.4 边界条件

- 法条无 conditions 字段且 LLM 不可用 → 返回 `partial` + warnings"法条构成要件无法解析，仅做整体判定"
- 用户案情实体缺失（nlu Agent 未抽取到关键实体） → 返回 `partial` + unmatchedFacts 含"事实信息不足"
- 多个 rule 的 factMatch 不一致 → Conclusion 阶段由 LLM 综合判断

---

## 五、案例对比（CaseComparator）

### 5.1 设计目标

将用户案情与召回的相似案例进行结构化对比，展示共同点与差异点，辅助用户理解案件走向。

### 5.2 算法

```
输入：userFacts（用户案情 + 实体）+ cases[]（RagService 召回案例 top 3）
输出：comparison[] = { caseId, similarity, sharedFacts[], diffFacts[], verdictDiff }

1. for case in cases:
1.1   similarity = FactSimilarityService.compute(userFacts, case)   // 见第三节
1.2   if similarity < 0.5: 跳过（不相似）
1.3   差异点抽取：
      a. sharedFacts: 用户事实与案例事实的交集（相同案由/相同争议类型/相似当事人角色）
      b. diffFacts: 用户事实与案例事实的差集（不同争议金额/不同时间线/不同判决结果）
      c. verdictDiff: 案例判决结果 vs 用户预期（若用户提供预期）
1.4   comparison.push({ caseId: case._id, similarity, sharedFacts, diffFacts, verdictDiff })

2. 按 similarity 降序排列
3. 返回 comparison[]
```

### 5.3 数据依赖

| 数据 | 来源 | 用途 |
|------|------|------|
| 案例库 | `case_precedent` 集合（见 05 3.3） | 召回相似案例 |
| 法条引用图谱 | `law_citation_graph` 集合（见 05 3.26） | 扩展召回（引用相同法条的案例） |
| 案情向量 | text-embedding-v2 | factEmbedding 相似度计算 |

### 5.4 UI 展示

对比结果由 `CaseComparisonView` 组件展示（见 09）：
- 表格化：用户案情 vs 案例 1 vs 案例 2 vs 案例 3
- 相似度百分比 + 颜色标识（绿色 ≥0.75 / 黄色 0.5-0.75）
- 共同事实 + 差异点高亮
- 判决对比列

---

## 六、推理链持久化（reasoning_chain 集合）

### 6.1 集合 schema

推理链写入 `reasoning_chain` 集合（见 05 3.28），字段定义：

```jsonc
{
  "_id": "auto",
  "chainId": "rc_xxx",                    // 唯一标识
  "msgId": "msg_xxx",                     // 关联消息 ID
  "userId": "openid_xxx",
  "issues": [
    { "issueText": "...", "issueType": "contract_dispute", "relatedLaws": ["articleId"] }
  ],
  "rules": [
    { "articleId": "...", "articleText": "...", "conditions": [...], "legalConsequences": [...] }
  ],
  "applications": [
    { "ruleId": "...", "factMatch": "applicable|partial|false", "matchedFacts": [...], "unmatchedFacts": [...] }
  ],
  "conclusion": {
    "summary": "...",
    "confidence": 0.82,
    "riskLevel": "low|medium|high",
    "disclaimer": "...",
    "lawRefs": [...]
  },
  "modelVersion": "qwen-v1",
  "promptVersion": "irac_prompt_v1",
  "createdAt": "2026-07-22T..."
}
```

### 6.2 用途

| 用途 | 消费方 |
|------|--------|
| 推理链可视化 | 09 ReasoningChainView 组件（IRAC 四步折叠展示） |
| 回答溯源 | 05 answer_traceability.reasoningChainId 关联 |
| 律师审核 | 17 LawyerReviewService 引用 reasoning_chain 进行质量评分 |
| 推理错误回流 | 17 LawyerAnnotationService 修正 reasoning_chain 后回流评测集 |

### 6.3 索引

- `idx_msgId`：按 msgId 查询（回答溯源）
- `idx_userId_createdAt`：按用户查历史推理链
- TTL：180 天（与 audit_log 一致）

---

## 七、降级策略

| 场景 | 降级措施 | 影响 |
|------|---------|------|
| LLM 不可用（IRAC 全流程依赖 LLM） | 跳过 IRAC，仅返回 RagService 召回法条 + 案例列表 + 免责声明 | 无推理链，无结构化结论 |
| LLM 不可用（仅 Application 步骤） | 跳过 Application，Conclusion 基于规则匹配直接生成 | applications 为空，conclusion.confidence 降至 0.3 |
| 法条适用判定失败（8019） | 返回 `partial` + warnings"法条构成要件无法解析" | factMatch 不精确，结论含 caveats |
| 案例对比无相似案例（similarity < 0.5） | 返回空 comparison[] + 引导"暂无高度相似案例，建议咨询专业律师" | 无案例对比展示 |
| text-embedding-v2 不可用 | FactSimilarityService 降级为仅 factAttributes | 相似度精度降低 |
| law_citation_graph 未就绪 | Rule 扩展召回跳过，仅用 RagService 直接召回 | 召回法条范围缩小 |
| reasoning_chain 写入失败 | 推理结果仍返回用户，但 answer_traceability.reasoningChainId 为空 | 溯源链不完整 + 告警 |

---

## 八、与 v1.0/v2.0/v2.1/v2.2 的差异声明

- **v1.0 → v2.2**：无法律推理架构。`case_analysis` 意图仅做自由 LLM 分析，无结构化推理链，无法条适用判定，无案例对比。
- **v2.2 → v2.3**：
  - 新增本文档（16-legal-reasoning.md），作为 IRAC 推理框架权威源。
  - 定义 `case_reasoning` 意图（见 07 1.1 节第 8 行），与 `case_analysis` 双意图并存，按复杂度路由。
  - 定义 4 个推理模块（见 04 1.12 法律推理域）：IracReasoner（IRAC 四步）/ FactSimilarityService（案情相似度）/ CaseComparator（案例对比）/ LawApplicationDeterminer（法条适用判定）。
  - 新增 `reasoning_chain` 集合（见 05 3.28），持久化 IRAC 推理链，支持溯源与律师审核。
  - 新增错误码 8019（法条适用判定要件不足，见 06）。
  - 新增 3 个 UI 组件（见 09）：ReasoningChainView / CaseComparisonView / RelationGraph。
  - 新增 reasoning Agent（见 11 Agent 清单第 11 行），持有 `case.reason` / `case.compare` / `law.apply_check` 3 个 capability（L-Write-Limited，可对外）。
  - 编排计划（见 11 第 5.2 节）：`case_reasoning` → nlu → case-search ∥ law-lookup → reasoning（前置 NLU + 并行召回 + 串行 IRAC 推理，异步）。
  - 依赖 14 CitationGraphBuilder（法条引用图谱）扩展召回 + 15 LawTimelinessScanner（法条时效校验）。
  - 被 17 LawyerReviewService 引用（推理链质量评分）+ LawyerAnnotationService 引用（推理错误回流）。
