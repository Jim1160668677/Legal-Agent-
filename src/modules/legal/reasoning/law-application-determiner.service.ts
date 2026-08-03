/**
 * LawApplicationDeterminerService —— 法条适用判定算法（v2.3-W5，16 §4）。
 *
 * 算法（16 §4.2）：
 *   1. 构成要件抽取：
 *      a. rule.conditions 已结构化（非空数组）→ 直接使用
 *      b. 未结构化 → LLM 辅助抽取（prompt: "请从法条文本中抽取构成要件列表"）
 *      c. 抽取失败 → 抛 8019 + 降级为 LLM 整体判定
 *   2. 事实匹配（逐要件）：
 *      for condition in conditions:
 *        matchResult = matchCondition(condition, factEntities)  // LLM 判定 yes/no/partial
 *        yes → matchedFacts.push(condition)
 *        partial → matchedFacts.push(condition + '(部分)')
 *        no → unmatchedFacts.push(condition)
 *   3. 聚合判定：
 *      全 matched 无 partial → applicable
 *      含 partial 或部分 unmatched → partial
 *      关键要件 unmatched（无法判定时保守）→ false
 *
 * 错误码（16 §4.3）：
 *   - 8019：法条适用判定要件不足（构成要件抽取失败，降级为 LLM 整体判定）
 *
 * 边界（16 §4.4）：
 *   - rule 无 conditions 且 LLM 不可用 → partial + warnings"法条构成要件无法解析"
 *   - factEntities 缺失关键实体 → partial + unmatchedFacts 含"事实信息不足"
 *
 * 设计依据：16 §4 法条适用判定算法；07 §9.3；04 §1.12 LawApplicationDeterminer。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { LlmService } from '../../../types/llm';
import type { ChatMessage } from '../../../types/llm';
import { LLM_SERVICE_TOKEN } from '../intent/intent-router.service';
import { AppLoggerService } from '../../platform/logger/logger.service';
import type { Entity } from '../nlu/nlu.types';
import type {
  ConditionMatch,
  FactMatch,
  LawApplicationInput,
  LawApplicationResult,
  ParsedArticle,
} from './reasoning.types';
import { REASONING_ERROR_CODES } from './reasoning.types';

/** LLM 抽取构成要件的 system prompt */
const EXTRACT_CONDITIONS_SYSTEM_PROMPT =
  '你是法律分析专家。请从法条文本中抽取构成要件列表与法律后果列表。\n' +
  '构成要件是指法律行为成立或生效所必须具备的条件；法律后果是指满足要件后产生的法律效果。\n' +
  '请输出 JSON: { "conditions": ["要件1", "要件2", ...], "legalConsequences": ["后果1", ...] }';

/** LLM 判定单要件匹配的 system prompt */
const MATCH_CONDITION_SYSTEM_PROMPT =
  '你是法律分析专家。请判定用户案情事实是否满足给定法条要件。\n' +
  '判定结果：yes（满足）/ no（不满足）/ partial（部分满足）。\n' +
  '请输出 JSON: { "result": "yes|no|partial", "reason": "简要说明" }';

/** LLM 整体判定（降级模式）的 system prompt */
const OVERALL_MATCH_SYSTEM_PROMPT =
  '你是法律分析专家。请基于法条文本与用户案情，整体判定法条是否适用于本案。\n' +
  '判定结果：applicable（适用）/ partial（部分适用）/ false（不适用）。\n' +
  '请输出 JSON: { "factMatch": "applicable|partial|false", "matchedFacts": [...], "unmatchedFacts": [...] }';

@Injectable()
export class LawApplicationDeterminerService {
  constructor(
    @Optional() @Inject(LLM_SERVICE_TOKEN) private readonly llm?: LlmService,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  /**
   * 判定法条适用性。
   * @returns LawApplicationResult，含 factMatch（applicable/partial/false）+ matchedFacts + unmatchedFacts
   */
  async determine(input: LawApplicationInput): Promise<LawApplicationResult> {
    const { rule, factEntities, caseDescription } = input;
    const warnings: string[] = [];

    // 1. 构成要件抽取
    const parsed = await this.extractConditions(rule);
    if (parsed.parseSource === 'failed') {
      // 16 §4.2 第 1.c 步：抽取失败 → 8019 + 降级为 LLM 整体判定
      warnings.push('法条构成要件抽取失败，降级为 LLM 整体判定');
      return this.fallbackOverallMatch(rule, factEntities, caseDescription, warnings);
    }

    if (parsed.parseSource === 'llm') {
      warnings.push('法条未结构化，已用 LLM 抽取构成要件');
    }

    const conditions = parsed.conditions;
    if (conditions.length === 0) {
      // 无构成要件 → 8019 + 降级整体判定
      warnings.push('法条无构成要件，降级为 LLM 整体判定');
      return this.fallbackOverallMatch(rule, factEntities, caseDescription, warnings);
    }

    // 2. 事实匹配（逐要件）
    const matchedFacts: string[] = [];
    const unmatchedFacts: string[] = [];
    let hasPartial = false;

    // 实体缺失检查
    const hasKeyEntities = this.hasKeyEntities(factEntities);
    if (!hasKeyEntities) {
      warnings.push('用户案情实体缺失关键信息');
    }

    for (const condition of conditions) {
      const matchResult = await this.matchCondition(
        condition,
        factEntities,
        caseDescription,
        !hasKeyEntities,
      );
      if (matchResult === 'yes') {
        matchedFacts.push(condition);
      } else if (matchResult === 'partial') {
        matchedFacts.push(`${condition}（部分）`);
        hasPartial = true;
      } else {
        // no 或未知
        if (!hasKeyEntities) {
          unmatchedFacts.push(`${condition}（事实信息不足）`);
        } else {
          unmatchedFacts.push(condition);
        }
      }
    }

    // 3. 聚合判定（16 §4.2 第 3 步）
    const factMatch = this.aggregateFactMatch(
      conditions.length,
      matchedFacts.length,
      unmatchedFacts.length,
      hasPartial,
    );

    return {
      factMatch,
      matchedFacts,
      unmatchedFacts,
      warnings,
    };
  }

  // ===== 内部辅助 =====

  /**
   * 构成要件抽取（16 §4.2 第 1 步）。
   * - rule.conditions 已结构化（非空数组）→ 直接用
   * - 未结构化 → LLM 抽取
   * - 抽取失败 → 返回 parseSource='failed'
   */
  private async extractConditions(rule: {
    conditions?: string[];
    articleText?: string;
  }): Promise<ParsedArticle> {
    // a. 已结构化
    if (rule.conditions && rule.conditions.length > 0) {
      return {
        conditions: rule.conditions,
        legalConsequences: [],
        parseSource: 'structured',
      };
    }

    // b. 未结构化 → LLM 抽取
    if (!this.llm) {
      // LLM 不可用 → 抽取失败
      return {
        conditions: [],
        legalConsequences: [],
        parseSource: 'failed',
      };
    }

    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: EXTRACT_CONDITIONS_SYSTEM_PROMPT },
        { role: 'user', content: `法条文本：${rule.articleText ?? ''}` },
      ];
      const result = await this.llm.generate(messages, {
        temperature: 0.1,
        maxTokens: 1000,
      });
      const parsed = this.parseConditionsJson(result.content);
      if (parsed.conditions.length === 0) {
        return {
          conditions: [],
          legalConsequences: [],
          parseSource: 'failed',
        };
      }
      return {
        conditions: parsed.conditions,
        legalConsequences: parsed.legalConsequences,
        parseSource: 'llm',
      };
    } catch (err) {
      this.logger?.warn('LLM 抽取构成要件失败', {
        articleText: (rule.articleText ?? '').slice(0, 80),
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        conditions: [],
        legalConsequences: [],
        parseSource: 'failed',
      };
    }
  }

  /**
   * 单要件事实匹配（16 §4.2 第 2 步）。
   * LLM 判定用户事实是否满足该要件。
   */
  private async matchCondition(
    condition: string,
    factEntities: Entity[],
    caseDescription?: string,
    entityInsufficient?: boolean,
  ): Promise<ConditionMatch> {
    if (!this.llm) {
      // LLM 不可用 → 用实体包含关系做规则匹配
      return this.ruleBasedMatch(condition, factEntities);
    }

    try {
      const factsText = this.formatFacts(factEntities, caseDescription, entityInsufficient);
      const messages: ChatMessage[] = [
        { role: 'system', content: MATCH_CONDITION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `法条要件：${condition}\n用户事实：${factsText}`,
        },
      ];
      const result = await this.llm.generate(messages, {
        temperature: 0.1,
        maxTokens: 200,
      });
      const parsed = this.parseMatchJson(result.content);
      return parsed;
    } catch (err) {
      this.logger?.warn('LLM 单要件匹配失败，降级为规则匹配', {
        condition,
        error: err instanceof Error ? err.message : String(err),
      });
      return this.ruleBasedMatch(condition, factEntities);
    }
  }

  /**
   * 规则匹配（LLM 不可用时的降级）。
   * 简化策略：检查 condition 中的关键词是否在实体值中出现。
   */
  private ruleBasedMatch(condition: string, factEntities: Entity[]): ConditionMatch {
    if (factEntities.length === 0) return 'no';
    // 提取 condition 中的关键词（2 字以上的中文词）
    const keywords = condition.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
    if (keywords.length === 0) return 'partial';

    const entityValues = factEntities.map((e) => e.value).join(' ');
    let matchCount = 0;
    for (const kw of keywords) {
      if (entityValues.includes(kw)) matchCount++;
    }
    if (matchCount === 0) return 'no';
    if (matchCount === keywords.length) return 'yes';
    return 'partial';
  }

  /**
   * 聚合判定（16 §4.2 第 3 步）。
   * - 全 matched 无 partial → applicable
   * - 含 partial 或部分 unmatched（非关键要件）→ partial
   * - 关键要件 unmatched → false
   *
   * 简化策略（无 required 标记）：unmatched 比例 ≥ 50% → false；否则 partial
   */
  private aggregateFactMatch(
    totalConditions: number,
    matchedCount: number,
    unmatchedCount: number,
    hasPartial: boolean,
  ): FactMatch {
    // 全 matched 无 partial → applicable
    if (unmatchedCount === 0 && !hasPartial) {
      return 'applicable';
    }
    // 含 partial 但无 unmatched → partial
    if (unmatchedCount === 0 && hasPartial) {
      return 'partial';
    }
    // 关键要件判定：unmatched 比例 ≥ 50% → false
    // matched 比例用于辅助判定（matched > 0 时不直接判 false）
    const matchedRatio = totalConditions > 0 ? matchedCount / totalConditions : 0;
    const unmatchedRatio = totalConditions > 0 ? unmatchedCount / totalConditions : 1;
    if (unmatchedRatio >= 0.5 && matchedRatio < 0.5) {
      return 'false';
    }
    return 'partial';
  }

  /**
   * 降级整体判定（8019 后的兜底，16 §4.2 第 1.c 步）。
   * LLM 整体判定法条适用性，无法判定时返回 partial。
   */
  private async fallbackOverallMatch(
    rule: { articleId?: string; articleText?: string },
    factEntities: Entity[],
    caseDescription: string | undefined,
    warnings: string[],
  ): Promise<LawApplicationResult> {
    if (!this.llm) {
      // LLM 也不可用 → 返回 partial + warnings
      return {
        factMatch: 'partial',
        matchedFacts: [],
        unmatchedFacts: ['法条构成要件无法解析，仅做整体判定'],
        degradedCode: REASONING_ERROR_CODES.INSUFFICIENT_LAW_APPLY,
        warnings: [...warnings, 'LLM 不可用，无法做整体判定，返回 partial'],
      };
    }

    try {
      const factsText = this.formatFacts(factEntities, caseDescription);
      const messages: ChatMessage[] = [
        { role: 'system', content: OVERALL_MATCH_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `法条文本：${rule.articleText ?? ''}\n用户事实：${factsText}`,
        },
      ];
      const result = await this.llm.generate(messages, {
        temperature: 0.2,
        maxTokens: 500,
      });
      const parsed = this.parseOverallMatchJson(result.content);
      return {
        factMatch: parsed.factMatch,
        matchedFacts: parsed.matchedFacts,
        unmatchedFacts: parsed.unmatchedFacts,
        degradedCode: REASONING_ERROR_CODES.INSUFFICIENT_LAW_APPLY,
        warnings,
      };
    } catch (err) {
      this.logger?.warn('LLM 整体判定失败，返回 partial', {
        articleId: rule.articleId ?? 'unknown',
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        factMatch: 'partial',
        matchedFacts: [],
        unmatchedFacts: ['LLM 整体判定失败'],
        degradedCode: REASONING_ERROR_CODES.INSUFFICIENT_LAW_APPLY,
        warnings: [
          ...warnings,
          `LLM 整体判定失败：${err instanceof Error ? err.message : String(err)}`,
        ],
      };
    }
  }

  /** 检查是否含关键实体（案由/金额/日期至少一个） */
  private hasKeyEntities(entities: Entity[]): boolean {
    if (entities.length === 0) return false;
    return entities.some(
      (e) =>
        e.type === 'case_cause' ||
        e.type === 'amount' ||
        e.type === 'date' ||
        e.type === 'contract',
    );
  }

  /** 格式化事实信息供 LLM 判定 */
  private formatFacts(
    entities: Entity[],
    caseDescription?: string,
    entityInsufficient?: boolean,
  ): string {
    const parts: string[] = [];
    if (caseDescription) parts.push(`案情描述：${caseDescription}`);
    if (entities.length > 0) {
      const entityText = entities.map((e) => `${e.type}=${e.value}`).join('；');
      parts.push(`抽取实体：${entityText}`);
    }
    if (entityInsufficient) {
      parts.push('提示：用户案情实体缺失关键信息，部分要件可能无法精确判定');
    }
    return parts.join('\n') || '（无明确事实信息）';
  }

  // ===== LLM JSON 解析容错（参考 NLU L3 模式）=====

  /** 解析 LLM 返回的构成要件 JSON */
  private parseConditionsJson(content: string): {
    conditions: string[];
    legalConsequences: string[];
  } {
    const json = this.extractJson(content);
    if (!json) {
      return { conditions: [], legalConsequences: [] };
    }
    const conditions = Array.isArray(json.conditions)
      ? json.conditions.filter(
          (c: unknown): c is string => typeof c === 'string' && c.trim().length > 0,
        )
      : [];
    const legalConsequences = Array.isArray(json.legalConsequences)
      ? json.legalConsequences.filter(
          (c: unknown): c is string => typeof c === 'string' && c.trim().length > 0,
        )
      : [];
    return { conditions, legalConsequences };
  }

  /** 解析 LLM 返回的单要件匹配 JSON */
  private parseMatchJson(content: string): ConditionMatch {
    const json = this.extractJson(content);
    if (!json || typeof json.result !== 'string') {
      return 'partial';
    }
    const result = json.result.toLowerCase();
    if (result === 'yes' || result === 'no' || result === 'partial') {
      return result;
    }
    return 'partial';
  }

  /** 解析 LLM 返回的整体判定 JSON */
  private parseOverallMatchJson(content: string): {
    factMatch: FactMatch;
    matchedFacts: string[];
    unmatchedFacts: string[];
  } {
    const json = this.extractJson(content);
    if (!json) {
      return { factMatch: 'partial', matchedFacts: [], unmatchedFacts: [] };
    }
    const factMatch =
      json.factMatch === 'applicable' || json.factMatch === 'partial' || json.factMatch === 'false'
        ? json.factMatch
        : 'partial';
    const matchedFacts = Array.isArray(json.matchedFacts)
      ? json.matchedFacts.filter((c: unknown): c is string => typeof c === 'string')
      : [];
    const unmatchedFacts = Array.isArray(json.unmatchedFacts)
      ? json.unmatchedFacts.filter((c: unknown): c is string => typeof c === 'string')
      : [];
    return { factMatch, matchedFacts, unmatchedFacts };
  }

  /**
   * JSON 提取容错（参考 entity-extractor.service.ts L3 模式）。
   * 1. 直接 JSON.parse
   * 2. 失败则正则提取 {...}
   * 3. 仍失败返回 null
   */
  private extractJson(content: string): Record<string, unknown> | null {
    // 1. 直接解析
    try {
      return JSON.parse(content);
    } catch {
      // continue
    }
    // 2. 正则提取
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
