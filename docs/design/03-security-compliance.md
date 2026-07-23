# 03 · 安全与合规设计

> 版本：v2.3 | 日期：2026-07-22 | 状态：设计扩展（v2.3 新增数据可携带权/敏感操作二次校验/合规风险监控）
> 影响范围：02 / 04 / 05 / 06 / 07 / 08 / 11 / 12 / 13 / 14 / 15 / 16 / 17
> 法规依据：《个人信息保护法》(PIPL)、《数据安全法》(DSL)、《网络安全法》、《生成式人工智能服务管理暂行办法》、《著作权法》、微信小程序运营规范；v2.1 追加 agent 生态治理专项（详见 13）；v2.2 追加法律位阶分类 / 采集合规 / 外链免责 / 工具免责（详见第十二·补节）；v2.3 追加数据可携带权（《个人信息保护法》第 45 条）/ 敏感操作二次校验 / 合规风险监控（详见第十二·补二节）

---

## 一、设计目标

1. **合规底线** — 满足法律咨询类应用在 PIPL/DSL 下的核心义务。
2. **数据安全** — 敏感数据全链路加密、最小化、可审计。
3. **风险隔离** — 平台不出具"法律意见"，强制免责，引导专业律师。
4. **可追溯** — 关键操作留痕，支持事后定责与监管核查。
5. **用户控制** — 用户对其个人信息享有知情、查阅、删除、撤回同意的权利。

## 二、数据分级

| 等级 | 定义 | 示例 | 处理规则 |
|------|------|------|----------|
| L1 公开 | 已公开或可公开 | 法条、公开案例摘要、文书模板 | 自由存储/传输 |
| L2 内部 | 业务运营数据 | 意图识别日志、聚合统计 | 内部访问，日志脱敏 |
| L3 敏感 | 用户个人信息 | 姓名、手机号、咨询历史、案件事实 | 加密存储、最小化、审计 |
| L4 高敏 | 敏感个人信息 | 身份证号、身份证影像、证据材料 | 字段级加密、严格权限、短留存 |

**映射到 05 集合**：`user_profile.name/phone` = L3；`case_record.facts/materials` = L3–L4；`dialog_record.messages` = L3；`audit_log` = L2（但含 userId 需脱敏展示）；`law_article` / `legal_knowledge` / `case_precedent`(公开) = L1；v2.1 新增 `agent_registry` = L2、`external_agent_credential` = L3（含 apiKey 哈希）、`agent_invocation_log` = L2、`agent_job` = L3、`external_agent_registry` = L2。

### 2.1 跨 agent 传输规则（v2.1，权威源见 13 第 6 节）

v2.1 引入外部 agent 调用后，数据分级决定跨 agent 边界的传输策略：

| 数据等级 | 跨 agent 传输规则 |
|---------|------------------|
| L1 公开（法条/公开案例/文书模板） | ✅ 可经 MCP/OpenAPI 自由传输给外部 agent |
| L2 内部（agent 注册/统计/调用日志） | ⚠️ 仅内部 agent 间传输，不对外；外部 agent 仅可见自身调用日志摘要 |
| L3 敏感（姓名/手机号/咨询历史/案件事实） | ⚠️ 外部 agent 调用只读能力（L-Read）时直接拒绝；调用受限写能力（L-Write-Limited）时经 `PiiService.detectAndMask` 脱敏后透传 |
| L4 高敏（身份证号/身份证影像/证据材料） | ❌ 外部 agent 任何场景禁入；内部 agent 间字段级加密传输 |

**强制约束**：
- 外部 agent 调用入口（`agentDispatcher`）对 `input.params` 跑 `PiiService.detectAndMask`：检测到 L4 直接拒绝（返回 `7004`），L3 在只读能力上拒绝、在受限写能力上脱敏后透传。
- 内部 agent → 外部 agent：经 `PiiService.detectAndMask` 后仅传 ≤ L2。
- 所有对外响应在出口处再过 `PiiService.detectAndMask`，确保无 L3/L4 明文外泄。
- 案例库返回的当事人姓名已是脱敏（如`张某某`），不构成 PII 风险。

## 三、加密策略

| 场景 | 方案 |
|------|------|
| 传输 | 全链路 HTTPS/WSS；客户端↔云开发走微信加密通道；云函数↔LLM 走 TLS |
| 存储基线 | 云数据库落盘加密（云开发默认）；云存储对象加密 |
| 字段级加密 | L4 字段（身份证号、证据影像路径关联）应用层 AES-256-GCM 加密后再写库；密钥存云开发环境变量 + KMS（如有） |
| 密钥管理 | LLM API Key、字段加密密钥、向量服务凭证统一存云开发环境变量，不入仓库、不打日志 |
| 哈希 | userId 在日志/审计中以 `sha256(openid + salt)` 出现，避免 openid 明文散落 |

## 四、PII 识别与脱敏

### 4.1 入库前脱敏

- 客户端不采集非必要 PII：默认仅 openid；姓名/手机号在用户主动填写案件档案时采集，且可空。
- 身份证号前端校验格式但不存明文，存脱敏 `110***********1234` + 哈希。
- 证据材料原图存云存储（私有读），UI 展示缩略图 + 水印（用户 openid 尾号）。

### 4.2 出库/展示脱敏

- 对话历史回显：手机号 `138****1234`，身份证 `110***********1234`，银行卡 `**** **** **** 1234`。
- LLM Prompt 中注入的案情：身份证号、银行卡号必须脱敏后再注入，防止泄漏给 LLM 厂商。
- 日志：禁止打印完整消息内容，仅打印 `messageHash + length + intent`。

### 4.3 脱敏实现位置

- `services/legal/piiService.ts`：统一 `mask(value, type)` 与 `detectAndMask(text)`。
- 在 L3 服务层调用，确保所有外部出口（LLM、日志、订阅消息）均经过。

### 4.4 跨 agent 边界（v2.1，权威源见 13 第 6 节）

v2.1 引入外部 agent 调用后，PII 脱敏在 agent 边界强制执行：

| 调用方向 | 检测与脱敏策略 |
|---------|--------------|
| 外部 agent → 内部 agent | `agentDispatcher` 入口对 `input.params` 跑 `PiiService.detectAndMask`：检测到 L4 直接拒绝（`7004`）；L3 在只读能力（L-Read）上拒绝、在受限写能力（L-Write-Limited）上脱敏后透传 |
| 内部 agent → 内部 agent（同进程） | 按 4.3 实现，不额外拦截；输入 PII 级别 ≤ 目标 agent `piiLevel` |
| 内部 agent → 外部 agent | 经 `PiiService.detectAndMask` 后仅传 ≤ L2；高敏字段一律剥离 |
| 任何对外响应 | mcpServer / openApiGateway 网关出口处再过 `PiiService.detectAndMask`，确保无 L3/L4 明文外泄 |

**实现位置**：
- 入口检测：`agentDispatcher` 云函数中间件（鉴权后、调用 agent 前）。
- 出口检测：`mcpServer` / `openApiGateway` 网关出口中间件（响应封装前）。
- 违规审计：检测到 L4 输入或 L3/L4 输出泄漏即写 `audit_log(event=agent_pii_violation)`，字段 `agentKey/piiLevel/capability`，并触发告警（见 02 第 8.2 节）。

## 五、数据最小化、留存与删除

| 数据 | 留存期 | 删除策略 |
|------|--------|----------|
| 对话历史 | 90 天滚动 | `dialog_record` TTL 索引 `expireAt = createdAt + 90d` |
| LLM 缓存 | 7 天 | `llm_cache` TTL `expireAt` |
| 审计日志 | 180 天 | `audit_log` TTL `expireAt = ts + 180d` |
| 案件档案 | 案件关闭后 1 年 | 用户主动删除即时；到期自动清理 |
| 证据影像 | 案件关闭后 30 天 | 云存储对象生命周期规则 |
| 用户账号 | 用户注销即删 | 注销流程同步删除 `user_profile`/`case_record`/`dialog_record` |

**用户权利**：
- 查阅：`/pages/mine` 展示完整数据清单与导出入口。
- 删除：注销账号 → 二次确认 → 30 天宽限 → 永久删除（审计日志保留必要记录）。
- 撤回同意：在设置中关闭"个性化记忆"，已存记忆停止使用并于 7 天内清除。

## 六、权限模型（RBAC）

| 角色 | 范围 | 权限 |
|------|------|------|
| 用户（user） | 自己的数据 | 增删改查自己的案件/对话/文书 |
| 客服（support） | 受限 | 仅查看用户问题反馈，不访问案情细节 |
| 运营（ops） | 知识库 | 增改 `law_article`/`legal_knowledge`/`document_template`，触发缓存失效 |
| 审计（audit） | 审计日志 | 只读 `audit_log`，不可改 |
| 管理员（admin） | 系统 | `feature_flag`、密钥轮换、灰度配置、外部 agent 凭证审批 |
| 外部 agent（external_agent，v2.1） | 经授权的 capability 子集 | 仅可调 L-Read / L-Write-Limited 层级 capability；不可访问任何 L-Internal；scope 由 `external_agent_credential.scopes` 定义 |

**实现**：
- 客户端用户身份仅 openid，无显式角色。
- 运营/审计/管理员通过独立的 `admin` 小程序或 Web 后台，使用微信扫码登录 + 角色绑定（`admin_user` 集合）。
- 所有云函数入口校验调用者身份与资源归属（`resource.ownerId === callerId`），越权返回 `4031`。
- **v2.1 外部 agent 鉴权**：通过 `Authorization: Bearer lak_live_<32位>` API Key 鉴权，与现有 openid 鉴权并存；`agentDispatcher` 入口校验 API Key 哈希 + scope + 有效期，详见 13 第 2-3 节。外部 agent 调用 L-Internal capability 一律返回 `7002`；调用越权返回 `4031`（与现有越权码一致）。

## 七、审计日志

写入 `audit_log` 集合（schema 见 05），覆盖事件：

| 事件类型 | 触发 | 关键字段 |
|----------|------|----------|
| `chat_send` | 用户发送消息 | userId, intent, route, hasPii |
| `llm_call` | LLM 调用 | userId, promptHash, model, tokenIn, tokenOut, latency, success |
| `doc_generate` | 文书生成 | userId, templateId, caseId |
| `case_access` | 案件数据访问 | userId, caseId, action |
| `admin_op` | 运营操作 | adminId, op, target, before, after |
| `auth_event` | 登录/授权/注销 | userId, event |
| `data_delete` | 数据删除 | userId, scope |
| `degradation` | 降级触发 | reason, scope |
| `agent_invoke`（v2.1） | 任何跨 agent 调用 | traceId, callerAgentId, targetAgentId, capability, result, durationMs |
| `agent_auth`（v2.1） | 外部 agent 凭证颁发/轮换/吊销 | agentKey, action, adminId |
| `agent_authz_deny`（v2.1） | 外部 agent 越权拒绝 | agentKey, capability, reason |
| `agent_pii_violation`（v2.1） | PII 边界违规 | agentKey, piiLevel, capability |
| `agent_rate_limit`（v2.1） | 外部 agent 限流触发 | agentKey, bucket |
| `agent_degradation`（v2.1） | agent 降级 | agentId, fallbackAgentId, reason |
| `tool_invoke`（v2.2） | 工具调用成功 | userId, toolId, inputHash, durationMs, fromCache, degraded |
| `tool_invoke_failed`（v2.2） | 工具调用失败 | userId, toolId, inputHash, errorCode, errorMessage |
| `crawl_job_run`（v2.2） | 采集任务完成 | sourceId, urlHash, durationMs, status, contentHash? |
| `crawl_source_blocked`（v2.2） | 采集源被标记 blocked | sourceId, reason, retryCount |
| `data_export`（v2.3） | 数据导出完成 | userId, requestId, scope, fileId |
| `compliance_blocked`（v2.3） | 合规风险拦截 | msgId, userId, riskLevel, triggers |
| `lawyer_review_submit`（v2.3） | 律师审核提交 | reviewId, lawyerId, msgId, scores |
| `answer_scored`（v2.3） | 回答质量评分 | msgId, autoScore, lawyerScore? |
| `annotation_reflowed`（v2.3） | 律师标注回流 | reviewId, target, targetId |

**约束**：审计日志只追加不删改；含 PII 字段需脱敏后入库；保留 180 天。

**v2.1 补充约束**：
- 高频 `agent_invoke` 事件另写精简快查集合 `agent_invocation_log`（TTL 30 天，字段见 05 第 3.16 节），供运营后台按 agentKey 维度查调用趋势、错误率、配额使用；`audit_log` 仍保留 180 天全量。
- 6 个 agent 事件字段规范与 13 第 5.1 节保持一致；越权/PII 违规/限流事件触发实时告警（02 第 8.2 节）。
- 凭证生命周期事件（`agent_auth`）含 action 枚举：`grant` / `rotate` / `revoke` / `expire`，由 13 第 2.3 节定义。

## 八、免责声明自动化

### 8.1 强制注入点

- **每条 AI 回答尾部**：固定文案"⚠️ 以上内容仅供参考，不构成法律意见，具体问题请咨询专业律师。"
- **文书生成结果页**：固定文尾"本文书由 AI 生成，请在提交前由专业律师审核。"
- **案件分析结论**：在结论前插入"以下为基于公开信息的分析，不构成法律意见"。
- **首次进入 AI 对话页**：弹窗确认"我已了解 AI 回答仅供参考"。

### 8.2 触发专业律师引导的规则

满足以下任一条件时，在回答末尾追加"建议尽快咨询专业律师"卡片：

| 触发条件 | 实现 |
|----------|------|
| 意图 = `case_analysis` 且涉及刑事 | `intent=case_analysis && category=criminal` |
| 用户输入含"紧急/被抓/传唤/拘留" | 关键词命中 `urgentKeywords` |
| LLM 输出风险评分 ≥ 阈值 | LLM Prompt 要求输出 `riskLevel: high` |
| 同一问题 3 轮未解决 | `dialog_record.context.unresolvedCount ≥ 3` |

### 8.3 措辞合规

- 全平台禁止使用"法律意见/代理/胜诉保证"等措辞。
- 用"法律信息参考/流程指引/文书草稿"替代。
- UI 文案需经合规审阅，纳入 10 的测试 checklist。

## 九、微信小程序合规

| 项 | 要求 | 落点 |
|----|------|------|
| 用户授权 | 明示告知采集范围与目的，最小化 | 首次启动隐私弹窗 + `privacyContract` |
| 订阅消息 | 一次性/长期订阅分类合规，每条模板需用户主动授权 | `notification_subscription` 集合记录授权 |
| 内容安全 | 文本/图片上传经微信 `security.msgSecCheck` / `imgSecCheck` | L2 网关层与上传云函数 |
| 未成年人 | 不主动面向未成年人，发现则限制 AI 深度咨询 | 注册时声明 + 关键词检测 |
| 实名要求 | 法律咨询不强制实名，但文书生成涉及当事人需用户提供信息（不入库明文） | 表单提示 |

## 十、生成式 AI 合规要点

依《生成式人工智能服务管理暂行办法》：

1. **训练数据合规**：本平台不训练基础模型，仅做 Prompt 工程 + RAG；RAG 注入的法条/案例须来自合规公开源（中国法律法规数据库、中国裁判文书网），标注来源。
2. **输出标识**：AI 生成内容需可识别（已在免责声明中标识）。
3. **违法内容阻断**：LLM 输出经内容安全检测；命中违法词库则拦截 + 记录。
4. **算法备案**：若调用通义千问已备案，平台作为应用方需配合提供应用信息（合规团队跟进，非工程范围）。
5. **投诉机制**：`/pages/mine` 提供"问题反馈"入口，反馈进入 `feedback` 集合，48 小时内响应。

## 十一、隐私协议与个人信息处理说明要点

隐私协议须包含（法务定稿，工程提供字段支撑）：

1. 处理者身份与联系方式。
2. 处理目的、方式、范围（咨询/文书/案件跟踪/提醒）。
3. 采集的个人信息清单（对应 05 集合字段）。
4. 存储期限与删除规则（第五节）。
5. 共享/转让/公开披露情形（LLM 厂商：仅传输脱敏后的咨询内容，签 DPA）。
6. 用户权利实现方式（查阅/复制/更正/删除/撤回同意/注销）。
7. 跨境传输声明（不跨境；LLM 厂商须境内服务）。
8. 自动化决策说明（个性化记忆与推荐，可关闭）。
9. 未成年人条款。
10. 投诉与救济渠道。

**工程支撑**：`/pages/privacy` 页面承载协议全文与版本；用户首次同意记录写入 `audit_log`（`auth_event: privacy_accept`，含协议版本号）。

## 十二、安全测试要点（详见 10）

- 越权访问测试（横向/纵向）。
- PII 泄漏测试（日志、LLM Prompt、订阅消息内容）。
- 输入注入测试（Prompt Injection、XSS in 文书）。
- 密钥泄漏扫描（仓库、日志、客户端包）。
- 依赖漏洞扫描（`npm audit` + SAST）。

## 十二·补、v2.2 新增合规要点

### 12.1 法律位阶分类（v2.2，权威源）

法律位阶决定法条效力层级与冲突适用规则。本节为 LawValidityQuery 工具（14 第四节）`legalHierarchy` 字段权威源，亦为 07 第 7.5 节法条效力查询算法的位阶判定依据。

| 位阶 | 枚举值 | 颁布机关 | 效力范围 | 冲突适用规则 |
|------|--------|---------|---------|------------|
| 1 | `constitution` | 全国人民代表大会 | 全国 | 最高效力，一切法律不得抵触 |
| 2 | `law` | 全国人大及其常委会 | 全国 | 仅次于宪法，高于行政法规/地方性法规 |
| 3 | `administrative_regulation` | 国务院 | 全国 | 高于地方性法规/部门规章 |
| 4 | `local_regulation` | 省/设区的市人大及其常委会 | 本行政区域 | 本区域内高于部门规章；与部门规章冲突由全国人大常委会裁决 |
| 5 | `judicial_interpretation` | 最高人民法院/最高人民检察院 | 全国 | 与法律同等效力（司法解释具有法律效力） |
| 6 | `departmental_rule` | 国务院各部委/直属机构 | 全国（部门职责范围） | 最低效力，与地方性法规冲突由全国人大常委会裁决 |

**工具约束**：
- LawValidityQuery 输出 `legalHierarchy` 字段必须取自本表 6 个枚举值之一
- 法条冲突时，工具 `lawRefs` 字段按位阶降序排列
- 同位阶法条冲突时，工具 warnings 提示"同位阶法条冲突，以新法/特别法为准"

### 12.2 采集合规（v2.2）

知识采集管道（详见 15）须遵循以下合规要求：

#### 12.2.1 数据源白名单

- 仅允许采集 `knowledge_source.status=active` 且经法务白名单审核的源
- 第三方源须签署授权协议或确认 robots.txt 允许抓取
- wechat_account 须 `authorized=true` 且 `licenseExpiresAt` 未过期
- 白名单每年复审，过期源自动 `status=deprecated`

#### 12.2.2 robots.txt 强制尊重

- 阶段一 UrlCollector 入队前强制检查 robots.txt
- Disallow 路径直接跳过 + 审计 `crawl_source_blocked`
- `knowledge_source.robotsTxtCompliant=false` 的源整体跳过

#### 12.2.3 反爬限速合规

- 每域令牌桶限速 ≤ 1 req/s（默认）
- 随机延迟 2-8s
- UA 必须真实可识别，含联系方式（如 `LegalAgentBot/1.0 (contact: legal@example.com)`）
- 禁止伪装浏览器 UA
- 失败时指数退避 1s → 2s → 4s 最多 3 次

#### 12.2.4 公众号文章版权

- 仅采集公开 RSS / 分享链接，不破解微信私有协议
- 正文存储 30 天后归档：删除正文，保留 `archiveSummary`（≤ 200 字摘要）+ `sourceUrl` 外链
- 归档后 UI 仅展示摘要 + 外链跳转
- 未授权公众号 (`authorized=false`) 严禁采集
- 涉及《著作权法》第二十四条合理使用的，须在 `legal_material.metadata` 标注 `fairUse: true` + `reason`

### 12.3 外链免责（v2.2）

所有外链（法条来源 URL / 案例来源 URL / 公众号文章 URL / 第三方法律资讯 URL）在 UI 显著位置标注免责：

- **列表页**：每条含外链的内容项右下角标注"⚠️ 外链内容由第三方提供，本平台不对其准确性负责"
- **详情页**：在外链按钮旁固定展示"⚠️ 即将跳转外部站点 {域名}，本平台不对外部内容负责"
- **点击外链**：弹窗确认"您即将离开本平台，跳转至 {域名}。外部内容由第三方提供，本平台不对其准确性、合法性、完整性负责。是否继续？"，用户确认后方可跳转
- **公众号归档文章**：摘要下方固定展示"⚠️ 本文为公众号文章摘要，完整内容请访问原文，版权归原作者所有"

实现位置：
- 法条/案例卡片组件（09 ui-prototype）的 `sourceUrl` 字段渲染处
- 工具结果卡片（LawValidityQuery 等）的 `lawRefs[].sourceUrl` 渲染处
- 公众号文章卡片（legal_material sourceType=wechat）的归档摘要渲染处

### 12.4 工具免责（v2.2）

8 个 LegalTool（详见 14）输出强制含 `disclaimer` 字段，UI 在工具结果卡片底部固定展示，不可由用户关闭：

| 工具 | disclaimer 文案 |
|------|----------------|
| LawValidityQuery | ⚠️ 法条效力信息仅供参考，以官方发布为准。如需正式法律意见，请咨询专业律师。 |
| PeriodCalculator | ⚠️ 本计算结果仅供参考，具体以法院通知为准。如涉及重大期限，请咨询专业律师核实。 |
| LicenseOcr | ⚠️ OCR 识别结果仅供参考，请以证照原件为准。涉及法律事务时请人工核对。 |
| DocumentReviewer | ⚠️ 文书审核结果仅供参考，不构成法律意见。请由专业律师最终审核后使用。 |
| CompensationQuery | ⚠️ 赔偿标准仅供参考，具体金额以法院判决为准。如需正式法律意见，请咨询专业律师。 |
| CauseClassifier | ⚠️ 案由分类仅供参考，最终案由以法院立案为准。如需正式法律意见，请咨询专业律师。 |
| SentencingGuide | ⚠️ 量刑指导仅供参考，具体量刑由法院综合判定。如需正式法律意见，请咨询专业律师。 |
| ClauseRecommender（v2.3） | ⚠️ 推荐条款仅供参考，请在专业律师审核后使用。条款适用性因具体案情而异，本工具推荐不构成法律意见。 |

**强制约束**：
- `ToolResult.disclaimer` 字段为必填（见 14 第 2.3 节 ToolResult 接口）
- 工具结果卡片组件（09 ui-prototype）底部固定区域展示 disclaimer，不可关闭/折叠
- 网关出口二次校验 disclaimer 缺失，缺失时注入兜底免责"⚠️ 本工具结果仅供参考，不构成法律意见"+ 告警（`audit_log` reason=missing_tool_disclaimer）
- 工具 disclaimer 缺失安全测试见 10 第三节 v2.2 专项

## 十二·补二、v2.3 新增合规要点

### 12.5 数据可携带权（v2.3）

依《个人信息保护法》第 45 条，用户有权向个人信息处理者请求转移其个人信息。本节定义 `DataExportService` 模块实现数据可携带权导出闭环。

#### 12.5.1 导出范围

| 集合 | 导出字段 | 脱敏规则 |
|------|---------|---------|
| `user_profile` | name / phone / createdAt | 手机号保留（用户自有数据），不脱敏 |
| `case_record` | 全字段（facts / materials / parties / status） | L4 字段（身份证号）哈希化 |
| `dialog_record` | messages[] 全量 | L4 字段哈希化；LLM prompt 不含（仅 messages） |
| `document_record` | 全字段（templateId / vars / content / citedLaws） | 不脱敏（用户自有文书） |
| `feedback` | 全字段 | 不脱敏 |

#### 12.5.2 导出流程

```
1. 用户在 /pages/mine 发起导出请求 → POST /v1/data-exports（见 06）
2. DataExportService 创建 data_export_request 记录（status=pending）
3. 异步聚合（云函数）：
   a. 按 userId 查询上述 5 集合
   b. L4 字段哈希化（身份证号 → sha256 哈希）
   c. 打包为 JSON（结构化）+ PDF（可读摘要）
4. 上传至云存储（私有读，7 天生命周期）
5. 更新 data_export_request（status=ready, fileId=xxx, expireAt=now+7d）
6. 发送订阅消息通知用户（含下载链接）
7. 审计 data_export { userId, requestId, scope, fileId }
```

#### 12.5.3 安全约束

- 导出请求须经敏感操作二次校验（见 12.6 节）
- fileId 链接仅返回给 userId 本人，RBAC 校验 `resource.ownerId === callerId`
- 7 天后云存储对象自动删除，data_export_request 标记 status=expired
- 导出文件不含其他用户数据（严格按 userId 隔离）
- 对应集合：`data_export_request`（见 05 3.31）

### 12.6 敏感操作二次校验（v2.3）

#### 12.6.1 触发场景

| 操作 | 触发条件 | 校验方式 |
|------|---------|---------|
| 文书删除 | `DELETE /v1/documents/{id}` | 微信生物识别 / 短信验证码 |
| 数据导出 | `POST /v1/data-exports` | 微信生物识别 / 短信验证码 |
| 案件归档 | `POST /v1/cases/{id}/archive` | 微信生物识别 / 短信验证码 |
| 账号注销 | `POST /v1/auth/delete-account` | 微信生物识别 / 短信验证码 |

#### 12.6.2 SensitiveOpVerifier 模块

```
输入：userId, opType, verifyMethod('biometric'|'sms')
输出：{ verified: boolean, verifyToken: string?, expireAt: Date? }

1. if verifyMethod == 'biometric':
1.1   调用微信生物识别 API（wx.checkIsSupportSoterAuthentication / wx.startSoterAuthentication）
1.2   返回 resultJSON + resultJSONSignature
1.3   云函数侧验签（调用微信验签接口）
1.4   验签通过 → verified=true, verifyToken=uuid, expireAt=now+5min
2. else if verifyMethod == 'sms':
2.1   发送 6 位验证码到 user_profile.phone（云函数侧生成 + 存 llm_cache 5 分钟）
2.2   用户输入验证码 → 云函数比对
2.3   匹配 → verified=true, verifyToken=uuid, expireAt=now+5min
3. 校验失败 → verified=false
4. 审计 sensitive_op_verified / sensitive_op_failed { userId, opType, verifyMethod, success }
```

#### 12.6.3 编排集成

`OrchestratorAgent` 编排伪代码（见 11 第 5.4 节）已含 `enforceSensitiveOp` 钩子：

```
// 11 第 5.4 节编排伪代码片段
if (isSensitiveOp(intent)) {
  const verified = await sensitiveOpVerifier.verify(ctx.callerUserId, intent);
  if (!verified) throw new LegalAgentError(8012, '敏感操作二次校验失败', intent);
}
```

校验失败返回错误码 `8012`（见 06），前端弹出校验弹窗引导用户完成验证。

### 12.7 合规风险监控（v2.3）

#### 12.7.1 ComplianceMonitor 模块

`ComplianceMonitor` 对每条 AI 回答进行三路合规风险评分，产出 `pass / warn / block` 三级风险等级。

#### 12.7.2 三路评分

| 路 | 来源 | 实时性 | 评分逻辑 |
|----|------|--------|---------|
| ContentSafety | 微信 security.msgSecCheck + 自建违法词库 | 实时 | 命中违法词 → risk+1；msgSecCheck 不通过 → risk+2 |
| 律师标记 | lawyer_review.complianceScore < 3 | 异步 | 已有律师审核记录且 complianceScore<3 → risk+2 |
| 法条引用校验 | LlmService.validateLawRefs 失败率 | 聚合 | 单条回答法条引用校验失败率 > 30% → risk+1 |

```
风险等级判定：
  totalRisk = ContentSafety_risk + lawyerMark_risk + lawRef_risk
  totalRisk == 0 → pass（正常展示）
  totalRisk == 1 → warn（展示 + 底部追加"⚠️ 本回答可能存在合规风险，请谨慎参考"）
  totalRisk >= 2 → block（拦截展示 + 审计 compliance_blocked + 写 compliance_alert）
```

#### 12.7.3 编排集成

`OrchestratorAgent` 编排伪代码（见 11 第 5.4 节）已含 `complianceMonitor.scan` 钩子：

```
// 11 第 5.4 节编排伪代码片段
const compliance = await complianceMonitor.scan(aggregated);
if (compliance.riskLevel === 'block') {
  await auditLog.write({ event: 'compliance_blocked', msgId, userId, riskLevel: 'block', triggers: compliance.triggers });
  throw new LegalAgentError(8013, '合规风险拦截', 'compliance');
}
```

block 级返回错误码 `8013`（见 06），前端展示"该回答因合规风险暂不可展示，请稍后重试或咨询专业律师"。

#### 12.7.4 闭环

```
block 级 → 写 compliance_alert（05 3.32，state=pending）
  → 律师/管理员在后台复核
  → action 判定：
     - none（误报）→ 关闭 alert
     - warn_user（轻微风险）→ 追加用户提示
     - block（确认风险）→ 保持拦截 + 标记 msgId 为已拦截
     - retrain（系统性风险）→ 触发 prompt/知识库迭代（见 17 第六节律师标注回流）
```

对应集合：`compliance_alert`（见 05 3.32）；合规风险闭环详见 17 第五节。

---

## 十三、与 v1.0/v2.0/v2.1/v2.2/v2.3 的差异声明

- **v1.0 → v2.0**：v1.0 风险表仅列"隐私泄露 → 数据加密存储 + 权限控制"一句；v2.0 将其展开为分级、加密、PII、审计、权限、免责、隐私协议、生成式 AI 合规八块专项设计，覆盖 G1–G6、G28 全部 P0/P1 安全合规缺口。
- **v2.0 → v2.1**：
  - 数据分级新增 **2.1 跨 agent 传输规则**：L1 可对外、L2 仅内部、L3 受限写脱敏透传、L4 任何场景禁入。
  - PII 识别与脱敏新增 **4.4 跨 agent 边界**：`agentDispatcher` 入口检测 + 网关出口二次脱敏 + 违规写 `agent_pii_violation` 审计。
  - RBAC 新增 `external_agent` 角色：API Key + scope 鉴权，仅可调 L-Read / L-Write-Limited，不可访问 L-Internal。
  - 审计事件新增 6 个 agent 事件：`agent_invoke` / `agent_auth` / `agent_authz_deny` / `agent_pii_violation` / `agent_rate_limit` / `agent_degradation`；高频 `agent_invoke` 另写 `agent_invocation_log` 快查集合（TTL 30 天）。
  - 凭证生命周期由 13 第 2 节定义：申请-审批-颁发-轮换-吊销-过期全流程，apiKey 仅存哈希。
  - agent 生态治理专项细节（限流配额矩阵、SLA、运营治理闭环）见 13。
- **v2.1 → v2.2**：
  - 新增 **第十二·补节 v2.2 新增合规要点**，含 4 子节：12.1 法律位阶分类（6 级枚举，LawValidityQuery `legalHierarchy` 字段权威源）/ 12.2 采集合规（数据源白名单 + robots.txt 强制尊重 + 反爬限速合规 + 公众号文章版权 4 子节）/ 12.3 外链免责（列表页/详情页/点击外链/归档文章 4 类强制免责）/ 12.4 工具免责（7 工具 disclaimer 文案 + 强制约束）。
  - 审计事件新增 4 个 v2.2 事件：`tool_invoke` / `tool_invoke_failed` / `crawl_job_run` / `crawl_source_blocked`。
  - 法规依据追加《著作权法》（采集合规涉及）。
  - 影响范围追加 14（工具）/ 15（采集）。
- **v2.2 → v2.3**：
  - 新增 **第十二·补二节 v2.3 新增合规要点**，含 3 子节：12.5 数据可携带权（《个人信息保护法》第 45 条，DataExportService 聚合→脱敏→打包→云存储回链 7 天，对应 `data_export_request` 集合 05 3.31）/ 12.6 敏感操作二次校验（SensitiveOpVerifier 微信生物识别/短信验证码，失败返回 8012，11 编排伪代码已含 `sensitiveOpVerifier.verify` 钩子）/ 12.7 合规风险监控（ComplianceMonitor 三路评分 pass/warn/block，block 级返回 8013 + 审计 `compliance_blocked`，对应 `compliance_alert` 集合 05 3.32）。
  - 审计事件新增 5 个 v2.3 事件：`data_export` / `compliance_blocked` / `lawyer_review_submit` / `answer_scored` / `annotation_reflowed`（律师审核相关 3 个详见 17）。
  - 12.4 工具免责表追加 ClauseRecommender（第 8 工具）disclaimer 行。
  - 法规依据追加《个人信息保护法》第 45 条（数据可携带权）。
  - 影响范围追加 16（推理引用法条时效）/ 17（律师审核评估）。
  - 合规风险监控闭环详见 17 第五节。
