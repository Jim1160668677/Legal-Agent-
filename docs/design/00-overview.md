# 00 · 文档总览与导航

> 法律智能体（Legal Agent）详细设计文档集 · v2.3
> 日期：2026-07-22 ｜ 状态：设计扩展（v2.3 AI 律师系统：NLU/推理/文书增强/律师审核评估/安全合规增强；v2.2 7 法律工具 + 知识采集管道 + 双模式 UI；v2.1 多 agent 协作后端能力扩展） ｜ 上游：`docs/superpowers/specs/2026-07-19-legal-agent-design.md`（v1.0 架构级方案）

---

## 一、本集定位

本文档集是对 v1.0 架构级设计方案的**完善与详细设计扩展**，面向开发、测试、运维、合规与产品团队，提供可直接据以实施、编码、验收的工程级设计依据。

v1.0 解决了"做什么、为什么、整体怎么分"的问题；本集解决"具体怎么做、字段是什么、接口长什么样、算法怎么打分、流程怎么走、UI 怎么画、合规怎么落、怎么测、怎么上"的问题。

本集不重复 v1.0 已明确的内容，仅在必要处引用并扩展。涉及与 v1.0 一致的技术选型（Taro 4.x + React 18 + TS、微信云开发、通义千问）不再重述。

## 二、文档地图

| 编号 | 文件 | 主题 | 主要读者 |
|------|------|------|----------|
| 00 | [00-overview.md](./00-overview.md) | 总览与导航（本文） | 全员 |
| 01 | [01-gap-analysis.md](./01-gap-analysis.md) | v1.0 缺口分析与可行性评估 | 架构、产品、合规 |
| 02 | [02-architecture.md](./02-architecture.md) | 总体架构补充（分层、部署、降级、可观测、成本） | 架构、后端、运维 |
| 03 | [03-security-compliance.md](./03-security-compliance.md) | 安全与合规设计（数据分级、加密、PII、审计、免责） | 合规、后端、安全 |
| 04 | [04-module-design.md](./04-module-design.md) | 系统模块划分与依赖、目录结构 | 全员开发 |
| 05 | [05-data-model.md](./05-data-model.md) | 数据模型（集合 schema、索引、ER、Storage 键） | 后端、数据 |
| 06 | [06-api-spec.md](./06-api-spec.md) | 接口定义（云函数 API、Service 接口桩、错误码） | 前后端、联调 |
| 07 | [07-core-algorithms.md](./07-core-algorithms.md) | 核心算法（意图识别、混合检索、模板 DSL、调度） | 算法、后端 |
| 08 | [08-business-flows.md](./08-business-flows.md) | 核心业务流程（Mermaid 流程/时序/状态机） | 产品、前后端 |
| 09 | [09-ui-prototype.md](./09-ui-prototype.md) | UI 原型（ASCII 线框、组件、设计 token） | 前端、设计 |
| 10 | [10-test-and-roadmap.md](./10-test-and-roadmap.md) | 测试策略与实施路线图 | 测试、项目 |
| 11 | [11-multi-agent-architecture.md](./11-multi-agent-architecture.md) | 多 Agent 协作架构（Orchestrator-Worker、Agent 接口、Agent Card） | 架构、后端 |
| 12 | [12-mcp-and-open-api.md](./12-mcp-and-open-api.md) | MCP Server 与 OpenAPI 暴露规约 | 后端、集成 |
| 13 | [13-agent-governance.md](./13-agent-governance.md) | Agent 安全与治理（凭证/分层授权/限流/审计/PII 边界） | 合规、后端、安全 |
| 14 | [14-tool-design.md](./14-tool-design.md) | 法律工具设计（7 LegalTool 接口/schema/算法/评测权威源） | 前后端、算法 |
| 15 | [15-knowledge-pipeline.md](./15-knowledge-pipeline.md) | 知识采集与同步管道（三阶段架构/6 子模块/5 新集合/反爬/调度权威源） | 后端、数据、运维 |
| 16 | [16-legal-reasoning.md](./16-legal-reasoning.md) | 法律推理架构（IRAC 框架/案情相似度/法条适用判定/案例对比/推理链持久化权威源） | 算法、后端 |
| 17 | [17-lawyer-review-eval.md](./17-lawyer-review-eval.md) | 律师审核与评估闭环（审核工作流/质量评分/回答溯源/合规监控/标注回流权威源） | 合规、后端、算法 |

## 三、推荐阅读顺序

- **新人快速入门**：00 → 04 → 08 → 09
- **后端工程师**：00 → 02 → 04 → 05 → 06 → 07
- **前端工程师**：00 → 04 → 06 → 08 → 09
- **算法工程师**：00 → 04 → 07 → 05（`intent_eval_set` / `llm_cache`）
- **合规/安全**：00 → 03 → 02（可观测与降级）→ 05（审计与留存）
- **产品/项目**：00 → 01 → 08 → 10
- **集成/外部接入方**：00 → 11 → 12 → 13 → 06
- **工具开发/算法**：00 → 04 → 05 → 06 → 14 → 07（7.5 工具算法）→ 16 → 17
- **数据采集/运维**：00 → 02 → 05 → 15 → 06 → 03（采集合规）
- **推理/审核评估**：00 → 04 → 07 → 16 → 17 → 10（2.7-2.8 评测）

## 四、版本与变更约定

- 本集版本：**v2.3**（2026-07-22 在 v2.2 基础上扩展 AI 律师系统：NLU/推理/文书增强/律师审核评估/安全合规增强），与 v1.0 spec 并存；v1.0 仍为产品级审批基线，本集为工程级设计扩展。
- 变更原则：每篇文档头部维护 `版本 | 日期 | 状态 | 变更摘要`。涉及跨文档影响（如 `05` 改字段名）的变更必须在对应篇标注"影响：06/07/08"。
- 术语统一：模块名、集合名、接口名、意图枚举值在各篇严格一致（见下"术语表"）。如出现冲突，以 `04`（模块）、`05`（数据）、`06`（接口）、`07`（意图枚举）为权威源；v2.1 起新增权威源：agent 架构以 11、对外协议以 12、agent 治理以 13 为准；v2.2 起新增权威源：法律工具以 14、知识采集管道以 15 为准；v2.3 起新增权威源：法律推理以 16、律师审核评估以 17 为准。

## 五、术语表

| 术语 | 含义 |
|------|------|
| 三层混合架构 | 规则引擎 → 法律知识库 → LLM 的分级处理流水线（来自 v1.0） |
| 意图（Intent） | 用户输入的法律问题类别，枚举见 `07` |
| 规则引擎 | 本地法条/FAQ 精确匹配，无 LLM 调用 |
| 知识库 | 结构化法律知识（流程、材料清单、模板、案例） |
| RAG | 检索增强生成，本集采用 BM25 + 向量 + 规则的混合检索 |
| RRF | Reciprocal Rank Fusion，多路召回结果融合排序 |
| 法条引用校验 | LLM 输出中引用的法条号需在 `law_article` 集合命中校验 |
| 案件节点 | 案件流程中的关键时间点（举证期限、开庭日等），用于主动提醒 |
| PII | 个人身份信息（Personally Identifiable Information） |
| 免责声明 | 强制附加的"仅供参考，不构成法律意见"提示 |
| 云函数 | 微信云开发的 Serverless 函数，本集 API 部署形态 |
| 云数据库 | 微信云开发提供的 NoSQL 文档数据库（类 MongoDB） |
| Service 层 | 前端/云函数内复用的领域服务模块，位于 `services/legal/` |
| Agent | 统一 `LegalAgent` 接口的专业能力单元，包装现有领域模块（见 11） |
| Agent Card | Agent 的元数据声明（agentId/capabilities/inputSchema/outputSchema/piiLevel/exposure/version），见 11 |
| Orchestrator-Worker | 主 OrchestratorAgent 按意图编排专业子 Agent 的协作模式，见 11 |
| MCP | Model Context Protocol，面向 AI agent 的标准化暴露协议（HTTP+SSE），见 12 |
| AgentDispatcher | 网关层统一入口云函数，承接 mcpServer/openApiGateway 请求并转发至 AgentRegistry，见 12/04 |
| L-Read / L-Write-Limited / L-Internal | 分层受控暴露的三层级（只读全暴露 / 受限写需额外授权 / 仅内部），见 13 |
| capability | Agent 声明的能力枚举（如 `law.lookup`、`document.generate`），权威源见 11 |
| external_agent_credential | 外部 agent 凭证与授权集合，记录 apiKey 哈希、scope、配额、状态，见 05/13 |
| ToolAgent（v2.2） | 包装 ToolRegistry 的专业 Agent，在 tool_invoke 意图下由 OrchestratorAgent 调度，详见 11/14 |
| ToolRegistry（v2.2） | 工具注册与发现中心，管理 7 个 LegalTool 的元数据与生命周期，详见 14 |
| LegalTool（v2.2） | 统一接口的法律工具单元（toolId/inputSchema/outputSchema/piiLevel/async/timeout/cacheable/cacheTtl/invoke），共 7 个，详见 14 |
| ToolContext（v2.2） | 工具调用上下文（userId/traceId/intent/caseId?/permissions/cache/audit），由 invokeTool/chat 云函数构造并传入 Tool.invoke，详见 14 |
| ToolResult（v2.2） | 工具统一返回结构（toolId/output/disclaimer/lawRefs?/warnings?/traceId/degraded?/fromCache?），disclaimer 为必填，详见 14 |
| KnowledgePipeline（v2.2） | 知识采集三阶段架构云函数（UrlCollector → DetailExtractor → StorageClassifier），含 6 子模块，详见 15 |
| UrlCollector（v2.2） | 阶段一子模块，5 数据源 URL 发现 + 入队 + URL 级去重，详见 15 第 6.1 节 |
| DetailExtractor（v2.2） | 阶段二子模块，HTML 解析 + 字段抽取 + contentHash 计算 + 内容级去重，详见 15 第 6.2 节 |
| contentHash（v2.2） | 法律材料内容去重哈希 = sha256(normalize(content) + sourceUrl)，详见 15 第八节 |
| legalHierarchy（v2.2） | 法律位阶枚举（constitution > law > administrative_regulation > local_regulation > judicial_interpretation > departmental_rule），详见 03 第 12.1 节，LawValidityQuery 输出字段权威源 |
| IRAC（v2.3） | Issue/Rule/Application/Conclusion 法律推理四步框架，争议点识别→法条规则抽取→事实映射→综合结论，详见 16 |
| EntityExtractor（v2.3） | NLU 实体抽取模块，四层架构（正则→词典→LLM NER→上下文消解），详见 07 第八节 / 11 nlu Agent |
| ClarificationManager（v2.3） | NLU 澄清会话管理，状态机（asking/answered/timeout/give_up），≤3 轮上限，超时返回 8011，详见 07 第八节 |
| CompoundIntentSplitter（v2.3） | 复合意图拆分模块，连词+标点切分→依赖图→拓扑序编排，详见 07 第八节 / 08 第十七节 |
| IracReasoner（v2.3） | IRAC 推理执行器，四步结构化输出，详见 16 第二节 |
| FactSimilarityService（v2.3） | 案情事实相似度服务，factEmbedding cosine×0.6 + factAttributes Jaccard×0.4，阈值 0.75/0.5，详见 16 第三节 |
| LawApplicationDeterminer（v2.3） | 法条适用判定服务，构成要件抽取→事实匹配→applicable/partial/false，要件不足返回 8019，详见 16 第四节 |
| CaseComparator（v2.3） | 案例对比服务，相似度计算+差异点抽取，详见 16 第五节 |
| reasoning_chain（v2.3） | 推理链持久化集合，记录 IRAC 四步+引用法条/案例+置信度，详见 05 3.28 / 16 第六节 |
| ClauseRecommender（v2.3） | 第 8 LegalTool，合同条款推荐（BM25 召回+LLM rerank top 5），采纳率≥60%，详见 14 第十一节 |
| CitationGraphBuilder（v2.3） | 法条引用图构建模块，增量 upsert+每日全量重建 law_citation_graph，详见 14 第十四节 |
| LawTimelinessScanner（v2.3） | 法条时效扫描模块，三步算法（状态检测→交叉引用→预警），定时周一 03:00，详见 15 第十三节 |
| LawyerReviewService（v2.3） | 律师审核工作流服务，状态机 pending→claimed→reviewing→submitted→reflowed，详见 17 第二节 |
| AnswerQualityScorer（v2.3） | 回答质量评分服务，双轨（自动实时+律师异步），四维聚合，详见 17 第三节 |
| AnswerTracer（v2.3） | AI 回答溯源服务，msgId→{citedLaws/citedCases/promptVersion/modelVersion/reasoningChainId/ragSources/lawyerReviewId}，详见 17 第四节 |
| ComplianceMonitor（v2.3） | 合规风险监控服务，三路评分 pass/warn/block，block 返回 8013，详见 03 12.7 / 17 第五节 |
| LawyerAnnotationService（v2.3） | 律师标注回流服务，4 目标（intent_eval_set/reasoning_chain/law_article/feedback），详见 17 第六节 |
| DataExportService（v2.3） | 数据可携带权导出服务，聚合→脱敏→打包→云存储回链 7 天，详见 03 12.5 |
| SensitiveOpVerifier（v2.3） | 敏感操作二次校验服务，微信生物识别/短信验证码，失败返回 8012，详见 03 12.6 |
| case_reasoning（v2.3） | 第 8 意图枚举（reasoning 类，"能赢吗""判几年""相似案例"），详见 07 第 1.1 节 |
| clarification_session（v2.3） | 澄清会话集合，记录多轮澄清状态与补齐字段，详见 05 3.25 |
| law_citation_graph（v2.3） | 法条引用关系图集合，详见 05 3.29 |
| law_amendment_alert（v2.3） | 法条修订预警集合，详见 05 3.30 |
| data_export_request（v2.3） | 数据导出请求集合，详见 05 3.31 |
| compliance_alert（v2.3） | 合规风险告警集合，详见 05 3.32 |
| lawyer_review（v2.3） | 律师审核任务集合，详见 05 3.33 |
| answer_traceability（v2.3） | 回答溯源集合，详见 05 3.34 |

## 六、与 v1.0/v2.0/v2.1/v2.2 的关系

| 维度 | v1.0 | v2.0 | v2.1 | v2.2 | v2.3（本集） |
|------|------|------|------|------|-------------|
| 抽象层级 | 架构级 | 工程级 | 工程级 + Agent 化 | 工程级 + Agent 化 + 工具化 | 工程级 + Agent 化 + 工具化 + AI 律师化 |
| 数据模型 | 3 张表（示例） | 13 个集合（含字段/索引/关系/示例） | 18 个集合（+5 个 agent 相关） | 23 个集合（+5 个采集相关：official_query_entry/legal_material/knowledge_source/wechat_account/crawl_job） | 34 个集合（+11 个 v2.3：NLU/推理/文书版本/安全合规/律师审核，见 05 3.24-3.34） |
| 接口 | 未定义 | 10 类云函数 API + 8 个 Service 接口桩 + 错误码 | + Agent.invoke 统一契约 + 6 MCP tools + 10 OpenAPI 端点 + 13 个 v2.1 错误码 | + 9 OpenAPI 端点（共 19）+ 4 新云函数（invokeTool/queryCenter/materialCenter/knowledgePipeline）+ 9 个 v2.2 错误码（8001-8009） | + 6 OpenAPI 端点（共 25）+ 4 对外 MCP tools（共 17）+ 10 个 v2.3 错误码（8010-8019） |
| 算法 | 思路描述 | 打分公式 + 伪代码 + TS 接口桩 + 评测集设计 | + OrchestratorAgent 意图→编排计划映射 | + 7 工具算法（期间计算/文书审核/赔偿查询/证照OCR/法条效力/案由分类/量刑指导）+ tool_invoke 意图 | + IRAC 推理 5 算法（IracReasoner/FactSimilarityService/LawApplicationDeterminer/CaseComparator）+ NLU 三模块（EntityExtractor/ClarificationManager/CompoundIntentSplitter）+ case_reasoning 意图（见 16/07） |
| 流程 | 文字描述 | Mermaid 流程/时序/状态机 | + Agent 编排时序图 + 异步任务流 | + 第六节工具调用主流程（双路径）+ 第七节知识采集主流程（三阶段） | + 复合意图拆分/律师审核/数据导出 3 流程（见 08 第十七/十八/十九节） |
| UI | 功能罗列 | ASCII 线框 + 组件清单 + 设计 token | （无新增，UI 不受 v2.1 影响） | TabBar 双模式（工具/AI对话/案件/我的）+ 9 新页面 + 工具结果卡片组件 | + 推理/对比/溯源/律师端页面 + ClarificationCard/ConversationTree/TracePanel/DiffView 10 组件（见 09） |
| 安全合规 | 风险评估表 | 专项设计（分级/加密/PII/审计/免责/隐私协议） | + 跨 agent 传输规则 + PII 边界检测 + external_agent 角色 + 6 agent 审计事件 | + 法律位阶分类 + 采集合规（4 子节）+ 外链免责 + 工具免责 + 4 新审计事件（tool_invoke/tool_invoke_failed/crawl_job_run/crawl_source_blocked） | + 数据可携带权（PIPL 第 45 条）/敏感操作二次校验（8012）/合规风险监控（8013）+ 5 新审计事件（data_export/compliance_blocked/lawyer_review_submit/answer_scored/annotation_reflowed，见 03 12.5-12.7） |
| 检索 | "知识库兜底" | 混合检索 + RRF + 法条引用校验 | （沿用 v2.0 混合检索，agent 层包装） | （沿用 v2.0/v2.1，知识库扩展至 5 万+ 篇） | + 法条时效扫描（LawTimelinessScanner）+ 引用图（CitationGraphBuilder）确保不引用已废止法条（见 15 第十三节/14 第十四节） |
| 可观测 | 未涉及 | 日志/指标/告警/追踪 | + agent_invoke 指标 + 单 agent 错误率/P95/限流/PII 违规监控 | + tool_invoke/tool_invoke_failed/crawl_job_run/crawl_source_blocked 4 事件监控 | + 5 v2.3 审计事件监控 + 推理链/律师审核状态机/合规拦截监控（见 13/17） |
| 测试 | 验收标准 | 测试分层 + 评测集 + 灰度 + 回滚 | + Agent 协议测试 + 编排/协议评测 + 4 项 agent 安全测试 | + 工具测试层级 + 采集测试层级 + 2.5 工具评测 + 2.6 采集评测 + 8 项 v2.2 安全测试 + 阶段七路线图 | + 推理/律师审核 2 评测集（reasoning_eval_set/lawyer_review_eval_set）+ 2.7/2.8 评测 + 阶段八九十路线图（见 10） |
| 路线图 | 五阶段 | 五阶段任务拆解 + 依赖 + 风险跟踪 | + 阶段六（多 agent 协作与开放，约 4 周） | + 阶段七（7 法律工具 + 知识采集管道 + 双模式 UI，约 6 周） | + 阶段八（5 周 NLU/时效/安全）/阶段九（6 周推理/文书）/阶段十（4 周 UI/审核评估） |

v1.0 中的核心目标、核心模块职责、关键设计原则、YAGNI 裁剪、不做的事情等仍然有效，本集不推翻，只补全与细化。

**v2.1 新增内容**：v2.1 在 v2.0 之上新增多 agent 协作后端能力——内部 8 个专业 Agent + OrchestratorAgent 编排 + 对外 MCP/OpenAPI 暴露 + 外部 agent 分层治理。v2.0 的 22 个领域模块、13 个集合、10 类云函数 API 全部保留，Agent 层是其上的包装与编排。v2.0 路线图阶段一至五不变，新增阶段六（多 agent 协作与开放，约 4 周，见 10）。涉及文档：02/03/04/05/06/10/11/12/13 共 9 篇；01/07/08/09 不受 v2.1 影响。

**v2.2 新增内容**：v2.2 在 v2.1 之上新增三大主线——① 双模式 UI（TabBar 改 4 Tab：工具/AI对话/案件/我的，用户可在工具 Tab 直接调 invokeTool 云函数，9 个新页面）；② 7 个法律工具 + ToolAgent（PeriodCalculator/DocumentReviewer/CompensationQuery/LicenseOcr/LawValidityQuery/CauseClassifier/SentencingGuide，统一 LegalTool 接口，由 ToolAgent 包装注入 AgentRegistry，新增 tool_invoke 意图）；③ 知识采集三阶段管道（KnowledgePipeline 云函数 + 6 子模块 + 5 新集合 + 2 定时触发器，目标 5 万+ 篇法律知识库）。v2.0/v2.1 的 22 个领域模块、18 个集合、10 类云函数 API、8 个专业 Agent、6 个 MCP tools、10 个 OpenAPI 端点全部保留。v2.0 路线图阶段一至六不变，新增阶段七（约 6 周，见 10）。涉及文档：02/03/06/07/08/10/11/14/15 共 9 篇有内容修订；00/01/04/05/09/12/13 共 7 篇仅头部版本号同步至 v2.2，内容沿用 v2.1。

**v2.3 新增内容**：v2.3 在 v2.2 之上将系统升级为"功能增强的 AI 律师系统"，围绕 7 大完善方向扩展——① **NLU 自然语言理解**（EntityExtractor 四层 + ClarificationManager 状态机 + CompoundIntentSplitter 依赖图，nlu Agent，见 07 第八节/11）；② **知识库扩充与时效**（LawTimelinessScanner 法条时效扫描 + CitationGraphBuilder 引用图，定时周一 03:00，见 15 第十三节/14 第十四节）；③ **逻辑推理能力**（IRAC 推理框架 + FactSimilarityService/LawApplicationDeterminer/CaseComparator + reasoning_chain 持久化，reasoning Agent，见 16/07 第九节）；④ **文书自动生成增强**（ClauseRecommender 第 8 LegalTool 条款推荐 + 文书版本 + DiffView，见 14 第十一节/09）；⑤ **用户交互优化**（4 TabBar + ClarificationCard/ConversationTree/TracePanel + 律师审核端页面，10 新组件，见 09）；⑥ **数据安全与隐私**（DataExportService 数据可携带权 PIPL 第 45 条 + SensitiveOpVerifier 敏感操作 8012 + ComplianceMonitor 合规监控 8013，见 03 12.5-12.7）；⑦ **系统评估机制**（reasoning_eval_set/lawyer_review_eval_set 2 评测集 + 律师审核闭环 5 服务，lawyer-review Agent，见 17/10 2.7-2.8）。v2.0–v2.2 的全部资产保留；Agent 9→12、capability 18→27、意图 7→8、集合 23→34、MCP tools 13→17、OpenAPI 端点 19→25、LegalTool 7→8、错误码 +10（8010-8019）、审计事件 +5。v2.0 路线图阶段一至七不变，新增阶段八（5 周）/阶段九（6 周）/阶段十（4 周），见 10。涉及文档：全 17 篇均有 v2.3 修订或新建，其中 16（法律推理架构）/17（律师审核评估）为新建权威源，00/01/02/13 为本批次收尾升级。

## 七、设计原则（贯穿本集）

1. **准确性优先** — 法条问题先规则引擎，LLM 输出经法条引用校验层。
2. **合规底线** — 强制免责、PII 脱敏、审计留痕、最小化采集。
3. **渐进式引导** — 复杂任务多步表单，避免一次性索取过多信息。
4. **可追溯** — 每条回答标注法律依据（具体法条号或案例编号）。
5. **成本优化** — 简单问题不调 LLM，多级缓存，相同问题复用。
6. **降级韧性** — LLM 不可用时规则引擎 + 知识库兜底；提醒降级为页面内展示。

## 八、验收口径（文档型交付）

1. **完整性** — `01` 的缺口清单逐项在其余篇有落点。
2. **一致性** — `05` 字段 ↔ `06` 接口 ↔ `07` 算法 I/O ↔ `08` 流程节点，模块名各篇统一。
3. **可实施性** — 抽查法律咨询、文书生成、案件提醒三场景，可仅凭本集完成任务卡拆解。
4. **合规性** — `03` 覆盖《个人信息保护法》《数据安全法》对法律咨询类应用的核心要求。
5. **导航性** — 本篇文档地图链接路径正确可达。
6. **v2.1 完整性** — 用户三点诉求（内部多 agent 协作 / 对外 MCP+OpenAPI 暴露 / 外部 agent 受控调用）在 11/12/13 均有落点。
7. **v2.1 一致性** — agentId（8 个）、capability（11 个）、MCP tool 名（6 个）、OpenAPI 端点（10 个）、新增错误码（7 个核心 + 5 个 JSON-RPC）、新增集合名（5 个）、审计事件（6 个）、暴露层级（3 个）跨 13 篇严格一致。
8. **v2.2 完整性** — 用户三点诉求（双模式 UI / 7 法律工具 / 知识采集管道）在 09/14/15 均有落点，并经 11（ToolAgent）/ 06（invokeTool 等 4 云函数 + 9 端点）/ 08（第六/七节流程）/ 03（采集合规/工具免责）形成闭环。
9. **v2.2 一致性** — 7 工具元数据（toolId/inputSchema/outputSchema/piiLevel）跨 14/06/11 严格一致；5 新集合 schema 跨 15/05 严格一致；错误码 8001-8009 跨 06/14/15 三处定义完全相同；法律位阶 6 枚举跨 03/14/07 三处定义完全相同；Agent 总数 9、capability 总数 18、IntentType 7、集合 23、MCP tools 13、OpenAPI 端点 19 跨 15 篇文档统一。
10. **v2.2 可实施性** — 抽查 TabBar 双模式 / 工具调用全链路（AI 对话路径） / 知识采集三阶段 3 场景，可仅凭本集完成任务卡拆解与编码。
11. **v2.3 完整性** — 用户 7 方向诉求（NLU/知识时效/推理/文书/交互/安全合规/评估）在 07/15/16/14/09/03/17 均有落点，并经 11（nlu/reasoning/lawyer-review 3 新 Agent）/ 06（6 端点 + 10 错误码 8010-8019）/ 08（复合意图拆分/律师审核/数据导出 3 流程）/ 10（reasoning/lawyer_review 2 评测集 + 阶段八九十）形成闭环；01 第 2.1 节 V1–V7 差距逐项有落点。
12. **v2.3 一致性** — Agent 总数 12、capability 27、IntentType 8、集合 34、MCP tools 17、OpenAPI 端点 25、LegalTool 8、错误码 19（含 8010-8019）、审计事件 23（v2.0 8 + v2.1 6 + v2.2 4 + v2.3 5，权威源 03 第七节）、5 v2.3 评测集/审计事件/capability 跨 17 篇文档统一。
13. **v2.3 可实施性** — 抽查 3 场景（复合法律问题推理全链路 / 文书生成+条款推荐+版本管理 / 法条时效扫描+合规拦截），可仅凭本集完成任务卡拆解与编码。
