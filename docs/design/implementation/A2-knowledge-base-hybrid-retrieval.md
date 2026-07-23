# A2 · 知识库 + 混合检索（BM25 + 向量 + RRF）

> 阶段：A2（后端业务补齐第二步） | 对应 v2.3 路线图阶段二 | 前置依赖：A1（NestJS 工程、IntentRouter、平台横切模块、MongoDB 接入）
> 技术栈：MongoDB Atlas Vector Search / Milvus + 通义 Embedding + 自研 RRF 融合
> 目标：实现法律知识库结构化查询 + 三路混合检索（BM25 倒排 + 向量召回 + RRF 融合重排）+ 法条引用校验，为 chat 的 knowledge/llm 路由提供高质量上下文。

---

## 一、范围与目标

| 范围 | 说明 |
|------|------|
| KnowledgeBase | 结构化知识（流程/材料清单/模板/术语/FAQ）查询，替代 A1 占位 |
| RagService | BM25 倒排 + 向量召回 + RRF 融合 + 重排 + 法条引用校验 |
| Embedding 接入 | 通义/Agnes Embedding API，批量向量化法条与案例 |
| 向量索引 | MongoDB Atlas Vector Search（首选）或 Milvus 外挂 |
| 数据导入 | law_article >= 5000 条、case_precedent >= 2000 条、legal_knowledge 结构化知识 |
| 法条更新管道雏形 | LawUpdatePipeline 手动触发版（法条变更 -> 缓存失效） |
| 检索评测 | 50 题金标集，Recall@10 >= 0.85 |

**不在 A2 范围**：文书生成（A3）、多 Agent 编排（A4）、知识采集管道（v2.3 阶段七）、ClauseRecommender（A3）。

---

## 二、前置依赖

- A1 全部交付物（NestJS 工程、MongoDB、Redis、平台横切模块）
- MongoDB Atlas Vector Search（M10+ 集群，或自建 Milvus 2.4+）
- 通义/Agnes Embedding API 凭证（.env 新增 EMBEDDING_API_KEY / EMBEDDING_BASE_URL / EMBEDDING_MODEL）
- 法条数据源：国家法律法规数据库（flk.npc.gov.cn）爬取或人工整理 JSON
- 案例数据源：中国裁判文书网公开数据子集

---

## 三、KnowledgeBase（结构化知识查询）

```typescript
interface KnowledgeResult {
  type: 'process' | 'material' | 'term' | 'faq' | 'template';
  title: string;
  content: string;
  structured?: object;      // 流程步骤/材料清单等结构化数据
  lawRefs: LawRef[];
  score: number;
}

class KnowledgeBase {
  // 按类型查询结构化知识（流程/材料清单）
  async queryByType(type: string, category: string, subCategory?: string): Promise<KnowledgeResult[]>;
  // 关键词查询（用于 knowledge 路由命中）
  async queryByKeyword(keyword: string, opts?: { limit?: number }): Promise<KnowledgeResult[]>;
  // 精确查询单条（用于 RuleEngine 补充）
  async getById(id: string): Promise<KnowledgeResult | null>;
}
```

- 数据来源：legal_knowledge 集合（type/category/subCategory/title/content/structured/lawRefs/tags）
- 查询走 MongoDB 索引（idx_type_category、idx_tags），无 LLM，响应 < 50ms
- 覆盖民事/刑事/商事/行政四类常见流程与材料清单

---

## 四、RagService（三路混合检索 + RRF 融合）

### 4.1 接口

```typescript
interface RagResult {
  lawArticles: LawArticleHit[];     // 召回法条（含 verified 标记）
  precedents: CasePrecedentHit[];   // 召回案例
  fusedRanking: FusedHit[];         // RRF 融合后排序
  lawRefs: LawRef[];                // 提取的法条引用（供 LLM 注入）
  validated: boolean;               // 法条引用校验结果
}

class RagService {
  async retrieve(query: string, intent: IntentType, opts?: {
    topK?: number;              // 每路召回数，默认 10
    lawCategory?: string;       // 法条分类过滤
    causeOfAction?: string;     // 案由过滤
    judgmentYearRange?: { from: number; to: number };
  }): Promise<RagResult>;
}
```

### 4.2 三路召回

**第一路：BM25 倒排召回**
- 对 law_article.content 与 case_precedent.content 建立倒排索引（中文分词用 jieba 或 IK Analyzer）
- MongoDB 侧用 $text 搜索 或自建倒排表；规模大时迁移 Elasticsearch
- 返回 top-K 文档 + BM25 分数

**第二路：向量召回**
- 查询文本经 Embedding API 向量化（768/1024 维）
- MongoDB Atlas Vector Search：$vectorSearch 管道，余弦相似度
- 返回 top-K 文档 + 相似度分数
- A1 已在 law_article / case_precedent schema 预留 embedding 字段

**第三路：结构化过滤（KnowledgeBase）**
- 若 intent 为 process_guide/material_checklist，直接查 KnowledgeBase
- 作为 BM25/向量的补充召回源

### 4.3 RRF 融合

```
RRF_score(doc) = Σ_{路 r} 1 / (k + rank_r(doc))     // k=60 经验值
```

- 对每路召回结果按分数排序得到 rank
- 跨路用 RRF 公式融合，生成 fusedRanking
- 融合后取 top-N（默认 10）作为最终上下文

### 4.4 重排（Rerank，可选）

- 规模较大时接入交叉编码器重排（如 bge-reranker）
- 对 fusedRanking top-20 做精排，输出 top-10
- A2 MVP 阶段可跳过，依赖 RRF 融合质量

### 4.5 法条引用校验

```typescript
// 复用 A1 已有的 LlmService.validateLawRefs（基于 lawRefExtractor）
async validateLawRefs(text: string): Promise<{ verified: LawRef[]; unverified: LawRef[] }>;
```

- LLM 输出中提取的法条号与 law_article 集合比对
- 命中的标记 verified=true；未命中标记"未核实"并降级展示
- 法条引用校验准确率目标 100%（不误判有效法条为未核实）
---

## 五、Embedding 接入

```typescript
class EmbeddingService {
  async embed(text: string): Promise<number[]>;           // 单条向量化
  async embedBatch(texts: string[]): Promise<number[][]>;  // 批量向量化
}
```

- 默认通义 Embedding（text-embedding-v2，1536 维）或 Agnes Embedding
- 批量向量化限流（10 条/批，QPS 限制走 retry.ts 指数退避）
- 向量缓存：同文本哈希 -> 向量，存 Redis（TTL 30 天），避免重复调用

---

## 六、向量索引方案

### 方案 A（首选）：MongoDB Atlas Vector Search

```json
// Atlas Vector Search Index 定义
{
  "fields": [{
    "type": "vector",
    "path": "embedding",
    "numDimensions": 1536,
    "similarity": "cosine"
  }, {
    "type": "filter",
    "path": "category"
  }, {
    "type": "filter",
    "path": "causeOfAction"
  }]
}
```

- 优势：与业务数据同库，$vectorSearch 管道支持预过滤（category/causeOfAction）
- 劣势：需 Atlas M10+ 集群（月费约 $60）

### 方案 B（备选）：Milvus 2.4+ 外挂

- law_article / case_precedent 的 embedding 同步写入 Milvus collection
- 业务数据留 MongoDB，向量检索走 Milvus，通过 _id 关联
- 优势：开源免费、性能强；劣势：多一套中间件运维

**选型决策**：MVP 阶段用方案 A（简化运维）；规模 > 50 万条或 Atlas 成本过高时迁方案 B。

---

## 七、数据导入管道

### 7.1 law_article 导入（目标 >= 5000 条）

```typescript
// scripts/import-law-articles.ts
class LawArticleImporter {
  async importFromJson(filePath: string): Promise<{ inserted: number; updated: number; skipped: number }>;
  async vectorizeAll(): Promise<void>;  // 对全量 content 调 EmbeddingService
}
```

- 数据源：国家法律法规数据库爬取或人工整理 JSON
- 字段：lawName / articleNo / articleNoInt / category / content / keywords / province / legalHierarchy
- 去重：contentHash（SHA-256），重复跳过
- 向量化：导入后批量调 EmbeddingService，写入 embedding 字段

### 7.2 case_precedent 导入（目标 >= 2000 条）

- 数据源：中国裁判文书网公开数据子集（脱敏处理）
- 字段：caseTitle / caseNo / court / category / causeOfAction / judgmentDate / outcomeLabel / content
- 向量化：同上

### 7.3 legal_knowledge 导入

- 人工整理民事/刑事/商事/行政四类常见流程（caseProcesses.ts）与材料清单（materialChecklists.ts）
- type=process：立案/审理/执行各阶段步骤 + 时间线
- type=material：各案由所需材料清单（name/required/note）

---

## 八、涉及集合（A2 新增/扩展）

| 集合 | A2 变更 |
|------|---------|
| law_article | 新增 embedding 字段（number[1536]）+ 向量索引 |
| case_precedent | 新增 embedding 字段 + 向量索引 + idx_category_causeOfAction 等索引 |
| legal_knowledge | A1 已建，A2 导入业务数据 |
| llm_cache | 复用 A1，法条更新时按 affectedLawArticles 失效 |

---

## 九、LawUpdatePipeline（法条更新管道雏形）

```typescript
class LawUpdatePipeline {
  // A2 手动触发版；v2.3 阶段七扩展为自动采集
  async runManual(source: 'flk.npc' | 'json-file'): Promise<{ updated: number; cacheInvalidated: number }>;
}
```

- 检测法条内容变更（contentHash 对比）
- 更新 law_article 记录 + 重新向量化
- 按 affectedCacheKeys 批量失效 llm_cache（CacheService.invalidateByLawArticle）
- 写审计 law_update

---

## 十、检索评测

- **评测集**：50 个典型法律问题，标注"应召回法条"与"应召回案例"金标
- **指标**：
  - Recall@10 >= 0.85（金标法条命中）
  - 法条引用校验准确率 100%
  - RRF 融合 vs 单路 BM25 / 单路向量 的 nDCG@10 对比（融合应更优）
- **脚本**：test/eval/retrieval-eval.ts，每次检索算法改动跑批

---

## 十一、验收标准

| # | 标准 | 验证方式 |
|---|------|---------|
| 1 | law_article >= 5000 条 + 向量化完成 | 数据库计数 |
| 2 | case_precedent >= 2000 条 + 向量化完成 | 数据库计数 |
| 3 | legal_knowledge 四类流程 + 材料清单覆盖 | 数据校验 |
| 4 | RagService.retrieve 三路召回 + RRF 融合可用 | 集成测试 |
| 5 | 向量检索 P95 < 200ms（1 万条规模） | 性能测试 |
| 6 | Recall@10 >= 0.85 | retrieval-eval 脚本 |
| 7 | 法条引用校验准确率 100% | 单测 |
| 8 | RRF 融合 nDCG@10 优于单路 | 评测对比 |
| 9 | KnowledgeBase 流程查询覆盖民事/刑事/商事/行政 | 功能测试 |
| 10 | LawUpdatePipeline 手动触发可用 + 缓存失效正确 | 集成测试 |

---

## 十二、风险与对策

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| 向量检索规模瓶颈 | 低 | 中 | MVP 用 Atlas Vector Search；> 50 万条迁 Milvus |
| Embedding API 限流 | 中 | 中 | 批量化 + 指数退避 + 向量缓存 |
| 法条数据源获取合规 | 中 | 高 | 优先国家法律法规数据库公开数据；案例脱敏 |
| 中文分词质量影响 BM25 | 中 | 中 | 用 jieba + 法律领域词典；评测驱动调优 |
| Atlas Vector Search 成本 | 低 | 中 | M10 起步；成本超阈值迁 Milvus |
| 法条更新不及时导致误导 | 中 | 高 | LawUpdatePipeline + contentHash 去重 + 法条引用校验兜底 |

---

## 十三、交付物清单

- KnowledgeBase 模块（queryByType / queryByKeyword / getById）
- RagService 模块（retrieve：三路召回 + RRF 融合 + 法条校验）
- EmbeddingService 模块（embed / embedBatch + 向量缓存）
- 向量索引定义（Atlas 或 Milvus）
- 数据导入脚本（import-law-articles.ts / import-case-precedent.ts / import-legal-knowledge.ts）
- LawUpdatePipeline 雏形（手动触发）
- test/eval/retrieval-eval.ts + 50 题金标集
- law_article / case_precedent schema 扩展（embedding 字段）

**预计工期**：4 周（与 v2.3 阶段二一致）。
