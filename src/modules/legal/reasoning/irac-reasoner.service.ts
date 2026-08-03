/**
 * IracReasonerService —— IRAC 四步法律推理编排（v2.3-W5，16 §2）。
 *
 * 推理步骤（16 §2.1-2.4）：
 *   1. Issue（争议点识别）：
 *      - 输入：用户问题 + 实体抽取结果（来自 nlu Agent EntityExtractor）
 *      - LLM prompt → issues[] = { issueText, issueType, relatedLaws[] }
 *      - 后处理：relatedLaws 核实（RagService 召回比对）+ issueType 归一化 + 空降级（关键词匹配）
 *   2. Rule（法条规则抽取）：
 *      - for issue: recallKey = issueText + issueType
 *      - articles = RagService.retrieve({ text: recallKey, collections: ['law_article'], finalTopK: 5 })
 *      - 扩展召回：CitationGraphBuilder.getGraph(articleId) 找引用关系法条
 *      - 时效校验：过滤 status=repealed + warnings
 *      - parseArticle：article.structured.conditions 已有→直接用；否则标记待 LLM 抽取
 *      - 输出 rules[] = { articleId, articleText, conditions[], legalConsequences[] }
 *   3. Application（事实映射）：
 *      - for rule: LawApplicationDeterminer.determine(rule, factEntities)
 *      - 输出 applications[] = { ruleId, factMatch, matchedFacts[], unmatchedFacts[] }
 *   4. Conclusion（综合结论）：
 *      - LLM prompt（含 applications[] JSON）→ conclusion = { summary, confidence, riskLevel, disclaimer, lawRefs[] }
 *      - 后处理：confidence ∈ [0,1]；riskLevel 枚举；强制附加免责声明；lawRefs 聚合
 *      - 写入 reasoning_chain 集合
 *
 * 降级策略（16 §7）：
 *   - LLM 全失败 → 跳过 IRAC，仅返回 RagService 召回法条 + 案例列表 + 免责声明（degraded='llm_unavailable'）
 *   - LLM 仅 Application 失败 → 跳过 Application，Conclusion 基于规则匹配，confidence 降至 0.3（degraded='application_skipped'）
 *   - reasoning_chain 写入失败 → 结果仍返回，reasoningChainId 为空 + 告警
 *
 * 设计依据：16 §2 IRAC 推理框架；07 §9.1；04 §1.12 IracReasoner。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { LlmService } from '../../../types/llm';
import type { ChatMessage } from '../../../types/llm';
import { LLM_SERVICE_TOKEN } from '../intent/intent-router.service';
import { RagService } from '../retrieval/rag.service';
import { CitationGraphBuilderService } from '../knowledge/citation-graph-builder.service';
import { AppLoggerService } from '../../platform/logger/logger.service';
import type { Entity } from '../nlu/nlu.types';
import {
  ReasoningChain,
  type ReasoningChainDocument,
  type ReasoningApplication,
  type ReasoningConclusion,
  type ReasoningIssue,
  type ReasoningRule,
} from '../../../infra/database/schemas/reasoning-chain.schema';
import type {
  Application,
  Conclusion,
  IracReasonInput,
  IracReasonResult,
  Issue,
  IssueType,
  Rule,
} from './reasoning.types';
import {
  IRAC_DISCLAIMER_SUFFIX,
  IRAC_PROMPT_VERSION,
  ISSUE_KEYWORD_MAP,
  ISSUE_TYPES,
  RISK_LEVELS,
} from './reasoning.types';
import { LawApplicationDeterminerService } from './law-application-determiner.service';

/** Issue 步 LLM system prompt（16 §2.1） */
const ISSUE_SYSTEM_PROMPT =
  '你是法律分析专家。请从用户问题中识别法律争议点，每个争议点标注类型与关联法条。\n' +
  'issueType 必须为以下之一：contract_dispute / tort / property / family / labor / criminal / administrative / other\n' +
  '请输出 JSON: { "issues": [{ "issueText": "争议点描述", "issueType": "枚举值", "relatedLaws": ["法条标识"] }] }';

/** Conclusion 步 LLM system prompt（16 §2.4） */
const CONCLUSION_SYSTEM_PROMPT =
  '你是法律分析专家。请基于法条适用判定结果，综合给出结论。\n' +
  '结论须包含：总结、置信度（0-1）、风险等级（low/medium/high）、免责声明、引用法条列表。\n' +
  '请输出 JSON: { "summary": "...", "confidence": 0.0-1.0, "riskLevel": "low|medium|high", "lawRefs": ["articleId"] }\n' +
  '注意：disclaimer 字段由系统强制附加，你无需输出。';

/** Conclusion 步 LLM 不可用时的兜底提示 */
const FALLBACK_CONCLUSION_SUMMARY =
  '由于推理服务暂时不可用，无法生成完整结论。请参考下列法条与案例，或咨询专业律师。';

@Injectable()
export class IracReasonerService {
  constructor(
    @Optional() @Inject(LLM_SERVICE_TOKEN) private readonly llm?: LlmService,
    @Optional() private readonly rag?: RagService,
    @Optional() private readonly lawApplicationDeterminer?: LawApplicationDeterminerService,
    @Optional() private readonly citationGraph?: CitationGraphBuilderService,
    @Optional()
    @InjectModel(ReasoningChain.name)
    private readonly chainModel?: Model<ReasoningChainDocument>,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  /**
   * 执行 IRAC 四步推理。
   * @returns IracReasonResult，含 issues/rules/applications/conclusion + reasoningChainId
   */
  async reason(input: IracReasonInput): Promise<IracReasonResult> {
    const { caseDescription, question, entities = [], retrievedContext, ctx } = input;
    const warnings: string[] = [];
    let tokensIn = 0;
    let tokensOut = 0;

    // ===== LLM 全失败降级路径（16 §7 第 1 条）=====
    if (!this.llm) {
      warnings.push('LlmService 未注入，跳过 IRAC，仅返回召回结果');
      return this.fallbackNoLlm(caseDescription, ctx, warnings);
    }

    // ===== 步骤 1：Issue 争议点识别（16 §2.1）=====
    let issues: Issue[] = [];
    try {
      const issueResult = await this.identifyIssues(caseDescription, question, entities);
      issues = issueResult.issues;
      tokensIn += issueResult.tokensIn;
      tokensOut += issueResult.tokensOut;
      warnings.push(...issueResult.warnings);
    } catch (err) {
      warnings.push(
        `Issue 步骤失败：${err instanceof Error ? err.message : String(err)}，降级为关键词匹配`,
      );
      issues = this.fallbackIssues(caseDescription);
    }

    if (issues.length === 0) {
      // 仍无 issues → 用关键词降级
      issues = this.fallbackIssues(caseDescription);
      if (issues.length === 0) {
        warnings.push('无法识别争议点，返回空推理');
        return this.emptyResult(ctx, warnings, tokensIn, tokensOut);
      }
    }

    // ===== 步骤 2：Rule 法条规则抽取（16 §2.2）=====
    let rules: Rule[] = [];
    try {
      const ruleResult = await this.extractRules(issues, retrievedContext, warnings);
      rules = ruleResult;
    } catch (err) {
      warnings.push(`Rule 步骤失败：${err instanceof Error ? err.message : String(err)}，规则为空`);
      rules = [];
    }

    // ===== 步骤 3：Application 事实映射（16 §2.3）=====
    let applications: Application[] = [];
    let applicationSkipped = false;
    if (rules.length === 0) {
      warnings.push('无法条规则，跳过 Application 步骤');
      applicationSkipped = true;
    } else if (!this.lawApplicationDeterminer) {
      warnings.push('LawApplicationDeterminer 未注入，跳过 Application 步骤');
      applicationSkipped = true;
    } else {
      try {
        const appResult = await this.mapApplications(rules, entities, caseDescription);
        applications = appResult.applications;
        warnings.push(...appResult.warnings);
      } catch (err) {
        warnings.push(
          `Application 步骤失败：${err instanceof Error ? err.message : String(err)}，跳过 Application`,
        );
        applicationSkipped = true;
      }
    }

    // ===== 步骤 4：Conclusion 综合结论（16 §2.4）=====
    let conclusion: Conclusion;
    try {
      const concResult = await this.generateConclusion(
        issues,
        rules,
        applications,
        applicationSkipped,
        caseDescription,
        question,
      );
      conclusion = concResult.conclusion;
      tokensIn += concResult.tokensIn;
      tokensOut += concResult.tokensOut;
      warnings.push(...concResult.warnings);
    } catch (err) {
      warnings.push(
        `Conclusion 步骤失败：${err instanceof Error ? err.message : String(err)}，使用兜底结论`,
      );
      conclusion = this.fallbackConclusion(rules, applications, applicationSkipped);
    }

    // ===== 持久化 reasoning_chain（16 §6）=====
    const reasoningChainId = await this.persistChain({
      chainId: this.generateChainId(),
      msgId: ctx.msgId,
      userId: ctx.userId,
      issues,
      rules,
      applications,
      conclusion,
      modelVersion: 'qwen-v1',
      promptVersion: IRAC_PROMPT_VERSION,
    }).catch((err) => {
      warnings.push(
        `reasoning_chain 写入失败：${err instanceof Error ? err.message : String(err)}，结果仍返回`,
      );
      return undefined;
    });

    const degraded: IracReasonResult['degraded'] = applicationSkipped
      ? 'application_skipped'
      : 'none';

    return {
      issues,
      rules,
      applications,
      conclusion,
      reasoningChainId,
      degraded,
      warnings,
      modelVersion: 'qwen-v1',
      promptVersion: IRAC_PROMPT_VERSION,
      tokensIn,
      tokensOut,
    };
  }

  // ===== 步骤 1：Issue 争议点识别（16 §2.1）=====

  /** LLM 识别争议点 */
  private async identifyIssues(
    caseDescription: string,
    question: string | undefined,
    entities: Entity[],
  ): Promise<{ issues: Issue[]; tokensIn: number; tokensOut: number; warnings: string[] }> {
    const warnings: string[] = [];
    const entityText = entities.map((e) => `${e.type}=${e.value}`).join('；');
    const userPrompt = [
      `用户问题：${question ?? caseDescription}`,
      `案情描述：${caseDescription}`,
      entityText ? `已抽取实体：${entityText}` : '',
      '请识别法律争议点。',
    ]
      .filter(Boolean)
      .join('\n');

    const messages: ChatMessage[] = [
      { role: 'system', content: ISSUE_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    const result = await this.llm!.generate(messages, {
      temperature: 0.2,
      maxTokens: 1000,
    });

    const parsed = this.parseIssuesJson(result.content);

    // 后处理（16 §2.1 第 3 步）
    const issues: Issue[] = [];
    for (const raw of parsed) {
      // a. relatedLaws 核实存在性（RagService 召回比对，无法核实时移除 + warnings）
      const verifiedLaws: string[] = [];
      for (const law of raw.relatedLaws ?? []) {
        const exists = await this.verifyArticleId(law);
        if (exists) {
          verifiedLaws.push(law);
        } else {
          warnings.push(`法条 ${law} 不存在，已移除`);
        }
      }

      // b. issueType 归一化
      const issueType = this.normalizeIssueType(raw.issueType);

      issues.push({
        issueText: raw.issueText ?? '',
        issueType,
        relatedLaws: verifiedLaws,
      });
    }

    return {
      issues,
      tokensIn: result.usage.promptTokens,
      tokensOut: result.usage.completionTokens,
      warnings,
    };
  }

  /** 关键词降级识别争议点（16 §2.1 边界条件） */
  private fallbackIssues(text: string): Issue[] {
    const issues: Issue[] = [];
    const foundTypes = new Set<IssueType>();
    for (const [keyword, issueType] of Object.entries(ISSUE_KEYWORD_MAP)) {
      if (text.includes(keyword) && !foundTypes.has(issueType)) {
        foundTypes.add(issueType);
        issues.push({
          issueText: `${keyword}相关争议`,
          issueType,
          relatedLaws: [],
        });
      }
    }
    if (issues.length === 0) {
      issues.push({
        issueText: '待识别争议点',
        issueType: 'other',
        relatedLaws: [],
      });
    }
    return issues;
  }

  /** issueType 归一化到枚举（16 §2.1 第 3.c 步） */
  private normalizeIssueType(raw: unknown): IssueType {
    if (typeof raw === 'string') {
      const lower = raw.toLowerCase();
      if (ISSUE_TYPES.includes(lower as IssueType)) {
        return lower as IssueType;
      }
      // 中文映射
      const cnMap: Record<string, IssueType> = {
        合同: 'contract_dispute',
        侵权: 'tort',
        物权: 'property',
        婚姻: 'family',
        家庭: 'family',
        劳动: 'labor',
        刑事: 'criminal',
        行政: 'administrative',
      };
      for (const [k, v] of Object.entries(cnMap)) {
        if (raw.includes(k)) return v;
      }
    }
    return 'other';
  }

  /** 法条 ID 核实存在性（RagService 召回比对） */
  private async verifyArticleId(articleId: string): Promise<boolean> {
    if (!this.rag) return true; // RagService 不可用时跳过校验
    try {
      const results = await this.rag.retrieve({
        text: articleId,
        collections: ['law_article'],
        finalTopK: 1,
      });
      return results.length > 0;
    } catch {
      return true; // 校验失败时保守保留
    }
  }

  // ===== 步骤 2：Rule 法条规则抽取（16 §2.2）=====

  /** 抽取法条规则（含召回 + 扩展 + 时效校验 + parseArticle） */
  private async extractRules(
    issues: Issue[],
    retrievedContext: string | undefined,
    warnings: string[],
  ): Promise<Rule[]> {
    const rules: Rule[] = [];
    const seenArticleIds = new Set<string>();

    // 编排器并行召回的上下文优先（已含法条文本时直接解析）
    if (retrievedContext) {
      // 简化处理：retrievedContext 作为补充信息，不直接解析为 rules
      // 真正的法条规则仍由 RagService 召回获取
    }

    for (const issue of issues) {
      const recallKey = `${issue.issueText} ${issue.issueType}`;

      // 1.2 RagService 召回法条 top 5
      let articles: Array<{
        id: string;
        content: string;
        title?: string;
        status?: string;
      }> = [];
      if (this.rag) {
        try {
          const results = await this.rag.retrieve({
            text: recallKey,
            collections: ['law_article'],
            finalTopK: 5,
          });
          articles = results.map((r) => ({
            id: r.id,
            content: r.content,
            title: r.title,
            status: (r.meta?.status as string) ?? undefined,
          }));
        } catch (err) {
          warnings.push(
            `RagService 召回法条失败（issue=${issue.issueText}）：${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // 1.3 扩展召回：CitationGraphBuilder 找引用关系法条
      if (this.citationGraph && issue.relatedLaws.length > 0) {
        try {
          for (const lawId of issue.relatedLaws) {
            const graph = this.citationGraph.getGraph(lawId);
            if (graph && graph.citingCaseIds.length > 0) {
              // 引用图谱记录的是案例/文书，不直接补法条；此处仅记录引用热度
              // 真正的扩展召回应查 law_citation_graph 的 citedCount 排序
            }
          }
        } catch (err) {
          warnings.push(
            `CitationGraph 扩展召回失败：${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // 1.4-1.7 时效校验 + parseArticle + 构建 Rule
      for (const article of articles) {
        if (seenArticleIds.has(article.id)) continue;
        seenArticleIds.add(article.id);

        // 时效校验：过滤 status=repealed
        if (article.status === 'repealed') {
          warnings.push(`法条 ${article.id} 已废止，已过滤`);
          continue;
        }

        // parseArticle：当前 LawArticle schema 无 conditions/consequences 字段
        // → conditions/legalConsequences 留空，由 LawApplicationDeterminer LLM 抽取
        rules.push({
          articleId: article.id,
          articleText: article.content,
          conditions: [], // 待 Application 步骤 LLM 抽取
          legalConsequences: [], // 同上
          status: (article.status as 'effective' | 'repealed' | 'amended') ?? 'effective',
        });
      }
    }

    return rules;
  }

  // ===== 步骤 3：Application 事实映射（16 §2.3 + §4）=====

  /** 事实映射：对每条 rule 调 LawApplicationDeterminer.determine */
  private async mapApplications(
    rules: Rule[],
    entities: Entity[],
    caseDescription: string | undefined,
  ): Promise<{ applications: Application[]; warnings: string[] }> {
    const applications: Application[] = [];
    const warnings: string[] = [];

    for (const rule of rules) {
      try {
        const result = await this.lawApplicationDeterminer!.determine({
          rule,
          factEntities: entities,
          caseDescription,
        });
        applications.push({
          ruleId: rule.articleId,
          factMatch: result.factMatch,
          matchedFacts: result.matchedFacts,
          unmatchedFacts: result.unmatchedFacts,
        });
        warnings.push(...result.warnings);
      } catch (err) {
        warnings.push(
          `法条 ${rule.articleId} 适用判定失败：${err instanceof Error ? err.message : String(err)}`,
        );
        applications.push({
          ruleId: rule.articleId,
          factMatch: 'partial',
          matchedFacts: [],
          unmatchedFacts: ['判定失败'],
        });
      }
    }

    return { applications, warnings };
  }

  // ===== 步骤 4：Conclusion 综合结论（16 §2.4）=====

  /** LLM 生成综合结论 */
  private async generateConclusion(
    issues: Issue[],
    rules: Rule[],
    applications: Application[],
    applicationSkipped: boolean,
    caseDescription: string,
    question: string | undefined,
  ): Promise<{ conclusion: Conclusion; tokensIn: number; tokensOut: number; warnings: string[] }> {
    const warnings: string[] = [];

    // 16 §2.4：LLM 不可用（仅 Application 步）→ confidence 降至 0.3
    if (!this.llm) {
      return {
        conclusion: this.fallbackConclusion(rules, applications, applicationSkipped),
        tokensIn: 0,
        tokensOut: 0,
        warnings: [...warnings, 'LlmService 不可用，使用兜底结论'],
      };
    }

    const userPrompt = [
      `用户问题：${question ?? caseDescription}`,
      `争议点：${issues.map((i) => i.issueText).join('；')}`,
      `适用法条：${rules.map((r) => r.articleId).join('；')}`,
      `法条适用判定结果：${JSON.stringify(applications)}`,
      applicationSkipped ? '注意：Application 步骤已跳过，请基于规则匹配直接生成结论。' : '',
      '请综合给出结论。',
    ]
      .filter(Boolean)
      .join('\n');

    const messages: ChatMessage[] = [
      { role: 'system', content: CONCLUSION_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    const result = await this.llm.generate(messages, {
      temperature: 0.3,
      maxTokens: 1500,
    });

    const parsed = this.parseConclusionJson(result.content);

    // 后处理（16 §2.4 第 3 步）
    // a. confidence 归一化到 [0, 1]
    let confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
    confidence = Math.max(0, Math.min(1, confidence));

    // Application 跳过时强制降至 0.3（16 §7 第 2 条）
    if (applicationSkipped && confidence > 0.3) {
      warnings.push('Application 步骤已跳过，置信度强制降至 0.3');
      confidence = 0.3;
    }

    // b. riskLevel 归一化
    const riskLevel = RISK_LEVELS.includes(parsed.riskLevel as never)
      ? (parsed.riskLevel as Conclusion['riskLevel'])
      : this.inferRiskLevel(confidence);

    // c. disclaimer 强制附加
    const disclaimer = IRAC_DISCLAIMER_SUFFIX;

    // d. lawRefs 从 applications 中聚合所有 applicable/partial 的 rule.articleId
    const lawRefs = applications
      .filter((a) => a.factMatch === 'applicable' || a.factMatch === 'partial')
      .map((a) => a.ruleId);
    // 合并 LLM 输出的 lawRefs
    const llmLawRefs = Array.isArray(parsed.lawRefs) ? parsed.lawRefs : [];
    const mergedLawRefs = [
      ...new Set([...lawRefs, ...llmLawRefs.filter((l) => typeof l === 'string')]),
    ];

    const conclusion: Conclusion = {
      summary: parsed.summary ?? '（LLM 未返回总结）',
      confidence,
      riskLevel,
      disclaimer,
      lawRefs: mergedLawRefs,
    };

    return {
      conclusion,
      tokensIn: result.usage.promptTokens,
      tokensOut: result.usage.completionTokens,
      warnings,
    };
  }

  /** 兜底结论（LLM 不可用时） */
  private fallbackConclusion(
    rules: Rule[],
    applications: Application[],
    applicationSkipped: boolean,
  ): Conclusion {
    // 合并 rules 的 articleId 与 applications 中 applicable/partial 的 ruleId
    const lawRefs = [
      ...rules.map((r) => r.articleId),
      ...applications
        .filter((a) => a.factMatch === 'applicable' || a.factMatch === 'partial')
        .map((a) => a.ruleId),
    ];
    return {
      summary: FALLBACK_CONCLUSION_SUMMARY,
      confidence: applicationSkipped ? 0.3 : 0.4,
      riskLevel: 'high',
      disclaimer: IRAC_DISCLAIMER_SUFFIX,
      lawRefs,
    };
  }

  /** 根据置信度推断风险等级（16 §2.4 置信度参考表） */
  private inferRiskLevel(confidence: number): Conclusion['riskLevel'] {
    if (confidence >= 0.8) return 'low';
    if (confidence >= 0.5) return 'medium';
    return 'high';
  }

  // ===== LLM 全失败降级（16 §7 第 1 条）=====

  private async fallbackNoLlm(
    caseDescription: string,
    ctx: { userId: string; msgId: string },
    warnings: string[],
  ): Promise<IracReasonResult> {
    this.logger?.warn('LLM 不可用，降级为仅 RagService 召回', {
      userId: ctx.userId,
      msgId: ctx.msgId,
    });
    // 仅返回 RagService 召回法条 + 案例列表 + 免责声明
    const rules: Rule[] = [];
    if (this.rag) {
      try {
        const results = await this.rag.retrieve({
          text: caseDescription,
          collections: ['law_article'],
          finalTopK: 5,
        });
        for (const r of results) {
          rules.push({
            articleId: r.id,
            articleText: r.content,
            conditions: [],
            legalConsequences: [],
            status: ((r.meta?.status as string) ?? 'effective') as Rule['status'],
          });
        }
      } catch (err) {
        warnings.push(`RagService 召回失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const conclusion: Conclusion = {
      summary: FALLBACK_CONCLUSION_SUMMARY,
      confidence: 0.2,
      riskLevel: 'high',
      disclaimer: IRAC_DISCLAIMER_SUFFIX,
      lawRefs: rules.map((r) => r.articleId),
    };

    return {
      issues: [],
      rules,
      applications: [],
      conclusion,
      reasoningChainId: undefined,
      degraded: 'llm_unavailable',
      warnings: [...warnings, 'LLM 不可用，跳过 IRAC 推理'],
      modelVersion: undefined,
      promptVersion: IRAC_PROMPT_VERSION,
      tokensIn: 0,
      tokensOut: 0,
    };
  }

  /** 空结果（无争议点） */
  private emptyResult(
    ctx: { userId: string; msgId: string },
    warnings: string[],
    tokensIn: number,
    tokensOut: number,
  ): IracReasonResult {
    this.logger?.warn('IRAC 推理未识别到争议点，返回空结果', {
      userId: ctx.userId,
      msgId: ctx.msgId,
    });
    return {
      issues: [],
      rules: [],
      applications: [],
      conclusion: {
        summary: '无法识别争议点，请提供更详细的案情描述。',
        confidence: 0.2,
        riskLevel: 'high',
        disclaimer: IRAC_DISCLAIMER_SUFFIX,
        lawRefs: [],
      },
      reasoningChainId: undefined,
      degraded: 'none',
      warnings,
      modelVersion: 'qwen-v1',
      promptVersion: IRAC_PROMPT_VERSION,
      tokensIn,
      tokensOut,
    };
  }

  // ===== 持久化 reasoning_chain（16 §6）=====

  /** 写入 reasoning_chain 集合 */
  private async persistChain(record: {
    chainId: string;
    msgId: string;
    userId: string;
    issues: Issue[];
    rules: Rule[];
    applications: Application[];
    conclusion: Conclusion;
    modelVersion?: string;
    promptVersion: string;
  }): Promise<string | undefined> {
    if (!this.chainModel) {
      this.logger?.debug('reasoning_chain Model 未注入，跳过持久化');
      return undefined;
    }

    const doc = {
      chainId: record.chainId,
      msgId: record.msgId,
      userId: record.userId,
      issues: record.issues.map((i) => this.toSchemaIssue(i)),
      rules: record.rules.map((r) => this.toSchemaRule(r)),
      applications: record.applications.map((a) => this.toSchemaApplication(a)),
      conclusion: this.toSchemaConclusion(record.conclusion),
      modelVersion: record.modelVersion,
      promptVersion: record.promptVersion,
      expireAt: new Date(Date.now() + 180 * 24 * 3600 * 1000),
    };

    try {
      await this.chainModel.create(doc);
      this.logger?.info('reasoning_chain 写入成功', {
        chainId: record.chainId,
        msgId: record.msgId,
        issueCount: record.issues.length,
        ruleCount: record.rules.length,
      });
      return record.chainId;
    } catch (err) {
      this.logger?.warn('reasoning_chain 写入失败', {
        chainId: record.chainId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /** 生成 chainId（rc_<uuid>） */
  private generateChainId(): string {
    return `rc_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  }

  // ===== 类型转换（运行时类型 → Schema 类型）=====

  private toSchemaIssue(i: Issue): ReasoningIssue {
    return {
      issueText: i.issueText,
      issueType: i.issueType,
      relatedLaws: i.relatedLaws,
    };
  }

  private toSchemaRule(r: Rule): ReasoningRule {
    return {
      articleId: r.articleId,
      articleText: r.articleText,
      conditions: r.conditions,
      legalConsequences: r.legalConsequences,
    };
  }

  private toSchemaApplication(a: Application): ReasoningApplication {
    return {
      ruleId: a.ruleId,
      factMatch: a.factMatch,
      matchedFacts: a.matchedFacts,
      unmatchedFacts: a.unmatchedFacts,
    };
  }

  private toSchemaConclusion(c: Conclusion): ReasoningConclusion {
    return {
      summary: c.summary,
      confidence: c.confidence,
      riskLevel: c.riskLevel,
      disclaimer: c.disclaimer,
      lawRefs: c.lawRefs,
    };
  }

  // ===== LLM JSON 解析容错（参考 NLU L3 模式）=====

  /** 解析 Issue 步 LLM 返回的 JSON */
  private parseIssuesJson(
    content: string,
  ): Array<{ issueText?: string; issueType?: string; relatedLaws?: string[] }> {
    const json = this.extractJson(content);
    if (!json || !Array.isArray(json.issues)) {
      return [];
    }
    return json.issues
      .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
      .map((r) => ({
        issueText: typeof r.issueText === 'string' ? r.issueText : undefined,
        issueType: typeof r.issueType === 'string' ? r.issueType : undefined,
        relatedLaws: Array.isArray(r.relatedLaws)
          ? r.relatedLaws.filter((x): x is string => typeof x === 'string')
          : [],
      }));
  }

  /** 解析 Conclusion 步 LLM 返回的 JSON */
  private parseConclusionJson(content: string): {
    summary?: string;
    confidence?: number;
    riskLevel?: string;
    lawRefs?: string[];
  } {
    const json = this.extractJson(content);
    if (!json) {
      return {};
    }
    return {
      summary: typeof json.summary === 'string' ? json.summary : undefined,
      confidence: typeof json.confidence === 'number' ? json.confidence : undefined,
      riskLevel: typeof json.riskLevel === 'string' ? json.riskLevel.toLowerCase() : undefined,
      lawRefs: Array.isArray(json.lawRefs)
        ? json.lawRefs.filter((x): x is string => typeof x === 'string')
        : undefined,
    };
  }

  /** JSON 提取容错（参考 entity-extractor.service.ts L3 模式） */
  private extractJson(content: string): Record<string, unknown> | null {
    try {
      return JSON.parse(content);
    } catch {
      // continue
    }
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // continue
      }
    }
    return null;
  }
}
