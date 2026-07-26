/**
 * CompoundIntentSplitterService —— 复合意图拆分 + 拓扑排序（v2.3-W4，07 §8.3）。
 *
 * 职责：
 *   1. 文本切分：按分隔符（。；，,;）拆为子句
 *   2. 子句意图识别：复用 IntentRouterService.classify（@Optional 注入）
 *   3. 依赖识别：
 *      - 指代依赖：子句含代词（他/她/其）→ 依赖前一个含 person 实体的子句
 *      - 因果依赖：子句含"因此/所以/故/导致"→ 依赖前一个子句
 *      - 时序依赖：子句含"然后/接着/之后/随后"→ 依赖前一个子句
 *   4. 拓扑排序：Kahn 算法生成执行序；检测到环时回退原文顺序
 *
 * 降级策略：
 *   - IntentRouterService 未注入：isCompound=true 但仅按文本顺序拆分，warnings 提示
 *   - 子句意图识别失败：兜底为 general_qa
 *
 * 设计依据：07 §8.3 第 1-5 步。
 */
import { Injectable, Optional } from '@nestjs/common';
import type { IntentType, RouteTarget } from '../../../types/intent';
import type { AppLoggerService } from '../../platform/logger/logger.service';
import type { IntentRouterService } from '../intent/intent-router.service';
import { isPronoun } from '../../../data/legalTerms';
import type { CompoundSplitResult, Entity, NluContext, SubIntent } from './nlu.types';

/** 子句切分分隔符正则（中英文句号/分号/逗号/换行） */
const SENTENCE_SPLIT_REGEX = /[。；;，,！!？?\n]+/;

/** 因果关联词 */
const CAUSAL_MARKERS = ['因此', '所以', '故', '导致', '以至于', '从而'];

/** 时序关联词 */
const SEQUENCE_MARKERS = ['然后', '接着', '之后', '随后', '后来', '其次'];

/** 子句最少字符数（过短的不独立成句） */
const MIN_SUBSENTENCE_LEN = 2;

@Injectable()
export class CompoundIntentSplitterService {
  constructor(
    @Optional() private readonly intentRouter?: IntentRouterService,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  /**
   * 复合意图拆分主入口。
   *
   * @param text 用户原始输入
   * @param ctx NLU 上下文（含 lastTurnEntities 用于指代判断）
   */
  async split(text: string, ctx?: NluContext): Promise<CompoundSplitResult> {
    const warnings: string[] = [];

    // 1. 文本切分
    const rawSentences = text
      .split(SENTENCE_SPLIT_REGEX)
      .map((s) => s.trim())
      .filter((s) => s.length >= MIN_SUBSENTENCE_LEN);

    // 单句或无内容：非复合意图
    if (rawSentences.length <= 1) {
      return {
        subIntents: [],
        executionOrder: [],
        isCompound: false,
        warnings,
      };
    }

    // 2. 子句意图识别 + 实体抽取（轻量：仅识别是否含代词/角色，不调 LLM）
    const subIntents: SubIntent[] = [];
    for (let i = 0; i < rawSentences.length; i++) {
      const subText = rawSentences[i];
      const { intent, confidence, route } = await this.classifySubIntent(subText, ctx);
      const entities = this.extractLightweightEntities(subText);

      subIntents.push({
        index: i,
        subIntent: intent,
        subText,
        confidence,
        route,
        entities,
        dependsOn: [],
      });
    }

    // 3. 依赖识别
    this.resolveDependencies(subIntents, ctx);

    // 4. 拓扑排序
    const executionOrder = this.topologicalSort(subIntents, warnings);

    this.logger?.debug('复合意图拆分完成', {
      isCompound: true,
      subIntentCount: subIntents.length,
      executionOrder,
      warnings,
    });

    return {
      subIntents,
      executionOrder,
      isCompound: true,
      warnings,
    };
  }

  // ===== 子句意图识别 =====

  /**
   * 单子句意图识别：优先复用 IntentRouterService；
   * 未注入时按简单关键词推断，置信度降级为 0.5。
   */
  private async classifySubIntent(
    subText: string,
    ctx?: NluContext,
  ): Promise<{ intent: IntentType; confidence: number; route: RouteTarget }> {
    if (this.intentRouter) {
      try {
        const dialogCtx = this.toDialogContext(subText, ctx);
        const result = await this.intentRouter.classify(subText, dialogCtx);
        return { intent: result.intent, confidence: result.confidence, route: result.route };
      } catch (err) {
        this.logger?.warn('子句意图识别失败，降级 general_qa', {
          subText: subText.slice(0, 48),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // 兜底：按关键词轻量推断
    return this.lightweightClassify(subText);
  }

  /** 轻量意图推断（IntentRouter 不可用时兜底） */
  private lightweightClassify(subText: string): {
    intent: IntentType;
    confidence: number;
    route: RouteTarget;
  } {
    if (/(起诉状|答辩状|律师函|合同|协议书|文书)/.test(subText)) {
      return { intent: 'document_generate', confidence: 0.5, route: 'llm' };
    }
    if (/(流程|怎么立案|如何起诉|步骤)/.test(subText)) {
      return { intent: 'process_guide', confidence: 0.5, route: 'knowledge' };
    }
    if (/(能否胜诉|判多重|能起诉吗|能否要求)/.test(subText)) {
      return { intent: 'case_analysis', confidence: 0.5, route: 'llm' };
    }
    if (/(期限|赔偿多少|量刑|案由)/.test(subText)) {
      return { intent: 'tool_invoke', confidence: 0.5, route: 'tool' };
    }
    if (/(是什么|什么是|解释|含义|定义)/.test(subText)) {
      return { intent: 'legal_qa', confidence: 0.5, route: 'rule' };
    }
    return { intent: 'general_qa', confidence: 0.3, route: 'general_qa' };
  }

  /** 将 NluContext 转为 IntentRouter 需要的 DialogContext */
  private toDialogContext(_subText: string, ctx?: NluContext) {
    const recentTurns = (ctx?.recentTurns ?? []).map((t) => ({
      role: t.role,
      content: t.content,
      ts: new Date().toISOString(),
    }));
    return {
      sessionId: ctx?.sessionId ?? 'nlu-split',
      userId: ctx?.userId,
      unresolvedCount: 0,
      recentTurns,
    };
  }

  // ===== 轻量实体抽取（仅供依赖判定用，不持久化） =====

  private extractLightweightEntities(subText: string): Entity[] {
    const entities: Entity[] = [];

    // 当事人角色（用于指代依赖判定）
    const personMatches = subText.match(
      /(原告|被告|第三人|上诉人|被上诉人|申请人|犯罪嫌疑人|被告人|自诉人|被害人)/g,
    );
    if (personMatches) {
      for (const m of personMatches) {
        const idx = subText.indexOf(m);
        entities.push({
          type: 'person',
          value: m,
          span: [idx, idx + m.length],
          confidence: 0.8,
          source: 'dict',
        });
      }
    }

    // 代词（用于指代依赖判定）
    const pronounMatches = subText.match(/(他|她|它|他们|她们|其|本人|对方|该方)/g);
    if (pronounMatches) {
      for (const m of pronounMatches) {
        const idx = subText.indexOf(m);
        entities.push({
          type: 'person',
          value: m,
          span: [idx, idx + m.length],
          confidence: 0.6,
          source: 'dict',
        });
      }
    }

    return entities;
  }

  // ===== 依赖识别 =====

  /**
   * 识别子句间依赖关系：
   *   - 指代依赖：子句 i 含代词 → 依赖最近的前序含 person 实体的子句
   *   - 因果依赖：子句 i 含因果词 → 依赖前一个子句
   *   - 时序依赖：子句 i 含时序词 → 依赖前一个子句
   */
  private resolveDependencies(subIntents: SubIntent[], _ctx?: NluContext): void {
    for (let i = 0; i < subIntents.length; i++) {
      const cur = subIntents[i];
      const deps = new Set<number>();

      // 指代依赖：含代词 → 依赖前序最近含 person 的子句
      const hasPronoun = cur.entities.some((e) => isPronoun(e.value));
      if (hasPronoun) {
        for (let j = i - 1; j >= 0; j--) {
          if (subIntents[j].entities.some((e) => e.type === 'person' && !isPronoun(e.value))) {
            deps.add(j);
            break;
          }
        }
      }

      // 因果依赖
      if (CAUSAL_MARKERS.some((m) => cur.subText.includes(m))) {
        if (i > 0) deps.add(i - 1);
      }

      // 时序依赖
      if (SEQUENCE_MARKERS.some((m) => cur.subText.includes(m))) {
        if (i > 0) deps.add(i - 1);
      }

      cur.dependsOn = Array.from(deps).sort((a, b) => a - b);
    }
  }

  // ===== 拓扑排序（Kahn 算法） =====

  /**
   * Kahn 算法拓扑排序：按依赖关系生成执行序。
   * 检测到环时回退原文顺序（warnings 提示）。
   */
  private topologicalSort(subIntents: SubIntent[], warnings: string[]): number[] {
    const n = subIntents.length;
    if (n === 0) return [];

    // 入度表 + 邻接表
    const inDegree = new Array(n).fill(0);
    const adj = new Map<number, number[]>();
    for (let i = 0; i < n; i++) adj.set(i, []);

    for (const sub of subIntents) {
      for (const dep of sub.dependsOn) {
        // dep → sub（dep 必须先执行）
        adj.get(dep)!.push(sub.index);
        inDegree[sub.index] += 1;
      }
    }

    // 入度为 0 的节点入队（按 index 升序保证稳定）
    const queue: number[] = [];
    for (let i = 0; i < n; i++) {
      if (inDegree[i] === 0) queue.push(i);
    }

    const order: number[] = [];
    while (queue.length > 0) {
      const node = queue.shift()!;
      order.push(node);
      const neighbors = adj.get(node) ?? [];
      // 按 index 升序处理邻居，保证稳定
      neighbors.sort((a, b) => a - b);
      for (const nb of neighbors) {
        inDegree[nb] -= 1;
        if (inDegree[nb] === 0) queue.push(nb);
      }
    }

    // 检测环
    if (order.length < n) {
      warnings.push(`检测到依赖环（${n - order.length} 个子句），回退原文顺序`);
      this.logger?.warn('复合意图拓扑排序检测到环，回退原文顺序', {
        totalSubIntents: n,
        sortedCount: order.length,
      });
      return subIntents.map((s) => s.index);
    }

    return order;
  }
}
