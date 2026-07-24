/**
 * IntentRouter —— 意图识别与置信度路由（A1-W3）。
 *
 * 职责（07 §一）：
 *   1. classify(input, ctx)：关键词+正则打分 → 置信度归一 → 阈值路由
 *   2. assistWithLlm(input, candidates)：0.5-0.8 区间轻量 LLM 判定
 *
 * 打分公式（07 §1.2）：
 *   score(intent) = Σ kw.weight × idf(kw) × positionBoost(kw)
 *                 + Σ pattern.weight × 1.5
 *                 + contextBonus(intent)
 *   - idf(kw) = ln(N / df(kw))，N=意图总数，df=含该词意图数；冷僻词权重更高
 *   - positionBoost：命中在句首前 20% ×1.2
 *   - contextBonus：ctx.lastIntent==intent 且最近 3 轮内 +0.15
 *
 * 置信度归一（07 §1.2）：
 *   confidence = topScore / (topScore + Σ score(other))，单匹配时为 1.0
 *
 * 阈值路由（07 §1.3）：
 *   ≥0.8 直路由；0.5-0.8 LLM 辅助；<0.5 → general_qa；0 命中 → fallbackUsed
 *
 * 设计依据：07 §1.1-1.5；06 §八 IntentRouter 接口桩。
 */
import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import type { LlmService, ChatMessage } from '../../../types/llm';
import type {
  IntentDef,
  IntentRanked,
  IntentResult,
  IntentType,
  RouteTarget,
} from '../../../types/intent';
import type { DialogContext } from '../../../types/dialog';
import { INTENT_DEFS } from '../../../data/legalIntents';
import { requestContext } from '../../../common/context/request-context';
import type { AppLoggerService } from '../../platform/logger/logger.service';

/** LlmService 注入 token（A1-W4 迁移后由 LegalModule 提供；A1-W3 阶段可选） */
export const LLM_SERVICE_TOKEN = 'LLM_SERVICE';

/** 置信度阈值（07 §1.3） */
const CONFIDENCE_DIRECT = 0.8;
const CONFIDENCE_LLM_ASSIST = 0.5;
/** contextBonus 取最近 N 轮 */
const CONTEXT_BONUS_TURNS = 3;
const CONTEXT_BONUS_VALUE = 0.15;
/** positionBoost 阈值：句首前 20% */
const POSITION_BOOST_RATIO = 0.2;
const POSITION_BOOST_FACTOR = 1.2;

@Injectable()
export class IntentRouterService {
  /** 关键词 → idf 预计算 */
  private readonly idfMap: Map<string, number>;
  /** 预编译正则（按 defs 顺序） */
  private readonly compiledPatterns: { re: RegExp; weight: number }[][];
  /** 意图定义库（默认 INTENT_DEFS，测试可覆写） */
  protected defs: IntentDef[] = INTENT_DEFS;

  constructor(
    @Optional() @Inject(LLM_SERVICE_TOKEN) private readonly llm?: LlmService,
    private readonly logger?: AppLoggerService,
  ) {
    const defs = this.defs;
    this.idfMap = this.computeIdf(defs);
    this.compiledPatterns = defs.map((d) =>
      d.patterns.map((p) => {
        try {
          return { re: new RegExp(p.regex), weight: p.weight };
        } catch (err) {
          // 正则编译失败不致命：跳过该 pattern 并记录，避免启动崩溃
          this.logger?.warn('intent pattern regex 编译失败，已跳过', {
            intent: d.intent,
            regex: p.regex,
            error: err instanceof Error ? err.message : String(err),
          });
          return { re: /$^/u, weight: 0 }; // 永不命中的安全正则
        }
      }),
    );
  }

  /**
   * 意图识别主入口。
   * @throws BadRequestException 输入为空（1001）
   */
  async classify(input: string, ctx: DialogContext): Promise<IntentResult> {
    // ===== 边界校验 =====
    if (input == null || typeof input !== 'string' || input.trim() === '') {
      throw new BadRequestException({ code: 1001, message: '意图识别输入不能为空' });
    }

    const text = this.normalize(input);
    const startedAt = Date.now();

    // ===== 打分 =====
    const ranked = this.scoreAll(text, ctx);
    const top = ranked[0];

    // 无任何命中 → fallback
    if (!top || top.score <= 0) {
      const result: IntentResult = {
        intent: 'general_qa',
        confidence: 0,
        route: 'general_qa',
        fallbackUsed: true,
        matchedKeywords: [],
        matchedPatterns: [],
      };
      this.logResult(text, result, startedAt, 'no_match');
      this.amendContext(result);
      return result;
    }

    // ===== 置信度归一 =====
    const sumAll = ranked.reduce((s, r) => s + Math.max(r.score, 0), 0);
    const confidence = sumAll > 0 ? top.score / sumAll : 0;
    const candidates = ranked
      .filter((r) => r.score > 0)
      .slice(0, 3)
      .map((r) => r.intent);

    // ===== 阈值路由 =====
    let route: RouteTarget;
    let finalIntent: IntentType = top.intent;
    const fallbackUsed = false;

    if (confidence >= CONFIDENCE_DIRECT) {
      // 直路由
      route = this.routeOf(top.intent);
    } else if (confidence >= CONFIDENCE_LLM_ASSIST) {
      // LLM 辅助判定
      finalIntent = await this.assistWithLlm(text, candidates);
      route = this.routeOf(finalIntent);
    } else {
      // 低置信度兜底
      route = 'general_qa';
      finalIntent = 'general_qa';
    }

    const result: IntentResult = {
      intent: finalIntent,
      confidence: Number(confidence.toFixed(4)),
      route,
      fallbackUsed,
      matchedKeywords: top.matchedKw,
      matchedPatterns: top.matchedPat,
      candidates,
      toolId: finalIntent === 'tool_invoke' ? this.inferToolId(top.matchedKw) : undefined,
    };

    this.logResult(text, result, startedAt, confidence >= CONFIDENCE_DIRECT ? 'direct' : 'assist');
    this.amendContext(result);
    return result;
  }

  /**
   * 0.5-0.8 区间 LLM 辅助判定（07 §1.3）。
   * LLM 不可用或解析失败 → 降级返回 top1（candidates[0]），不抛错。
   */
  async assistWithLlm(input: string, candidates: IntentType[]): Promise<IntentType> {
    if (candidates.length === 0) return 'general_qa';
    if (!this.llm) {
      // A1-W3 阶段 LlmService 尚未注入，降级返回 top1
      this.logger?.warn('LLM 辅助判定不可用，降级返回 top1', { candidates });
      return candidates[0];
    }

    const prompt = this.buildAssistPrompt(input, candidates);
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: '你是法律意图分类器，只从给定候选中选一个，仅输出意图名称，不要解释。',
      },
      { role: 'user', content: prompt },
    ];

    try {
      const resp = await this.llm.generate(messages, { temperature: 0, maxTokens: 32 });
      const picked = this.parseAssistResponse(resp.content, candidates);
      this.logger?.debug('LLM 辅助判定完成', { input, candidates, picked });
      return picked;
    } catch (err) {
      // LLM 失败不阻塞：降级 top1（07 §1.4 Fallback 链）
      this.logger?.warn('LLM 辅助判定失败，降级返回 top1', {
        input,
        candidates,
        error: err instanceof Error ? err.message : String(err),
      });
      return candidates[0];
    }
  }

  // ===== 内部：打分 =====

  /** 对所有意图打分并按分数倒序排名 */
  private scoreAll(text: string, ctx: DialogContext): IntentRanked[] {
    const ranked: IntentRanked[] = [];

    for (let i = 0; i < this.defs.length; i++) {
      const def = this.defs[i];
      let score = 0;
      const matchedKw: string[] = [];
      const matchedPat: string[] = [];

      // 关键词命中
      for (const kw of def.keywords) {
        const idx = text.indexOf(kw.word);
        if (idx >= 0) {
          const idf = this.idfMap.get(kw.word) ?? 0;
          const boost = this.positionBoost(text, idx);
          score += kw.weight * idf * boost;
          matchedKw.push(kw.word);
        }
      }

      // 正则模式命中
      const compiled = this.compiledPatterns[i];
      for (const p of compiled) {
        p.re.lastIndex = 0;
        if (p.re.test(text)) {
          score += p.weight * 1.5;
          matchedPat.push(p.re.source);
        }
      }

      // 上下文延续加成
      if (ctx.lastIntent === def.intent && this.withinRecentTurns(ctx, def.intent)) {
        score += CONTEXT_BONUS_VALUE;
      }

      ranked.push({ intent: def.intent, score, matchedKw, matchedPat });
    }

    return ranked.sort((a, b) => b.score - a.score);
  }

  /** positionBoost：命中在句首前 20% ×1.2，否则 ×1.0 */
  private positionBoost(text: string, idx: number): number {
    if (text.length === 0) return 1;
    return idx <= text.length * POSITION_BOOST_RATIO ? POSITION_BOOST_FACTOR : 1;
  }

  /** 最近 N 轮内是否出现过该意图（contextBonus 条件） */
  private withinRecentTurns(ctx: DialogContext, intent: IntentType): boolean {
    const turns = ctx.recentTurns ?? [];
    const recent = turns.slice(-CONTEXT_BONUS_TURNS);
    return recent.some((t) => t.intent === intent);
  }

  // ===== 内部：idf 预计算 =====

  private computeIdf(defs: IntentDef[]): Map<string, number> {
    const df = new Map<string, number>();
    const N = defs.length;
    for (const def of defs) {
      for (const kw of def.keywords) {
        df.set(kw.word, (df.get(kw.word) ?? 0) + 1);
      }
    }
    const idf = new Map<string, number>();
    for (const [word, d] of df) {
      // idf = ln(N / df)；df>=1，N>=1，避免除零
      idf.set(word, Math.log(N / d));
    }
    return idf;
  }

  // ===== 内部：路由与工具推断 =====

  /** 取意图定义的默认路由 */
  private routeOf(intent: IntentType): RouteTarget {
    return this.defs.find((d) => d.intent === intent)?.route ?? 'general_qa';
  }

  /** tool_invoke 意图：按命中关键词推断 toolId（07 §1.2） */
  private inferToolId(matchedKw: string[]): string | undefined {
    const toolDef = this.defs.find((d) => d.intent === 'tool_invoke');
    const map = toolDef?.toolIdMap;
    if (!map) return undefined;
    // 取第一个命中且在 toolIdMap 中的关键词
    for (const kw of matchedKw) {
      if (map[kw]) return map[kw];
    }
    return undefined;
  }

  // ===== 内部：输入归一化 =====

  /** 全角→半角，去首尾空白，合并连续空白 */
  private normalize(input: string): string {
    return input
      .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/\u3000/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ===== 内部：LLM 辅助 prompt =====

  private buildAssistPrompt(input: string, candidates: IntentType[]): string {
    return [
      '用户输入：',
      input,
      '',
      '请从以下意图中选择最匹配的一个（只输出意图名）：',
      candidates.join(' / '),
    ].join('\n');
  }

  /** 从 LLM 响应中解析意图名，容忍多余文本 */
  private parseAssistResponse(content: string, candidates: IntentType[]): IntentType {
    const trimmed = content.trim().toLowerCase();
    for (const c of candidates) {
      if (trimmed.includes(c.toLowerCase())) return c;
    }
    return candidates[0];
  }

  // ===== 内部：日志与上下文 =====

  private logResult(input: string, result: IntentResult, startedAt: number, mode: string): void {
    this.logger?.info('意图识别完成', {
      func: 'intent_router',
      intent: result.intent,
      route: result.route,
      confidence: result.confidence,
      fallbackUsed: result.fallbackUsed,
      toolId: result.toolId,
      mode,
      durationMs: Date.now() - startedAt,
      inputPreview: input.slice(0, 48),
    });
  }

  /** 将识别结果写回 RequestContext（供后续 Logger/Audit 复用） */
  private amendContext(result: IntentResult): void {
    requestContext.amend({ intent: result.intent, route: result.route });
  }
}
