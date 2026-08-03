/**
 * EntityExtractorService —— 四层实体抽取（v2.3-W4，07 §8.1）。
 *
 * 职责：
 *   1. L1 正则层：抽取日期/金额/身份证/电话/法条引用/合同等结构化实体
 *   2. L2 词典层：抽取当事人角色 + 法律术语（PARTY_ROLE_TERMS / LEGAL_TERM_DICT）
 *   3. L3 LLM NER：调用 LLM 抽取复杂命名实体（人名/机构/案由），L3 失败仅返回 L1+L2 并标 8010
 *   4. L4 上下文消解：代词（他/她/其）→ 上一轮实体，source='coref'
 *
 * 架构（参考 CitationGraphBuilder：内存优先 + DB 持久化）：
 *   - @Optional() 注入 LlmService（缺时仅 L1+L2，标 degradedCode 8010）
 *   - @Optional() 注入 EntityExtraction Model（缺时仅内存，单测友好）
 *   - extract() 写入 DB 持久化（异步），loadLastTurn() 跨轮消解时按 userId 查最近一条
 *
 * 降级策略：
 *   - LLM 不可用 / 调用失败 / JSON 解析失败 → 仅返回 L1+L2 + degradedCode=8010 + warnings
 *   - DB 写入失败 → 跳过 + 日志告警，不影响主流程
 *
 * 设计依据：07 §8.1 第 1-7 步；05 3.24 entity_extraction。
 */
import { Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LlmService } from '../../../types/llm';
import type { ChatMessage } from '../../../types/llm';
import { LLM_SERVICE_TOKEN } from '../../legal/intent/intent-router.service';
import { Inject } from '@nestjs/common';
import {
  EntityExtraction,
  type EntityExtractionDocument,
} from '../../../infra/database/schemas/entity-extraction.schema';
import { AppLoggerService } from '../../platform/logger/logger.service';
import { PARTY_ROLE_TERMS, LEGAL_TERM_DICT, isPronoun } from '../../../data/legalTerms';
import type { Entity, EntityExtractResult, NluContext } from './nlu.types';
import type {
  EntityType,
  EntitySource,
} from '../../../infra/database/schemas/entity-extraction.schema';
import { NLU_ERROR_CODES } from './nlu.types';

/** L3 LLM NER prompt 版本 */
const LLM_NER_PROMPT_VERSION = 1;
/** LLM NER 默认模型名（debug 用，实际由 LlmService 决定） */
const LLM_NER_MODEL_VERSION = 'agnes-2.0-flash';
/** L3 抽取超时（ms） */
const L3_TIMEOUT_MS = 8_000;

/** L1 正则规则 */
interface RegexRule {
  type: EntityType;
  pattern: RegExp;
  confidence: number;
  /** 命中后是否对 value 做归一化（如去单位） */
  normalize?: (raw: string) => string;
}

const REGEX_RULES: RegexRule[] = [
  // 身份证（18 位，最后一位可为 X）
  {
    type: 'idcard',
    pattern: /\b\d{17}[\dXx]\b/g,
    confidence: 0.95,
  },
  // 电话（中国大陆手机号）
  {
    type: 'phone',
    pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g,
    confidence: 0.9,
  },
  // 日期：YYYY年MM月DD日
  {
    type: 'date',
    pattern: /\d{4}年\d{1,2}月\d{1,2}日/g,
    confidence: 0.9,
  },
  // 金额：数字 + 元/万元/万
  {
    type: 'amount',
    pattern: /\d+(?:\.\d+)?(?:万元|万|元)/g,
    confidence: 0.85,
  },
  // 法条引用：第X条（支持中文数字与阿拉伯数字）
  {
    type: 'law_ref',
    pattern: /第[\d一二三四五六七八九十百千零〇]+条/g,
    confidence: 0.85,
  },
  // 合同：XX合同 / XX协议
  {
    type: 'contract',
    pattern: /[\u4e00-\u9fa5]{2,8}(?:合同|协议)/g,
    confidence: 0.7,
  },
];

/** L2 案由词典（取自 LEGAL_TERM_DICT 末尾案由子集） */
const CASE_CAUSE_TERMS = LEGAL_TERM_DICT.filter((t) => t.endsWith('纠纷'));

@Injectable()
export class EntityExtractorService {
  constructor(
    @Optional() @Inject(LLM_SERVICE_TOKEN) private readonly llm?: LlmService,
    @Optional()
    @InjectModel(EntityExtraction.name)
    private readonly entityModel?: Model<EntityExtractionDocument>,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  /**
   * 四层实体抽取主入口。
   *
   * @param text 待抽取文本
   * @param ctx NLU 上下文（含 lastTurnEntities 用于 L4 消解）
   */
  async extract(text: string, ctx?: NluContext): Promise<EntityExtractResult> {
    const warnings: string[] = [];
    const startedAt = Date.now();

    // L1 + L2：正则 + 词典
    const l1Entities = this.extractByRegex(text);
    const l2Entities = this.extractByDict(text);
    const merged = this.dedup([...l1Entities, ...l2Entities]);

    // L3：LLM NER
    let l3Entities: Entity[] = [];
    let degradedCode: number | undefined;
    let tokensIn = 0;
    let tokensOut = 0;
    let modelVersion: string | undefined;
    let promptVersion: number | undefined;

    try {
      const l3Result = await this.extractByLlm(text, merged);
      l3Entities = l3Result.entities;
      tokensIn = l3Result.tokensIn;
      tokensOut = l3Result.tokensOut;
      modelVersion = l3Result.modelVersion;
      promptVersion = l3Result.promptVersion;
      if (l3Result.degraded) {
        degradedCode = NLU_ERROR_CODES.LLM_DEGRADED;
        if (l3Result.warning) warnings.push(l3Result.warning);
      }
    } catch (err) {
      degradedCode = NLU_ERROR_CODES.LLM_DEGRADED;
      warnings.push(`LLM NER 异常：${err instanceof Error ? err.message : String(err)}`);
      this.logger?.warn('EntityExtractor L3 LLM 异常，降级返回 L1+L2', {
        msgId: ctx?.msgId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const l1l2l3 = this.dedup([...merged, ...l3Entities]);

    // L4：上下文消解（代词 → 上一轮实体）
    const l4Entities = this.resolveCoreference(l1l2l3, ctx);
    const finalEntities = this.dedup([...l1l2l3, ...l4Entities]);

    // 异步持久化（不阻塞主流程）
    if (ctx?.msgId && ctx?.userId) {
      this.persist(ctx.msgId, ctx.userId, finalEntities, modelVersion, promptVersion).catch(
        (err) => {
          this.logger?.warn('EntityExtraction 持久化失败', {
            msgId: ctx.msgId,
            error: err instanceof Error ? err.message : String(err),
          });
        },
      );
    }

    this.logger?.debug('实体抽取完成', {
      msgId: ctx?.msgId,
      totalEntities: finalEntities.length,
      l1l2Count: merged.length,
      l3Count: l3Entities.length,
      l4Count: l4Entities.length,
      degraded: !!degradedCode,
      durationMs: Date.now() - startedAt,
    });

    return {
      entities: finalEntities,
      warnings,
      degradedCode,
      modelVersion: degradedCode ? undefined : modelVersion,
      promptVersion: degradedCode ? undefined : promptVersion,
      tokensIn,
      tokensOut,
    };
  }

  /**
   * 跨轮消解：按 userId 加载最近一条 entity_extraction 记录。
   * 供 OrchestratorAgent 在调用 NluAgent 前预填 ctx.lastTurnEntities。
   */
  async loadLastTurn(userId: string): Promise<Entity[]> {
    if (!this.entityModel) return [];
    try {
      const doc = await this.entityModel
        .findOne({ userId })
        .sort({ extractedAt: -1 })
        .lean()
        .exec();
      if (!doc || !doc.entities?.length) return [];
      return doc.entities.map((e) => ({
        type: e.type as EntityType,
        value: e.value,
        span: [e.span[0], e.span[1]] as [number, number],
        confidence: e.confidence,
        source: e.source as EntitySource,
      }));
    } catch (err) {
      this.logger?.warn('EntityExtraction 跨轮加载失败', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  // ===== L1 正则层 =====

  private extractByRegex(text: string): Entity[] {
    const entities: Entity[] = [];
    for (const rule of REGEX_RULES) {
      // 重置 lastIndex（避免 g 标志在多次调用时累积）
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.pattern.exec(text)) !== null) {
        const raw = match[0];
        const value = rule.normalize ? rule.normalize(raw) : raw;
        entities.push({
          type: rule.type,
          value,
          span: [match.index, match.index + raw.length],
          confidence: rule.confidence,
          source: 'regex',
        });
        // 避免零宽匹配死循环
        if (match.index === rule.pattern.lastIndex) {
          rule.pattern.lastIndex++;
        }
      }
    }
    return entities;
  }

  // ===== L2 词典层 =====

  private extractByDict(text: string): Entity[] {
    const entities: Entity[] = [];

    // 当事人角色
    for (const term of PARTY_ROLE_TERMS) {
      let idx = text.indexOf(term);
      while (idx >= 0) {
        entities.push({
          type: 'person',
          value: term,
          span: [idx, idx + term.length],
          confidence: 0.8,
          source: 'dict',
        });
        idx = text.indexOf(term, idx + term.length);
      }
    }

    // 案由（优先匹配，先于通用 legal_term 以避免被截断）
    for (const term of CASE_CAUSE_TERMS) {
      let idx = text.indexOf(term);
      while (idx >= 0) {
        entities.push({
          type: 'case_cause',
          value: term,
          span: [idx, idx + term.length],
          confidence: 0.85,
          source: 'dict',
        });
        idx = text.indexOf(term, idx + term.length);
      }
    }

    // 通用法律术语（排除已归类为 case_cause 的）
    for (const term of LEGAL_TERM_DICT) {
      if (CASE_CAUSE_TERMS.includes(term)) continue;
      let idx = text.indexOf(term);
      while (idx >= 0) {
        entities.push({
          type: 'legal_term',
          value: term,
          span: [idx, idx + term.length],
          confidence: 0.75,
          source: 'dict',
        });
        idx = text.indexOf(term, idx + term.length);
      }
    }

    // 代词（作为 person 实体，低 confidence，供 L4 上下文消解识别）
    const pronounPattern = /他|她|它|他们|她们|它们|其|本人|对方|该方/g;
    let pm: RegExpExecArray | null;
    pronounPattern.lastIndex = 0;
    while ((pm = pronounPattern.exec(text)) !== null) {
      entities.push({
        type: 'person',
        value: pm[0],
        span: [pm.index, pm.index + pm[0].length],
        confidence: 0.5,
        source: 'dict',
      });
      if (pm.index === pronounPattern.lastIndex) pronounPattern.lastIndex++;
    }

    return entities;
  }

  // ===== L3 LLM NER 层 =====

  private async extractByLlm(
    text: string,
    l1l2Entities: Entity[],
  ): Promise<{
    entities: Entity[];
    degraded: boolean;
    /** 降级时的警告消息（外层添加到 warnings） */
    warning?: string;
    tokensIn: number;
    tokensOut: number;
    modelVersion?: string;
    promptVersion?: number;
  }> {
    if (!this.llm) {
      return {
        entities: [],
        degraded: true,
        warning: 'LLM NER 降级：仅返回 L1+L2 抽取结果',
        tokensIn: 0,
        tokensOut: 0,
      };
    }

    const prompt = this.buildNerPrompt(text, l1l2Entities);
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          '你是法律文本实体抽取器。只输出 JSON 数组，每个元素 {type,value,span,confidence}。' +
          'type 仅限 person/org/case_cause/evidence/legal_term。不要解释，不要 markdown 包裹。',
      },
      { role: 'user', content: prompt },
    ];

    let resp;
    try {
      resp = await this.llm.generate(messages, {
        temperature: 0,
        maxTokens: 1024,
        timeoutMs: L3_TIMEOUT_MS,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger?.warn('LLM NER 调用失败，降级返回 L1+L2', { error: errMsg });
      return {
        entities: [],
        degraded: true,
        warning: `LLM NER 异常：${errMsg}`,
        tokensIn: 0,
        tokensOut: 0,
      };
    }

    const parsed = this.parseLlmNerResponse(resp.content, text);
    if (parsed.length === 0 && resp.content && resp.content.trim()) {
      // LLM 返回了内容但解析失败 → 标记降级
      return {
        entities: [],
        degraded: true,
        warning: 'LLM NER 降级：响应解析失败，仅返回 L1+L2 抽取结果',
        tokensIn: resp.usage?.promptTokens ?? 0,
        tokensOut: resp.usage?.completionTokens ?? 0,
      };
    }
    return {
      entities: parsed,
      degraded: false,
      tokensIn: resp.usage?.promptTokens ?? 0,
      tokensOut: resp.usage?.completionTokens ?? 0,
      modelVersion: resp.model || LLM_NER_MODEL_VERSION,
      promptVersion: LLM_NER_PROMPT_VERSION,
    };
  }

  private buildNerPrompt(text: string, l1l2Entities: Entity[]): string {
    const known = l1l2Entities
      .map((e) => `${e.type}:${e.value}@${e.span[0]}-${e.span[1]}`)
      .join('; ');
    return [
      `待抽取文本：${text}`,
      '',
      `已知 L1+L2 抽取结果（请勿重复，只补充 person/org/case_cause/evidence 中 LLM 能识别的新实体）：${known || '(无)'}`,
      '',
      '输出格式（纯 JSON 数组，不要其他文本）：',
      '[{"type":"person","value":"张三","span":[0,2],"confidence":0.9}]',
    ].join('\n');
  }

  /** 解析 LLM 返回的 JSON 数组，容忍 markdown 包裹与多余文本 */
  private parseLlmNerResponse(content: string, text: string): Entity[] {
    if (!content || !content.trim()) return [];

    // 尝试提取首个 JSON 数组
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    try {
      const arr = JSON.parse(jsonMatch[0]) as Array<{
        type: string;
        value: string;
        span?: [number, number];
        confidence?: number;
      }>;
      const validTypes = new Set(['person', 'org', 'case_cause', 'evidence', 'legal_term']);
      const entities: Entity[] = [];
      for (const item of arr) {
        if (!item || typeof item.type !== 'string' || typeof item.value !== 'string') continue;
        if (!validTypes.has(item.type)) continue;
        if (!item.value.trim()) continue;

        // span 校验：若 LLM 给出 span，验证 value 在该位置；否则自行 indexOf
        let span: [number, number];
        if (
          Array.isArray(item.span) &&
          item.span.length === 2 &&
          typeof item.span[0] === 'number' &&
          typeof item.span[1] === 'number'
        ) {
          const slice = text.slice(item.span[0], item.span[1]);
          span =
            slice === item.value ? [item.span[0], item.span[1]] : this.locate(text, item.value);
        } else {
          span = this.locate(text, item.value);
        }
        if (span[0] < 0) continue; // LLM 幻觉，文本中找不到

        entities.push({
          type: item.type as EntityType,
          value: item.value,
          span,
          confidence:
            typeof item.confidence === 'number' ? Math.min(Math.max(item.confidence, 0), 1) : 0.7,
          source: 'llm',
        });
      }
      return entities;
    } catch {
      this.logger?.warn('LLM NER JSON 解析失败', { contentPreview: content.slice(0, 200) });
      return [];
    }
  }

  /** 在文本中定位 value 的首个出现位置；找不到返回 [-1, -1] */
  private locate(text: string, value: string): [number, number] {
    const idx = text.indexOf(value);
    return idx >= 0 ? [idx, idx + value.length] : [-1, -1];
  }

  // ===== L4 上下文消解层 =====

  /**
   * 代词消解：将文本中的代词替换为上一轮的实体（仅保留可消解类型 person/org）。
   * 实现：扫描上一轮实体，若其 value 是代词，则用 ctx.lastTurnEntities 中
   * 同类型的最近一条非代词实体替换，source='coref'。
   */
  private resolveCoreference(entities: Entity[], ctx?: NluContext): Entity[] {
    if (!ctx?.lastTurnEntities || ctx.lastTurnEntities.length === 0) return [];

    const corefEntities: Entity[] = [];
    const lastTurn = ctx.lastTurnEntities;

    // 对当前轮的 person/org 实体，若 value 是代词，则用上一轮最近的同类型实体替换
    for (const e of entities) {
      if ((e.type === 'person' || e.type === 'org') && isPronoun(e.value)) {
        const antecedent = lastTurn
          .filter((lt) => lt.type === e.type && !isPronoun(lt.value))
          .pop();
        if (antecedent) {
          corefEntities.push({
            type: e.type,
            value: antecedent.value,
            span: e.span,
            confidence: Math.max(e.confidence - 0.1, 0),
            source: 'coref',
          });
        }
      }
    }

    // 若当前轮无代词但上一轮有 person/org 且当前轮未提及，按场景暂不补全（避免幻觉）
    return corefEntities;
  }

  // ===== 去重 =====

  /**
   * 实体去重：
   *   1. 相同 type+value+span 视为重复，保留 confidence 更高 / source 更可信的
   *   2. 相同 type+value 但 span 不同（如同一个词出现多次），均保留
   *   3. source 优先级：coref > llm > dict > regex（更可信的覆盖）
   */
  private dedup(entities: Entity[]): Entity[] {
    const sourcePriority: Record<EntitySource, number> = {
      coref: 4,
      llm: 3,
      dict: 2,
      regex: 1,
    };
    const map = new Map<string, Entity>();
    for (const e of entities) {
      const key = `${e.type}|${e.value}|${e.span[0]}-${e.span[1]}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, e);
        continue;
      }
      // 同位置同值：保留 source 优先级高的；同优先级保留 confidence 高的
      const prioExisting = sourcePriority[existing.source];
      const prioNew = sourcePriority[e.source];
      if (
        prioNew > prioExisting ||
        (prioNew === prioExisting && e.confidence > existing.confidence)
      ) {
        map.set(key, e);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.span[0] - b.span[0]);
  }

  // ===== 持久化 =====

  private async persist(
    msgId: string,
    userId: string,
    entities: Entity[],
    modelVersion: string | undefined,
    promptVersion: number | undefined,
  ): Promise<void> {
    if (!this.entityModel) return;
    await this.entityModel.updateOne(
      { msgId },
      {
        $set: {
          msgId,
          userId,
          entities: entities.map((e) => ({
            type: e.type,
            value: e.value,
            span: [e.span[0], e.span[1]],
            confidence: e.confidence,
            source: e.source,
          })),
          modelVersion,
          promptVersion,
          extractedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }
}
