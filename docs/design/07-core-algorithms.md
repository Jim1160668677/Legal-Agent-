# 07 · 核心算法设计

> 版本：v2.3 | 日期：2026-07-22 | 状态：设计扩展（v2.3 新增 case_reasoning 意图 + 第八节 NLU 增强 + 第九节法律推理引用 16）
> 影响范围：04 / 05 / 06 / 08 / 10 / 11 / 14 / 16
> 本文为意图枚举与算法 I/O 权威源。

---

## 一、意图识别（IntentRouter）

### 1.1 意图枚举与路由

| IntentType | 默认 Route | 复杂度 | 关键词示例 |
|-----------|-----------|--------|-----------|
| `legal_qa` | rule / knowledge | 低 | "民法典规定""什么是正当防卫""诉讼时效" |
| `document_generate` | llm | 高 | "帮我写起诉状""合同模板""律师函" |
| `process_guide` | knowledge | 中 | "我要起诉""立案流程""怎么举证" |
| `case_analysis` | llm | 高 | "这个案子能赢吗""判多重""怎么辩护" |
| `case_reasoning`（v2.3） | reasoning | 高 | "能赢吗""怎么辩护""判几年""相似案例" |
| `material_checklist` | knowledge | 中 | "离婚需要什么材料""立案要带什么" |
| `tool_invoke`（v2.2） | tool（经 ToolAgent） | 中 | "期间计算""文书审核""赔偿标准""证照识别""法条效力""案由""量刑" |
| `general_qa` | llm（兜底） | — | 其他 |

### 1.2 关键词加权打分公式

意图定义库 `data/legalIntents.ts` 结构：

```typescript
interface IntentDef {
  intent: IntentType;
  route: RouteTarget;
  keywords: { word: string; weight: number }[];   // weight ∈ (0,1]
  patterns: { regex: string; weight: number }[];  // 正则模式
  categoryHints?: string[];                        // 领域提示
}
```

**v2.2 `tool_invoke` 意图**：route=`tool`（新增 RouteTarget），路由到 ToolAgent（见 04 第 1.9 节），由 OrchestratorAgent 编排。关键词与 patterns 详见主计划 3.6.4 节，核心关键词包括"期间计算/期限/文书审核/校验/赔偿标准/赔偿金额/证照识别/营业执照/法条效力/现行有效/案由/量刑/判几年"，正则模式如 `计算.{0,4}期间`、`审核.{0,4}文书`。意图识别命中 `tool_invoke` 后，IntentRouter 返回的 `IntentResult` 须额外携带 `toolId` 提示（由关键词映射推断，如"期间计算"→`period_calculator`），供 OrchestratorAgent 编排时直接调用对应工具，无需二次推断。

打分：

```
score(intent) = Σ_{kw ∈ 命中} kw.weight * idf(kw) * positionBoost(kw)
              + Σ_{p ∈ 命中} p.weight * 1.5
              + contextBonus(intent)
```

- `idf(kw) = log(N / df(kw))`：N 为意图总数，df 为含该词的意图数；冷僻词权重更高。
- `positionBoost`：命中出现在句首前 20% 时 ×1.2。
- `contextBonus`：若 `ctx.lastIntent == intent` 且最近 3 轮内，+0.15（多轮延续）。
- 归一化：`confidence = score(intent) / (score(intent) + Σ score(other))`，再经 sigmoid 平滑。

### 1.3 阈值路由

```
if maxConfidence ≥ 0.8:
    route = topIntent.route              // 直路由
elif 0.5 ≤ maxConfidence < 0.8:
    candidates = top3 intents
    route = assistWithLlm(input, candidates)   // 轻量 LLM 判定
else:
    route = 'general_qa'                 // 兜底
```

### 1.4 Fallback 链

1. 关键词+正则打分；
2. 若无任何命中 → 询问式澄清（"您是想咨询法律条文、生成文书还是了解流程？"）；
3. 用户未响应澄清 → `general_qa` + LLM；
4. LLM 不可用 → `knowledge` Top-3 相关 + 引导专业律师。

### 1.5 伪代码

```typescript
async function classify(input: string, ctx: DialogContext): Promise<IntentResult> {
  const text = normalize(input);                    // 全角半角、去标点、分词
  const scores: Record<IntentType, number> = {} as any;

  for (const def of INTENT_DEFS) {
    let s = 0;
    for (const kw of def.keywords) {
      if (text.includes(kw.word)) {
        s += kw.weight * idf(kw.word) * positionBoost(text, kw.word);
      }
    }
    for (const p of def.patterns) {
      if (new RegExp(p.regex).test(text)) s += p.weight * 1.5;
    }
    if (ctx.lastIntent === def.intent && withinRecentTurns(ctx, 3, def.intent)) {
      s += 0.15;
    }
    scores[def.intent] = s;
  }

  const ranked = rank(scores);
  const confidence = softmaxNormalize(ranked);
  const top = ranked[0];

  let route: RouteTarget;
  let fallbackUsed = false;
  if (top.confidence >= 0.8) {
    route = top.intent.route;
  } else if (top.confidence >= 0.5) {
    const picked = await assistWithLlm(text, ranked.slice(0, 3).map(r => r.intent));
    route = INTENT_DEFS.find(d => d.intent === picked)!.route;
  } else if (top.confidence > 0) {
    route = 'general_qa';
  } else {
    fallbackUsed = true;
    route = 'general_qa';                            // 后续由 chat 服务降级
  }

  return {
    intent: top.intent, confidence: top.confidence, route, fallbackUsed,
    matchedKeywords: top.matchedKw, matchedPatterns: top.matchedPat,
  };
}
```

### 1.6 评测集与准确率度量（详见 10）

- 评测集存 `intent_eval_set`，目标 ≥ 200 条，覆盖 6 意图 × 3 难度。
- 指标：top-1 准确率、top-3 准确率、各意图 F1、fallback 率。
- 离线评测脚本 `scripts/eval/intent-eval.ts`，CI 跑批，准确率回归即拦截合并。
- 失败案例经人工标注回流 `intent_eval_set`（source=feedback），持续迭代关键词与权重。

### 1.7 TS 接口桩（见 06）

`IntentRouter.classify` / `IntentRouter.assistWithLlm`。

## 二、混合检索（RagService）

### 2.1 总体流程

```
query
  ├─ BM25 召回（law_article.keywords + case_precedent.keywords，top 30）
  ├─ 向量召回（query embedding 余弦，top 30）
  ├─ 规则兜底（intent → category 强约束过滤）
  ├─ RRF 融合 → top 20
  ├─ 重排（规则 + LLM rerank 可选）
  └─ 法条引用校验
```

### 2.2 BM25 召回

经典 BM25：

```
score(d, q) = Σ_{t∈q} idf(t) * ( f(t,d) * (k1+1) ) / ( f(t,d) + k1 * (1 - b + b * |d|/avgdl) )
```

- `k1 = 1.5, b = 0.75`。
- 索引字段：`law_article.keywords`、`case_precedent.keywords + title + causeOfAction`。
- 实现：MVP 用应用侧倒排（启动时从云库加载，内存维护），规模大后接 Elasticsearch 或云数据库全文检索。

### 2.3 向量召回

- Embedding 模型：通义千问 `text-embedding-v2`（768 维，中文强，境内合规）。
- 索引：MVP 应用侧余弦（`law_article.embedding` / `case_precedent.embedding` 字段）。预过滤：按 `category` 分桶 + 随机投影降维粗排，再精排 top 30。
- 规模 > 5 万条迁移专用向量库（待 P2 阶段评估）。

### 2.4 RRF 融合公式

```
RRF_score(d) = Σ_{r ∈ retrievers} 1 / (k + rank_r(d))     // k = 60
```

- 多路（BM25 法律、BM25 案例、向量法律、向量案例）统一排名后融合。
- 取融合后 top 20。

### 2.5 重排

- **规则重排**（默认）：法条优先于案例；有效法条（status=effective）加权 ×1.2；命中 `category` 强匹配 ×1.1。
- **LLM rerank**（可选，长查询时）：将 top 20 与 query 交 LLM 重排，返回 top 5；受 `feature_flag` 控制，灰度启用。

### 2.6 法条引用校验（LlmService.validateLawRefs）

LLM 输出文本后，扫描引用标记（如"民法典第143条""《民法典》第一百四十三条"）：

```typescript
const LAW_REF_PATTERN =
  /(?:《?(?<lawName>[\u4e00-\u9fa5]+法)》?\s*第\s*(?<articleNo>[\u4e00-\u9fa5零一二三四五六七八九十百千万0-9]+)\s*条)/g;

async function validateLawRefs(text: string): Promise<LawRefCheckResult> {
  const refs = extractRefs(text);                 // 命中所有法条引用
  const verified: LawRef[] = [];
  const unverified: LawRef[] = [];
  for (const r of refs) {
    const hit = await lawArticleRepo.findByLawAndNo(r.lawName, r.articleNo);
    if (hit && hit.status === 'effective') {
      verified.push({ ...r, verified: true, title: hit.title });
    } else {
      unverified.push({ ...r, verified: false });
    }
  }
  const sanitizedText = annotateUnverified(text, unverified);  // 标"⚠️ 未核实"
  return { verified, unverified, sanitizedText };
}
```

- 校验未通过的引用在 UI 标黄 + "⚠️ 该法条引用未在库中核实，请以官方来源为准"。
- 校验结果写入 `dialog_record.messages[].lawRefs` 与审计日志。

### 2.7 伪代码（retrieve）

```typescript
async function retrieve(query: string, intent: IntentType, opts: RagOpts = {}): Promise<RagResult> {
  const topK = opts.topK ?? 30;
  const cat = opts.category ?? intentToCategory(intent);

  const [bm25Law, bm25Prec, vecLaw, vecPrec] = await Promise.all([
    bm25Search('law_article', query, cat, topK),
    bm25Search('case_precedent', query, cat, topK),
    vectorSearch('law_article', query, cat, topK),
    vectorSearch('case_precedent', query, cat, topK),
  ]);

  const fused = rrfFuse([
    bm25Law.map(h => ({ id: h.articleId, type: 'law' as const, payload: h })),
    bm25Prec.map(h => ({ id: h.caseId, type: 'precedent' as const, payload: h })),
    vecLaw.map(h => ({ id: h.articleId, type: 'law' as const, payload: h })),
    vecPrec.map(h => ({ id: h.caseId, type: 'precedent' as const, payload: h })),
  ], 60).slice(0, 20);

  const reranked = ruleRerank(fused, {
    lawFirst: true, effectiveBoost: 1.2, categoryMatchBoost: 1.1,
  });

  return {
    lawArticles: reranked.filter(h => h.type === 'law'),
    precedents: reranked.filter(h => h.type === 'precedent'),
    fused, reranked,
  };
}
```

## 三、文书模板 DSL（DocumentGenerator）

### 3.1 模板语法

最小可用 DSL（与 `document_template.template` 字段对应）：

| 语法 | 含义 |
|------|------|
| `{{varName}}` | 变量替换 |
| `{{#if cond}}...{{/if}}` | 条件块，cond 形如 `varName` 或 `varName == "值"` |
| `{{#each items}}...{{/each}}` | 循环块，内部用 `{{this.field}}` |
| `{{today}}` / `{{now}}` | 内置变量：今日日期 / 当前时间 |
| `{{varName \| mask:idcard}}` | 过滤器：脱敏（idcard/phone/bank） |
| `{{varName \| upper}}` | 过滤器：大写 |

### 3.2 变量校验

按 `document_template.varsSchema` 校验：
- `required` 必填；
- `type` 校验（string/number/date/text/array）；
- `piiLevel` 决定存储与展示脱敏策略；
- 校验失败返回 `3001` + `errors: [{key, message}]`。

### 3.3 填充算法伪代码

```typescript
function render(template: string, vars: Record<string, unknown>): string {
  let out = template;
  // 1. 循环块
  out = out.replace(/\{\{#each (\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, key, body) => {
    const arr = vars[key] as unknown[];
    return (arr || []).map(item => render(body, item as Record<string, unknown>)).join('');
  });
  // 2. 条件块
  out = out.replace(/\{\{#if (.+?)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, cond, body) =>
    evalCond(cond, vars) ? body : '');
  // 3. 变量与过滤器
  out = out.replace(/\{\{([^}]+)\}\}/g, (_, expr) => evalExpr(expr.trim(), vars));
  // 4. 内置变量
  out = out.replace('{{today}}', formatDate(new Date()));
  return out;
}
```

### 3.4 模板示例（民事起诉状·离婚）

```
民事起诉状

原告：{{plaintiffName}}，性别：{{plaintiffGender}}，身份证号：{{plaintiffIdNo | mask:idcard}}
被告：{{defendantName}}，性别：{{defendantGender}}，身份证号：{{defendantIdNo | mask:idcard}}

诉讼请求：
{{#each claims}}
{{this}}
{{/each}}

事实与理由：
{{facts}}

此致
{{courtName}}

起诉人：{{plaintiffName}}
{{today}}
```

### 3.5 导出

- docx：云函数用 `docxtemplator`（或 `officegen`）按渲染后文本生成，存云存储，回链 `fileId`。
- pdf：用 `pdf-lib` 生成，中文字体需内嵌（避免乱码）。
- 文书文尾强制追加免责声明（不可由模板覆盖）。

## 四、案件节点提醒调度（NotificationService + Scheduler）

### 4.1 节点识别

`CaseTracker.computeDeadlines(case)` 基于 `legal_knowledge.structured.timeline` + 用户 `case_record.nextDeadlines`：

```typescript
function computeDeadlines(c: CaseRecord): TimelineNode[] {
  const base = KNOWLEDGE_TIMELINE[c.causeOfAction] || [];
  const merged = [...base, ...(c.nextDeadlines || [])];
  return merged.filter(n => n.remindable).sort((a, b) => +new Date(a.date) - +new Date(b.date));
}
```

### 4.2 提前预警计算

提醒日 = `节点日期 - 提前天数`（默认 3 天，可按节点类型配置：举证期限 7 天、开庭 3 天）。

```typescript
function shouldRemind(node: TimelineNode, today = new Date()): boolean {
  const remindDays = REMIND_POLICY[node.node] ?? 3;
  const remindDate = addDays(new Date(node.date), -remindDays);
  return isSameDay(today, remindDate) && !node.remindedDays.includes(remindDays);
}
```

### 4.3 调度算法（定时触发器，每日 09:00）

```typescript
// cloud/functions/notificationScheduler/index.ts （每日触发）
async function run(today = new Date()): Promise<void> {
  const cases = await caseRepo.findActiveWithDeadlinesNear(today, 7);
  for (const c of cases) {
    for (const node of computeDeadlines(c)) {
      if (!shouldRemind(node, today)) continue;
      const sub = await subRepo.findOne({ userId: c.userId, templateId: 'case_deadline_remind', scope: c.caseId });
      const payload = buildPayload(c, node);
      if (sub && sub.authCount > 0) {
        const r = await notificationService.send(payload);
        if (r.ok) {
          await subRepo.decrementAuth(sub._id);
          await caseRepo.markReminded(c.caseId, node, REMIND_POLICY[node.node] ?? 3);
        } else {
          await notificationService.downgradeToInApp(c.userId, payload);   // 降级页面内
        }
      } else {
        await notificationService.downgradeToInApp(c.userId, payload);     // 授权耗尽降级
      }
    }
  }
}
```

### 4.4 降级策略

- 一次性订阅模板次数耗尽 → 写入 `notification_subscription` 状态 + 在 `/pages/mine` 与 `/pages/case-detail` 顶部展示"待提醒"卡片。
- 微信订阅消息下发失败 → 重试 1 次（间隔 5 分钟），仍失败则降级页面内 + 记录 `audit_log(degradation)`。

## 五、Prompt 工程规范

### 5.1 通用结构

```
[系统提示] 你是法律智能助手，提供法律信息参考，不构成法律意见。
[法律领域] {{category}}
[注入上下文] 法条：{{lawArticles}}  案例：{{precedents}}
[用户记忆] 关注领域：{{prefs}}  案件：{{caseSummary}}
[当前问题] {{userMessage}}
[输出要求]
  - 引用法条须用"《法律名》第X条"格式
  - 不得编造法条
  - 末尾自动附加免责声明（系统也会再附加一次）
  - 涉刑事案件风险高时输出 riskLevel: high
```

### 5.2 版本管理

- Prompt 模板版本号写入 `llm_cache.promptVersion` 与审计日志。
- 新版本灰度（`feature_flag: prompt_v2`），对比 CTR 与满意度后全量。

### 5.3 PII 保护

- 注入 LLM 前，案情中身份证号、银行卡号、手机号必须经 `PiiService.detectAndMask` 脱敏。
- LLM 不得用于直接处理 L4 字段原文。

## 六、与 v1.0/v2.0/v2.1/v2.2/v2.3 的差异声明

- **v1.0 → v2.0**：v1.0 仅描述"关键词加权 + 正则 + 置信度评分"思路；v2.0 给出打分公式（含 idf/位置/上下文加权）、阈值路由、Fallback 链、评测体系，并新增混合检索（BM25+向量+RRF+重排+法条引用校验）、文书模板 DSL、案件节点调度算法、Prompt 工程规范，覆盖 G7/G8/G18/G19/G20 全部 P0/P1 算法缺口。
- **v2.0 → v2.1**：算法层无新增（v2.1 聚焦 Agent 编排与对外协议，复用 v2.0 算法）。
- **v2.1 → v2.2**：意图枚举追加 `tool_invoke`（6 → 7 个），RouteTarget 追加 `tool`；新增第七节"工具算法"，覆盖期间计算/赔偿计算/量刑基准刑/案由分类/法条效力查询 5 类工具算法，引用 14 各工具节。算法层不引入新基础设施，复用 v2.0 RuleEngine/KnowledgeBase/LlmService。
- **v2.2 → v2.3**：意图枚举追加 `case_reasoning`（7 → 8 个），RouteTarget 追加 `reasoning`；新增第八节"NLU 增强"（实体抽取/多轮主动澄清/复合意图拆分 3 算法，包装为 nlu Agent）；新增第九节"法律推理算法（v2.3）"引用 16 为 IRAC 推理框架权威源。集合层新增 entity_extraction/clarification_session/reasoning_chain（见 05）。算法层复用 v2.0/v2.2 基础设施，新增 EntityExtractor/ClarificationManager/CompoundIntentSplitter/IracReasoner/FactSimilarityService/CaseComparator/LawApplicationDeterminer 模块（见 04）。

## 七、工具算法（v2.2）

> 本节给出 LegalTool 的核心算法伪代码与复杂度，详细 schema/数据依赖/评测见 14 各工具节。本节为算法 I/O 权威源，14 为工具实现权威源。v2.2 工具 7 个（7.1-7.7）；v2.3 第 8 工具 ClauseRecommender（条款推荐，BM25 召回 + LLM rerank top 5）算法见 14 第十一节，本节不重复。

### 7.1 期间计算算法（PeriodCalculator，引用 14 第五节）

```
输入: startDate (Date), periodType ('statutory'|'designated'), duration (number), unit ('day'|'month'|'year'), deductHolidays (bool), jurisdiction (string)
输出: deadline (Date), actualDays (number), holidayDeductions (Array), calculationTrace (string)

1. deadline = addUnit(startDate, duration, unit)   // 按日/月/年加
2. if periodType == 'statutory' && deductHolidays:
2.1   loop:
2.2     holidays = scanHolidays(startDate+1, deadline, jurisdiction)   // 查 holidays.ts
2.3     if holidays.empty: break
2.4     deadline = addDays(deadline, holidays.length)   // 顺延
2.5     holidayDeductions.push(...holidays)
3. if isHolidayOrWeekend(deadline): deadline = nextWorkday(deadline)   // 届满日顺延（民事诉讼法第九十二条第四款）
4. actualDays = countWorkdays(startDate+1, deadline)
5. calculationTrace = `起算日 ${startDate} + ${duration} ${unit} - ${holidayDeductions.length} 节假日 = 截止日 ${deadline}`
6. lawRefs = [{ ref: '民事诉讼法第九十二条', verified: true }]
```

**复杂度**：O(deadline - startDate)，最坏 O(3650)。
**边界条件**：闰年 2 月 29 日（unit=year 时保留日）、月末顺延（unit=month）、调休上班日（周六补班算工作日）、跨年节假日。
**降级**：holidays.ts 缺失该区间数据时仅扣周末，warnings 提示。

### 7.2 赔偿计算算法（CompensationQuery，引用 14 第八节）

```
输入: causeOfAction, region, disabilityLevel?, income?, dependents?, medicalFee?
输出: items (Array<{name, formula, amount, basis}>), totalAmount, calculationTrace

1. standard = loadCompensationStandard(region, currentYear)   // legal_knowledge
2. items = []
3. if disabilityLevel:
3.1   coefficient = (11 - disabilityLevel) / 10
3.2   disabilityCompensation = standard.urbanPerCapitaIncome × 20 × coefficient
3.3   items.push({name: '残疾赔偿金', formula: `${standard.urbanPerCapitaIncome} × 20 × ${coefficient}`, amount: disabilityCompensation, basis: standard.source})
4. if income:
4.1   dailyWage = (income.monthlySalary × 12 + income.annualBonus) / 365
4.2   lostWages = dailyWage × 90   // 默认 90 天
4.3   items.push({name: '误工费', ...})
5. nursingFee = standard.nursingDailyRate × 30
6. if dependents > 0:
6.1   dependentsFee = standard.urbanPerCapitaConsumption × 20 × coefficient / dependents
6.2   items.push({name: '被扶养人生活费', ...})
7. if disabilityLevel:
7.1   mentalDamage = MENTAL_DAMAGE_TABLE[disabilityLevel] × standard.mentalDamageMultiplier
7.2   items.push({name: '精神损害抚慰金', ...})
8. if medicalFee: items.push({name: '医疗费', amount: medicalFee, ...})
9. totalAmount = sum(items.amount)
10. lawRefs = [{ref: '民法典第一千一百七十九条', verified: true}]
```

**复杂度**：O(1)（查表 + 算术运算）。
**边界条件**：农村户口 vs 城镇户口（standard 字段切换）、60 岁以上减年、75 岁以上按 5 年。
**降级**：region 数据缺失时用全国均值，warnings 提示。

### 7.3 量刑基准刑算法（SentencingGuide，引用 14 第十节）

```
输入: charge, elements {amount?, times?, consequence?, priorConviction?, surrender?, merit?}
输出: sentencingRange {min, max, unit}, baseSentence, adjustments, calculationTrace

1. guide = loadSentencingGuide(charge)   // legal_knowledge
2. if guide == null: return warnings + sentencingRange from law_article (法定刑)
3. validateElements(charge, elements)   // 缺失必填返回 8007
4. tier = locateTier(guide.tiers, elements)   // 按 amount/times/consequence 定位档次
5. sentencingRange = {min: tier.minMonth, max: tier.maxMonth, unit: 'month'}
6. baseSentence = (tier.minMonth + tier.maxMonth) / 2
7. adjustments = []
8. if elements.priorConviction: adjustments.push({type:'aggravating', factor:'prior_conviction', percentage: randInt(10,20)})
9. if elements.surrender: adjustments.push({type:'mitigating', factor:'surrender', percentage: -randInt(20,30)})
10. if elements.merit: adjustments.push({type:'mitigating', factor:'merit', percentage: -randInt(10,20)})
11. finalSentence = baseSentence × (1 + sum(adjustments.percentage) / 100)
12. finalSentence = clamp(finalSentence, sentencingRange.min, sentencingRange.max)
13. calculationTrace = `档次 ${tier.name} → 基准刑 ${baseSentence} 月 → 调节 ${adjustments} → clamp → ${finalSentence} 月`
```

**复杂度**：O(1)。
**边界条件**：数额在档次分界线（含等号约定）、多重情节叠加超 max（clamp）、罕见罪名无 guide 数据（降级仅返回法定刑）。
**必填校验**：财产犯罪须 amount，多次犯罪须 times，侵害人身须 consequence，缺失返回 8007。

### 7.4 案由分类算法（CauseClassifier，引用 14 第九节）

```
输入: caseDescription (string, ≤ 2000 字)
输出: topCandidates (Array<{causeCode, causeName, category, applicableProcedure, confidence}>, ≤3), reasoning

1. masked = PiiService.detectAndMask(caseDescription)   // L2 脱敏
2. tokens = tokenize(masked) + synonymExpand(tokens)   // 同义扩展
3. candidates = bm25Search(legal_knowledge.cause_classification, tokens, topK=10)
4. if candidates[0].score_normalized >= 0.7:
4.1   topCandidates = candidates.slice(0, 3).map(toOutput)
4.2   reasoning = '基于关键词匹配'
5. else:
5.1   llmResult = LlmService.assistClassification(masked, candidates)   // LLM 辅助
5.2   merged = candidates.map(c => ({...c, finalConfidence: 0.4 × c.score + 0.6 × (llmResult[c.causeCode] || 0)}))
5.3   merged.sort(by finalConfidence desc)
5.4   topCandidates = merged.slice(0, 3).map(toOutput)
5.5   reasoning = llmResult.reasoning
6. if topCandidates[0].confidence < 0.5: throw LegalToolError(8006)   // 置信度过低
7. lawRefs = topCandidates.flatMap(c => c.lawRefs)
```

**复杂度**：BM25 检索 O(N×M)（N=案由库大小，M=token 数），LLM 辅助 O(1)（单次调用）。
**边界条件**：多案由竞合（返回 Top-3 含多个类别）、极短描述（< 20 字 token 稀疏）、新型纠纷（无命中 → 8006）。
**降级**：LLM 不可用时仅用 BM25 结果，warnings 提示。

### 7.5 法条效力查询算法（LawValidityQuery，引用 14 第四节）

```
输入: lawName?, articleNo?, articleRef?   // lawName+articleNo 或 articleRef 二选一
输出: found (bool), status, effectiveDate, promulgatingBody, legalHierarchy, amendedBy, amends

1. if articleRef: parse(lawName, articleNo) from articleRef   // 如"民法典第一百四十三条"
2. article = law_article.findOne({lawName, articleNo})   // 精确查
3. if article == null:
3.1   if legalHierarchy query: article = law_article.findOne({$text: {search: articleRef}})   // 全文兜底
3.2   if still null: return {found: false}   // 8005
4. output = {
4.1   found: true,
4.2   status: article.status,   // effective|repealed|amended
4.3   effectiveDate: article.effectiveDate,
4.4   promulgatingBody: article.promulgatingBody,
4.5   legalHierarchy: article.legalHierarchy,   // constitution|law|...|departmental_rule
4.6   amendedBy: article.amendedBy,   // 修订历史数组
4.7   amends: article.amends   // 被该法条修改的引用
4.8   statusBadge: computeBadge(article.status, article.legalHierarchy)
5. lawRefs = [{ref: `${lawName}${articleNo}`, verified: true, title: article.title}]
```

**复杂度**：O(1)（索引精确查）+ O(N)（全文兜底，N=law_article 集合大小）。
**边界条件**：法条已废止（status=repealed，statusBadge 标红）、法条被修订（amendedBy 非空，显示修订链）、法律位阶冲突（legalHierarchy 用于冲突提示）。
**法律位阶枚举**（权威源，跨 05/14/15 一致）：`constitution > law > administrative_regulation > local_regulation > judicial_interpretation > departmental_rule`。

## 八、NLU 增强（v2.3）

> 本节给出实体抽取、多轮主动澄清、复合意图拆分 3 个 NLU 增强算法，包装为 nlu Agent（见 11 第 10 个 Agent）。本节为 NLU 算法 I/O 权威源，04 为模块实现权威源，05（3.24/3.25）为集合 schema 权威源。

### 8.1 实体抽取算法（EntityExtractor）

四层架构，逐层补充，结果合并去重。

```
输入: text (string), ctx (DialogContext，含历史实体)
输出: entities (Array<{type, value, span:[start,end], confidence, source}>)

1. entities = []
2. // L1 正则层
2.1 for pattern in REGEX_PATTERNS:   // 身份证号/手机号/金额/日期/法条引用（复用 2.6 节 LAW_REF_PATTERN）
2.2   matches = text.matchAll(pattern.regex)
2.3   for m in matches: entities.push({type: pattern.type, value: m[0], span: [m.index, m.index+m[0].length], confidence: 0.95, source: 'regex'})
3. // L2 词典层
3.1 for term in LEGAL_TERM_DICT:   // legal_term 集合 + 当事人角色词典（原告/被告/第三人）
3.2   if text.includes(term): entities.push({type: 'legal_term', value: term, confidence: 0.85, source: 'dict'})
4. // L3 LLM NER 层
4.1 maskedText = PiiService.detectAndMask(text)   // L4 脱敏后送 LLM
4.2 llmResult = LlmService.ner(maskedText, NER_PROMPT)   // 抽取 person/org/contract/case_cause/evidence
4.3 for e in llmResult.entities: entities.push({...e, confidence: e.confidence * 0.8, source: 'llm'})
5. // L4 上下文消解
5.1 for e in entities where e.type == 'person' && isPronoun(e.value):
5.2   antecedent = ctx.lastTurnEntities.find(e2 => e2.type == 'person')   // 跨轮指代消解
5.3   if antecedent: e.value = antecedent.value; e.source = 'coref'; e.confidence *= 0.9
6. // 合并去重（同 type+value 取 confidence 最高）
7. entities = dedup(entities)
8. persist to entity_extraction 集合（见 05 3.24）
```

**复杂度**：正则+词典 O(N×M)（N=词典大小，M=文本长度），LLM O(1)（单次调用）。
**边界条件**：嵌套实体（身份证号内含日期，取最长匹配）、多义术语（"合同"既指文书又指法律行为，按上下文 disambiguate）、LLM 抽取越界（span 超出文本长度时裁剪）。
**降级**：LLM NER 不可用时仅用 L1+L2 结果，warnings 提示 + 错误码 `8010`。

### 8.2 多轮主动澄清算法（ClarificationManager）

```
输入: intent (IntentType), extractedEntities (Array), ctx (DialogContext)
输出: clarification (ClarificationCard | null), sessionId (string)

1. requiredSlots = INTENT_DEFS[intent].requiredSlots   // 每意图必填槽位
2. filledSlots = mapEntitiesToSlots(extractedEntities)   // 实体 → 槽位填充
3. missingSlots = requiredSlots - filledSlots.keys
4. if missingSlots.empty: return {clarification: null}   // 无需澄清

5. // 会话状态机
5.1 session = clarification_session.findOne({userId: ctx.userId, state: 'asking'})   // 见 05 3.25
5.2 if session == null:
5.2.1   session = createSession({userId, msgId: ctx.msgId, intent, requiredSlots, filledSlots, state: 'asking', turns: 0})
5.3 session.turns += 1
5.4 if session.turns > 3:
5.4.1   session.state = 'timeout'; throw LegalToolError(8011)   // 澄清会话超时
5.5 if session.offTopicCount >= 2:   // 用户答非所问 2 次
5.5.1   session.state = 'give_up'; return {clarification: null, fallback: 'general_qa'}

6. // 追问生成
6.1 slot = missingSlots[0]   // 优先澄清第一个缺失槽
6.2 template = INTENT_DEFS[intent].clarificationTemplates[slot]
6.3 options = generateOptions(slot, ctx)   // LLM 生成选项卡 + 词典候选
6.4 clarification = {question: template.question, options, allowFreeText: true}

7. session.updatedAt = now; save(session)
8. return {clarification, sessionId: session._id}
```

**状态机**（权威源，跨 04/05/09 一致）：`asking → answered（必填补齐）| timeout（3 轮上限）| give_up（答非所问 2 次）`。
**选项卡格式**：`{ question: string, options: [{label, value, fill}], allowFreeText: boolean }`。
**降级**：LLM 生成选项失败时仅返回自由文本输入框。

### 8.3 复合意图拆分算法（CompoundIntentSplitter）

```
输入: text (string), ctx (DialogContext)
输出: subIntents (Array<{subIntent, subText, dependsOn?, entities}>)

1. // 连词检测 + 标点切分
1.1 CONJUNCTIONS = ['并且', '而且', '同时', '另外', '还', '以及', '此外']
1.2 DELIMITERS = ['；', '。', '！', '？']
1.3 clauses = splitByTextAndPunct(text, CONJUNCTIONS, DELIMITERS)
1.4 if clauses.length <= 1: return []   // 非复合意图

2. // 子句独立意图识别
2.1 subIntents = []
2.2 for clause in clauses:
2.2.1   result = IntentRouter.classify(clause, ctx)   // 复用 1.5 节伪代码
2.2.2   entities = EntityExtractor.extract(clause, ctx)   // 复用 8.1 节
2.2.3   subIntents.push({subIntent: result.intent, subText: clause, entities})

3. // 依赖图构建
3.1 for i in 1..subIntents.length:
3.2   for j in 0..i-1:
3.3     if subIntents[i].entities contains pronoun referencing subIntents[j].entities:
3.3.1       subIntents[i].dependsOn = j   // 子句 i 依赖子句 j 的实体
3.4     if subIntents[i].subIntent == 'case_reasoning' && subIntents[j].subIntent in ['legal_qa', 'tool_invoke']:
3.4.1       subIntents[i].dependsOn = j   // 推理依赖前置查询结果

4. // 拓扑排序
4.1 order = topologicalSort(subIntents, dependsOn)
5. return order
```

**编排**：按拓扑序执行，子意图 A 的结果作为子意图 B 的上下文（ctx.subIntentResults[A]）。
**边界条件**：环形依赖（打破环 + warnings）、单子句被误拆（连词为非连词用法时合并回单意图）、子意图均为 general_qa（降级为单意图 general_qa）。
**降级**：拆分失败时回退为单意图 IntentRouter.classify(text)。

## 九、法律推理算法（v2.3）

> 本节为 `case_reasoning` 意图（1.1 节第 8 个意图，route=`reasoning`）的算法索引，**16-legal-reasoning.md 为 IRAC 推理框架、案情相似度、法条适用判定、案例对比的权威源**，本节仅做要点摘要与跨文档引用，不重复展开算法细节。模块实现见 04（IracReasoner/FactSimilarityService/CaseComparator/LawApplicationDeterminer），集合 schema 见 05（reasoning_chain 3.28），Agent 编排见 11（reasoning Agent，第 11 个 Agent）。

### 9.1 IRAC 推理框架

`case_reasoning` 意图命中后，由 reasoning Agent 编排 `IracReasoner` 执行四步结构化推理，约束 LLM 输出避免自由发挥：

- **Issue（争议点识别）**：输入用户问题 + 实体抽取结果（来自 nlu Agent，见 8.1）；LLM prompt + 法律争议点模板库（按案由分类）；输出 `issues[] = { issueText, issueType, relatedLaws[] }`。
- **Rule（法条规则抽取）**：RagService 召回 + `law_citation_graph`（05 3.26）扩展相关法条 + 时效校验（15 第十三节 LawTimelinessScanner）+ `parseArticle` 解析；输出每 issue 关联法条构成要件。
- **Application（事实映射）**：调用 `LawApplicationDeterminer`（见 9.3）将用户事实映射到法条构成要件，判定 applicable/partial/false。
- **Conclusion（综合结论）**：LLM 基于 Issue+Rule+Application 综合结论 + 置信度（参考表：三步全 applicable→高 / 存在 partial→中 / 存在 false→低）。

**权威源**：16 第二节。**降级**：LLM 不可用时仅规则匹配，warnings 提示。

### 9.2 案情事实相似度算法（FactSimilarityService）

加权混合相似度，用于案例检索重排与案例对比。

```
similarity = 0.6 × cosine(factEmbedding(query), factEmbedding(case))
           + 0.4 × jaccard(factAttributes(query), factAttributes(case))
```

- `factEmbedding`：案情文本向量（text-embedding-v2）
- `factAttributes`：结构化事实属性集合（案由/当事人角色/争议类型/标的额区间）
- 阈值：≥0.75 高度相似 / 0.5-0.75 部分相似 / <0.5 不相似

**权威源**：16 第三节（含 4 边界条件与降级策略）。

### 9.3 法条适用判定算法（LawApplicationDeterminer）

将用户事实映射到法条构成要件，给出可判定结论而非模糊陈述。

```
输入: article (law_article), facts (用户事实实体)
输出: { result: 'applicable'|'partial'|'false', matchedElements[], missingElements[] }

1. elements = extractElements(article)   // 构成要件抽取（LLM + 法条结构化字段）
2. if elements == null: throw LegalToolError(8019)   // 要件不足，无法判定
3. matched = []; missing = []
4. for e in elements:
4.1   if matchCondition(e, facts): matched.push(e)   // 逐要件事实匹配
4.2   else: missing.push(e)
5. result = missing.empty ? 'applicable' : (missing.length < elements.length ? 'partial' : 'false')
```

**错误码**：`8019`（法条适用判定要件不足，引用 06）。**权威源**：16 第四节（含 4 边界条件）。

### 9.4 案例对比（CaseComparator）

基于 9.2 相似度算法计算两案例相似度 + 差异点抽取（事实维度对比 + 法条引用差异 + 判决结果差异），供 UI 展示（09 CaseComparisonView）。

**权威源**：16 第五节。

### 9.5 推理链持久化与编排

- **持久化**：每次 `case_reasoning` 推理生成 `reasoning_chain` 记录（集合见 05 3.28），字段含 `msgId / userId / issues / rules / applications / conclusion / citedLaws / citedCases / confidence / promptVersion / modelVersion`；索引 `idx_msgId` / `idx_userId_createdAt`；TTL 180 天。用途：律师审核溯源（17 第四节 AnswerTracer）+ 推理评测（10 reasoning_eval_set）+ 推理链纠错回流（17 第六节）。
- **Agent 编排**：reasoning Agent（11 第 11 个 Agent）持有 `case.reason` / `case.compare` / `law.apply_check` 3 个 capability，由 OrchestratorAgent 在 `case_reasoning` 意图命中后编排；推理结果经 `complianceMonitor.scan`（03 12.7）合规校验后返回前端。
