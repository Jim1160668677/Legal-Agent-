/**
 * RuleEngine —— 规则层法条/FAQ 精确匹配（A1-W3）。
 *
 * 职责（06 §八 RuleEngine + 07 §1.4 Fallback 链第 1 层）：
 *   query(input) → RuleResult | null
 *   1. 法条精确匹配：从输入提取法条引用（"民法典第一百四十三条"），内存 Map O(1) 查找
 *   2. 关键词召回：无明确引用时，按 keywords 命中数排序取最佳
 *   3. FAQ 快答：高频问句直接返回
 *   4. 均未命中 → null（交由上层知识库/LLM 降级）
 *
 * 性能（A1 §十三验收第 4 项）：全内存 Map 查找，无 DB IO，单次 < 100ms。
 *
 * 设计依据：06 §八 RuleResult/RuleEngine；07 §2.6 法条引用校验；
 *           data/lawArticles.ts 内存快取；src/services/legal/llm/lawRefExtractor.ts。
 */
import { Injectable, Optional } from '@nestjs/common';
import type { LawRef } from '../../../types/llm';
import { extractLawRefs } from '../../../services/legal/llm/lawRefExtractor';
import { extractArticleNoInt, parseChineseNumeral } from './chinese-numeral';
import { FAQ_ENTRIES, LAW_ARTICLES, type LawArticleData } from '../../../data/lawArticles';
import { requestContext } from '../../../common/context/request-context';
import { AppLoggerService } from '../../platform/logger/logger.service';

/** 规则层返回结果（06 §八 RuleResult） */
export interface RuleResult {
  answer: string;
  lawRefs: LawRef[];
  source: 'law_article' | 'faq';
  matchedKey: string;
}

/** 法条精确匹配键：lawName#articleNoInt */
function lawKey(lawName: string, articleNoInt: number): string {
  return `${lawName.replace(/[《》]/g, '')}#${articleNoInt}`;
}

/** 从法条引用串解析 lawName + articleNoInt */
function parseRef(ref: string): { lawName: string; articleNoInt: number } | null {
  const m = ref.match(/^(.+?)第([零一二三四五六七八九十百千万0-9]+)条$/);
  if (!m) return null;
  const lawName = m[1].replace(/[《》]/g, '');
  const articleNoInt = parseChineseNumeral(m[2]);
  if (Number.isNaN(articleNoInt)) return null;
  return { lawName, articleNoInt };
}

@Injectable()
export class RuleEngineService {
  /** 精确匹配：lawName#articleNoInt → LawArticleData */
  private readonly exactMap: Map<string, LawArticleData>;
  /** 关键词倒排：keyword → LawArticleData[] */
  private readonly keywordIndex: Map<string, LawArticleData[]>;
  /** 已知法律名集合（用于归一化 extractLawRefs 贪婪匹配出的法律名） */
  private readonly lawNames: Set<string>;

  constructor(@Optional() private readonly logger?: AppLoggerService) {
    this.exactMap = new Map();
    this.keywordIndex = new Map();
    this.lawNames = new Set();
    for (const art of LAW_ARTICLES) {
      // 精确键：同时登记原文 articleNo 解析结果，兼容"第143条"/"第一百四十三条"
      const noInt = art.articleNoInt || extractArticleNoInt(art.articleNo);
      if (!Number.isNaN(noInt)) {
        this.exactMap.set(lawKey(art.lawName, noInt), art);
      }
      this.lawNames.add(art.lawName);
      // 倒排索引
      for (const kw of art.keywords) {
        const list = this.keywordIndex.get(kw) ?? [];
        list.push(art);
        this.keywordIndex.set(kw, list);
      }
    }
    this.logger?.info('RuleEngine 内存索引构建完成', {
      articles: LAW_ARTICLES.length,
      exactKeys: this.exactMap.size,
      keywordEntries: this.keywordIndex.size,
    });
  }

  /**
   * 归一化法律名：extractLawRefs 的正则贪婪，可能把"请问民法典"整体当作法律名。
   * 此处在已知法律名集合中找最长后缀匹配，还原为"民法典"。
   */
  private resolveLawName(raw: string): string {
    if (this.lawNames.has(raw)) return raw;
    let best = '';
    for (const name of this.lawNames) {
      if (raw.endsWith(name) && name.length > best.length) best = name;
    }
    return best || raw;
  }

  /**
   * 规则层查询。命中即返回（不向下走，成本最优，07 §1.4）。
   * @returns RuleResult 或 null（未命中交上层降级）
   */
  async query(input: string): Promise<RuleResult | null> {
    if (input == null || typeof input !== 'string' || input.trim() === '') {
      return null;
    }

    const startedAt = Date.now();
    const text = input.trim();

    // 1. 法条精确匹配
    const exact = this.matchByLawRef(text);
    if (exact) {
      this.logQuery(text, exact, startedAt, 'law_ref');
      return exact;
    }

    // 2. 关键词召回
    const kwMatch = this.matchByKeyword(text);
    if (kwMatch) {
      this.logQuery(text, kwMatch, startedAt, 'keyword');
      return kwMatch;
    }

    // 3. FAQ 快答
    const faq = this.matchFaq(text);
    if (faq) {
      this.logQuery(text, faq, startedAt, 'faq');
      return faq;
    }

    // 4. 未命中
    this.logger?.debug('RuleEngine 未命中', {
      inputPreview: text.slice(0, 48),
      durationMs: Date.now() - startedAt,
    });
    return null;
  }

  // ===== 法条精确匹配 =====

  private matchByLawRef(text: string): RuleResult | null {
    const refs = extractLawRefs(text);
    if (refs.length === 0) return null;

    for (const r of refs) {
      const parsed = parseRef(r.ref);
      if (!parsed) continue;
      // 归一化法律名：extractLawRefs 正则贪婪可能把"请问民法典"整体当作法律名，
      // resolveLawName 在已知法律名集合中找最长后缀匹配，还原为"民法典"。
      const lawName = this.resolveLawName(parsed.lawName);
      const hit = this.exactMap.get(lawKey(lawName, parsed.articleNoInt));
      if (hit && hit.status === 'effective') {
        return {
          answer: this.formatArticle(hit),
          lawRefs: [
            {
              ref: `${hit.lawName}第${hit.articleNo}`,
              title: `${hit.lawName} ${hit.articleNo}`,
              verified: true,
            },
          ],
          source: 'law_article',
          matchedKey: `${hit.lawName}#${hit.articleNoInt}`,
        };
      }
    }
    return null;
  }

  // ===== 关键词召回 =====

  private matchByKeyword(text: string): RuleResult | null {
    let best: LawArticleData | null = null;
    let bestScore = 0;

    for (const [kw, articles] of this.keywordIndex) {
      if (text.includes(kw)) {
        for (const art of articles) {
          if (art.status !== 'effective') continue;
          // 简化评分：每个命中关键词 +1，法条引用相关词加权
          const score = this.scoreArticle(text, art);
          if (score > bestScore) {
            bestScore = score;
            best = art;
          }
        }
      }
    }

    if (!best || bestScore < 1) return null;

    return {
      answer: this.formatArticle(best),
      lawRefs: [
        {
          ref: `${best.lawName}第${best.articleNo}`,
          title: `${best.lawName} ${best.articleNo}`,
          verified: true,
        },
      ],
      source: 'law_article',
      matchedKey: `${best.lawName}#${best.articleNoInt}`,
    };
  }

  /** 关键词命中数评分（命中数越多分越高） */
  private scoreArticle(text: string, art: LawArticleData): number {
    let score = 0;
    for (const kw of art.keywords) {
      if (text.includes(kw)) score += 1;
    }
    return score;
  }

  // ===== FAQ 快答 =====

  private matchFaq(text: string): RuleResult | null {
    for (const faq of FAQ_ENTRIES) {
      for (const kw of faq.triggerKeywords) {
        if (text.includes(kw)) {
          return {
            answer: faq.answer,
            lawRefs: faq.lawRefs,
            source: 'faq',
            matchedKey: faq.matchedKey,
          };
        }
      }
    }
    return null;
  }

  // ===== 格式化与日志 =====

  private formatArticle(art: LawArticleData): string {
    return `《${art.lawName}》${art.articleNo}\n${art.content}`;
  }

  private logQuery(input: string, result: RuleResult, startedAt: number, mode: string): void {
    const ctx = requestContext.get();
    this.logger?.info('RuleEngine 命中', {
      func: 'rule_engine',
      traceId: ctx?.traceId,
      mode,
      source: result.source,
      matchedKey: result.matchedKey,
      durationMs: Date.now() - startedAt,
      inputPreview: input.slice(0, 48),
    });
  }
}
