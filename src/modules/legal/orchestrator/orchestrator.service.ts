/**
 * OrchestratorService —— 三层混合降级链编排（A1-W4）。
 *
 * 职责（07 §1.4 Fallback 链 + A1 §十 ChatController 编排）：
 *   orchestrate(input, ctx, userId) → AsyncIterable<ChatFrame>
 *   1. IntentRouter 识别意图 + 路由
 *   2. 记忆：写入用户消息 + 召回相关记忆（注入 LLM prompt）
 *   3. 降级链：
 *        route=rule  → RuleEngine 命中即返；未命中落 LLM
 *        route=tool  → A4 占位引导（工具调用建设中）
 *        route=knowledge → A2 占位，落 LLM
 *        route=llm/reasoning/general_qa → LLM 流式
 *   4. LLM 失败/不可用 → 人工引导降级（audit degradation）
 *   5. 法条引用校验（validateLawRefs，MVP 桩）
 *   6. 帧序列：[chunk]* → [meta] → [disclaimer] → [done]
 *
 * 设计依据：07 §1.4；A1 §十；06 §八 OrchestratorAgent（A4 前置编排雏形）。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { LlmService } from '../../../types/llm';
import type { ChatMessage, LawRef } from '../../../types/llm';
import type { IntentType, RouteTarget } from '../../../types/intent';
import type { DialogContext } from '../../../types/dialog';
import { requestContext } from '../../../common/context/request-context';
import { IntentRouterService } from '../intent/intent-router.service';
import { LLM_SERVICE_TOKEN } from '../intent/intent-router.service';
import { RuleEngineService } from '../rule/rule-engine.service';
import { MemoryManagerService } from '../memory/memory-manager.service';
import { KnowledgeBaseService } from '../knowledge/knowledge-base.service';
import type { KnowledgeResult } from '../knowledge/knowledge.types';
import { type MemoryEntry } from '../memory/memory-manager.service';
import { AuditLogService } from '../../platform/audit/audit-log.service';
import { AppLoggerService } from '../../platform/logger/logger.service';
import { DISCLAIMER_TEXT, type ChatFrame } from '../chat/sse-frames';

/** LLM 不可用或失败时的人工引导文案（07 §1.4 最后一层） */
const MANUAL_GUIDE =
  '抱歉，当前无法生成详细回复。您可以尝试：\n' +
  '1. 换一种更具体的提问方式（如直接引用法条名称和条号）；\n' +
  '2. 稍后重试；\n' +
  '3. 复杂问题建议咨询执业律师。';

/** LLM system prompt（07 §五 Prompt 工程规范） */
const LLM_SYSTEM_PROMPT =
  '你是法律智能助手，提供法律信息参考，不构成法律意见。' +
  '回答需准确、客观，引用法条请标注法律名称与条号。';

@Injectable()
export class OrchestratorService {
  constructor(
    private readonly intentRouter: IntentRouterService,
    private readonly ruleEngine: RuleEngineService,
    private readonly memory: MemoryManagerService,
    @Optional() @Inject(LLM_SERVICE_TOKEN) private readonly llm?: LlmService,
    private readonly audit?: AuditLogService,
    private readonly logger?: AppLoggerService,
    @Optional() private readonly knowledge?: KnowledgeBaseService,
  ) {}

  /**
   * 编排主入口：返回 SSE 帧异步迭代流，由 ChatController 写入 Response。
   */
  async *orchestrate(
    input: string,
    ctx: DialogContext,
    userId: string,
  ): AsyncGenerator<ChatFrame, void, void> {
    const startedAt = Date.now();
    const ctxTrace = requestContext.get();
    const traceId = ctxTrace?.traceId ?? ctx.sessionId;

    // ===== 1. 意图识别 =====
    const classify = await this.intentRouter.classify(input, ctx);
    const { intent, route, confidence, fallbackUsed } = classify;
    requestContext.amend({ intent, route, func: 'chat' });

    this.audit?.write('chat_send', {
      inputPreview: input.slice(0, 64),
      intent,
      route,
      confidence,
      fallbackUsed,
    });

    // ===== 2. 记忆：写用户消息 + 召回 =====
    const sessionId = ctx.sessionId ?? traceId;
    await this.memory.appendDialog(sessionId, userId, {
      role: 'user',
      content: input,
      intent,
    });
    const memories = await this.memory.getRelevantMemories(intent);

    this.logger?.info('orchestrate 意图识别完成', {
      intent,
      route,
      confidence,
      memoryCount: memories.length,
      durationMs: Date.now() - startedAt,
    });

    // ===== 3. 降级链 =====
    // Layer 1：规则层（route=rule 时优先尝试；命中即返，成本最优）
    if (route === 'rule') {
      const ruleResult = await this.ruleEngine.query(input);
      if (ruleResult) {
        yield* this.yieldRuleAnswer(
          intent,
          route,
          ruleResult.answer,
          ruleResult.lawRefs,
          sessionId,
          userId,
          ruleResult.source,
        );
        return;
      }
      // 规则未命中 → 落 LLM
    }

    // Layer 2：工具层占位（A4 实现，当前返回引导）
    if (route === 'tool') {
      const toolId = classify.toolId;
      yield { type: 'chunk', delta: this.toolPlaceholder(toolId) };
      await this.memory.appendDialog(sessionId, userId, {
        role: 'assistant',
        content: this.toolPlaceholder(toolId),
        intent,
      });
      yield {
        type: 'meta',
        intent,
        route,
        source: 'tool',
        lawRefs: [],
        fallbackUsed: false,
      };
      yield { type: 'disclaimer', text: DISCLAIMER_TEXT };
      yield { type: 'done', traceId };
      return;
    }

    // Layer 3：知识层（A2-W1 接入 KnowledgeBase，命中即返；未命中落 LLM）
    if (route === 'knowledge' && this.knowledge) {
      const kbResults = await this.knowledge.queryByKeyword(input, { limit: 3 });
      if (kbResults.length > 0) {
        yield* this.yieldKnowledgeAnswer(intent, route, kbResults, sessionId, userId);
        return;
      }
      // 知识库未命中 → 落 LLM
    }

    // Layer 4：LLM 流式（rule-miss / knowledge-miss / llm / reasoning / general_qa）
    yield* this.streamLlm(input, intent, route, memories, sessionId, userId, traceId, startedAt);
  }

  // ===== 规则层命中输出 =====

  private async *yieldRuleAnswer(
    intent: IntentType,
    route: RouteTarget,
    answer: string,
    lawRefs: LawRef[],
    sessionId: string,
    userId: string,
    source: 'law_article' | 'faq',
  ): AsyncGenerator<ChatFrame, void, void> {
    yield { type: 'chunk', delta: answer };
    await this.memory.appendDialog(sessionId, userId, {
      role: 'assistant',
      content: answer,
      intent,
    });
    yield {
      type: 'meta',
      intent,
      route,
      source: source === 'faq' ? 'faq' : 'rule',
      lawRefs,
      fallbackUsed: false,
    };
    yield { type: 'disclaimer', text: DISCLAIMER_TEXT };
    yield { type: 'done', traceId: requestContext.get()?.traceId ?? sessionId };
  }

  // ===== 知识层命中输出（A2-W1） =====

  private async *yieldKnowledgeAnswer(
    intent: IntentType,
    route: RouteTarget,
    results: KnowledgeResult[],
    sessionId: string,
    userId: string,
  ): AsyncGenerator<ChatFrame, void, void> {
    const answer = this.formatKnowledgeResults(results);
    yield { type: 'chunk', delta: answer };
    await this.memory.appendDialog(sessionId, userId, {
      role: 'assistant',
      content: answer,
      intent,
    });
    const lawRefs = results.flatMap((r) => r.lawRefs);
    yield {
      type: 'meta',
      intent,
      route,
      source: 'faq',
      lawRefs,
      fallbackUsed: false,
    };
    yield { type: 'disclaimer', text: DISCLAIMER_TEXT };
    yield { type: 'done', traceId: requestContext.get()?.traceId ?? sessionId };
  }

  /** 将知识库结构化结果格式化为可读文本 */
  private formatKnowledgeResults(results: KnowledgeResult[]): string {
    return results
      .map((r) => {
        let text = `【${r.title}】\n${r.content}`;
        const steps = r.structured?.steps as
          Array<{ stage: string; description: string; duration?: string }> | undefined;
        if (steps && steps.length > 0) {
          text +=
            '\n\n流程步骤：\n' +
            steps
              .map(
                (s, i) =>
                  `${i + 1}. ${s.stage}：${s.description}${s.duration ? `（${s.duration}）` : ''}`,
              )
              .join('\n');
        }
        const materials = r.structured?.materials as
          Array<{ name: string; required: boolean; note?: string }> | undefined;
        if (materials && materials.length > 0) {
          text +=
            '\n\n所需材料：\n' +
            materials
              .map(
                (m, i) =>
                  `${i + 1}. ${m.name}${m.required ? '（必需）' : '（可选）'}${m.note ? `：${m.note}` : ''}`,
              )
              .join('\n');
        }
        return text;
      })
      .join('\n\n---\n\n');
  }

  // ===== LLM 流式 =====

  private async *streamLlm(
    input: string,
    intent: IntentType,
    route: RouteTarget,
    memories: MemoryEntry[],
    sessionId: string,
    userId: string,
    traceId: string,
    startedAt: number,
  ): AsyncGenerator<ChatFrame, void, void> {
    // LLM 不可用 → 人工引导降级
    if (!this.llm) {
      this.audit?.write('degradation', {
        reason: 'llm_unavailable',
        intent,
        route,
      });
      yield { type: 'chunk', delta: MANUAL_GUIDE };
      await this.memory.appendDialog(sessionId, userId, {
        role: 'assistant',
        content: MANUAL_GUIDE,
        intent,
      });
      yield {
        type: 'meta',
        intent,
        route,
        source: 'guide',
        lawRefs: [],
        fallbackUsed: true,
      };
      yield { type: 'disclaimer', text: DISCLAIMER_TEXT };
      yield { type: 'done', traceId };
      return;
    }

    const messages = this.buildPrompt(input, memories);
    let fullText = '';
    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

    try {
      for await (const chunk of this.llm.stream(messages, { temperature: 0.3 })) {
        if (chunk.delta) {
          fullText += chunk.delta;
          yield { type: 'chunk', delta: chunk.delta };
        }
        if (chunk.usage) {
          usage = chunk.usage;
        }
        if (chunk.done) break;
      }

      // 空回复兜底
      if (fullText.trim() === '') {
        fullText = MANUAL_GUIDE;
        yield { type: 'chunk', delta: fullText };
      }

      // 法条引用校验（MVP 桩：仅提取，全 unverified）
      const lawCheck = await this.llm.validateLawRefs(fullText);
      const lawRefs: LawRef[] = [...lawCheck.verified, ...lawCheck.unverified];

      await this.memory.appendDialog(sessionId, userId, {
        role: 'assistant',
        content: fullText,
        intent,
      });

      this.logger?.info('orchestrate LLM 流式完成', {
        intent,
        route,
        chars: fullText.length,
        lawRefs: lawRefs.length,
        durationMs: Date.now() - startedAt,
      });

      yield {
        type: 'meta',
        intent,
        route,
        source: 'llm',
        lawRefs,
        usage,
        fallbackUsed: false,
      };
    } catch (err) {
      // LLM 失败 → 降级人工引导（07 §1.4 Fallback 最后一层）
      this.audit?.write('degradation', {
        reason: 'llm_stream_failed',
        intent,
        route,
        error: err instanceof Error ? err.message : String(err),
      });
      this.logger?.warn('orchestrate LLM 流式失败，降级人工引导', {
        intent,
        route,
        error: err instanceof Error ? err.message : String(err),
      });

      yield { type: 'chunk', delta: MANUAL_GUIDE };
      await this.memory.appendDialog(sessionId, userId, {
        role: 'assistant',
        content: MANUAL_GUIDE,
        intent,
      });
      yield {
        type: 'meta',
        intent,
        route,
        source: 'guide',
        lawRefs: [],
        fallbackUsed: true,
      };
    }

    yield { type: 'disclaimer', text: DISCLAIMER_TEXT };
    yield { type: 'done', traceId };
  }

  // ===== Prompt 构建（07 §五 用户记忆注入） =====

  private buildPrompt(input: string, memories: MemoryEntry[]): ChatMessage[] {
    const messages: ChatMessage[] = [{ role: 'system', content: LLM_SYSTEM_PROMPT }];

    // 注入用户偏好
    const pref = memories.find((m) => m.type === 'preference');
    if (pref) {
      messages.push({
        role: 'system',
        content: `用户偏好：${JSON.stringify(pref.value)}`,
      });
    }

    // 注入近期对话（多轮上下文）
    const dialogTurns = memories.filter((m) => m.type === 'dialog');
    if (dialogTurns.length > 0) {
      const ctxText = dialogTurns
        .map((m) => {
          const v = m.value as { role: string; content: string };
          return `${v.role === 'user' ? '用户' : '助手'}：${v.content}`;
        })
        .join('\n');
      messages.push({ role: 'system', content: `近期对话：\n${ctxText}` });
    }

    messages.push({ role: 'user', content: input });
    return messages;
  }

  // ===== 工具层占位（A4 实现） =====

  private toolPlaceholder(toolId?: string): string {
    if (toolId) {
      return `已识别工具调用意图（${toolId}），该工具能力建设中，暂不可用。建议直接描述您的具体需求。`;
    }
    return '已识别工具调用意图，工具能力建设中，暂不可用。建议直接描述您的具体需求。';
  }
}
