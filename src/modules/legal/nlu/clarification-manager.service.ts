/**
 * ClarificationManagerService —— 多轮主动澄清状态机（v2.3-W4，07 §8.2）。
 *
 * 状态机：asking → answered | timeout | give_up
 *   - asking：向用户追问缺失槽位
 *   - answered：所有必填槽位已填充
 *   - timeout：超过 CLARIFY_TURNS_MAX（3）轮未完成
 *   - give_up：超过 OFF_TOPIC_MAX_COUNT（2）次答非所问
 *
 * 职责：
 *   1. startClarify：识别意图 + 已抽取实体后，扫描 requiredSlots，缺失则生成澄清卡片
 *   2. answerClarify：用户回复后解析答案、填充槽位、判定下一步（继续追问 / 完成 / 超时 / give_up）
 *   3. 答非所问判定：用户回复与澄清问题无关时 offTopicCount++，达上限 give_up
 *   4. 兜底：timeout/give_up 时 fallbackIntent='general_qa'，由编排器降级
 *
 * 持久化：clarification_session 集合（@Optional 注入 Model，缺时仅内存）
 *
 * 设计依据：07 §8.2 第 1-7 步；05 3.25 clarification_session。
 */
import { Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import {
  ClarificationSession,
  type ClarificationSessionDocument,
  type ClarificationState,
} from '../../../infra/database/schemas/clarification-session.schema';
import { AppLoggerService } from '../../platform/logger/logger.service';
import type { IntentType } from '../../../types/intent';
import type {
  ClarificationCard,
  ClarifyOption,
  ClarifyResult,
  Entity,
  NluContext,
} from './nlu.types';
import { NLU_ERROR_CODES } from './nlu.types';
import {
  INTENT_REQUIRED_SLOTS,
  INTENT_CLARIFICATION_TEMPLATES,
  ENTITY_TO_SLOT_MAP,
  OFF_TOPIC_MAX_COUNT,
  CLARIFY_TURNS_MAX,
  CLARIFY_SESSION_TTL_SEC,
} from './intent-slots';

/** 内存会话表（DB 不可用时兜底） */
interface InMemorySession {
  sessionId: string;
  userId: string;
  msgId: string;
  intent: IntentType;
  requiredSlots: string[];
  filledSlots: Record<string, unknown>;
  state: ClarificationState;
  turns: number;
  offTopicCount: number;
  expireAt: Date;
  createdAt: Date;
  updatedAt: Date;
  /** 当前正在追问的槽位 */
  currentSlot?: string;
}

@Injectable()
export class ClarificationManagerService {
  /** 内存会话表：sessionId → session */
  private readonly sessions = new Map<string, InMemorySession>();
  /** userId → 活跃 sessionId 索引（便于按用户查活跃会话） */
  private readonly userActiveIndex = new Map<string, Set<string>>();

  constructor(
    @Optional()
    @InjectModel(ClarificationSession.name)
    private readonly sessionModel?: Model<ClarificationSessionDocument>,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  /**
   * 启动澄清流程：根据意图 + 已抽取实体，扫描缺失槽位。
   *
   * @returns ClarifyResult。若无缺失槽位，clarification=null 且 state='answered'。
   */
  async startClarify(
    intent: IntentType,
    entities: Entity[],
    ctx: NluContext,
  ): Promise<ClarifyResult> {
    const requiredSlots = INTENT_REQUIRED_SLOTS[intent] ?? [];
    const filledSlots = this.mapEntitiesToSlots(entities, intent);

    // 若已有活跃会话（用户在前一轮未回答），先关闭旧会话再开新的
    if (ctx.userId) {
      await this.closeActiveSessions(ctx.userId);
    }

    const sessionId = this.generateSessionId();
    const missingSlots = this.findMissingSlots(requiredSlots, filledSlots);

    const session: InMemorySession = {
      sessionId,
      userId: ctx.userId ?? 'anonymous',
      msgId: ctx.msgId ?? sessionId,
      intent,
      requiredSlots,
      filledSlots,
      state: missingSlots.length === 0 ? 'answered' : 'asking',
      turns: 0,
      offTopicCount: 0,
      expireAt: new Date(Date.now() + CLARIFY_SESSION_TTL_SEC * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
      currentSlot: missingSlots[0],
    };

    this.putSession(session);

    if (session.state === 'answered') {
      // 无需澄清，直接落库并返回
      await this.persist(session);
      return {
        clarification: null,
        sessionId,
        state: 'answered',
        turns: 0,
      };
    }

    // 生成澄清卡片
    const clarification = this.buildClarificationCard(intent, session.currentSlot!);

    // 持久化（异步）
    await this.persist(session);

    this.logger?.debug('澄清流程启动', {
      sessionId,
      intent,
      requiredSlots,
      missingSlots,
      currentSlot: session.currentSlot,
    });

    return {
      clarification,
      sessionId,
      state: 'asking',
      turns: 0,
    };
  }

  /**
   * 处理用户对澄清的回复。
   *
   * @param sessionId 澄清会话 ID
   * @param reply 用户回复文本
   * @param ctx NLU 上下文（可携带本轮新抽取的实体，便于补全其他槽位）
   */
  async answerClarify(sessionId: string, reply: string, ctx?: NluContext): Promise<ClarifyResult> {
    const session = await this.loadSession(sessionId);
    if (!session) {
      // 会话不存在或已过期：返回 timeout 兜底
      return {
        clarification: null,
        sessionId,
        state: 'timeout',
        turns: CLARIFY_TURNS_MAX,
        fallbackIntent: 'general_qa',
        errorCode: NLU_ERROR_CODES.CLARIFY_TIMEOUT,
        errorMessage: '澄清会话不存在或已过期',
      };
    }

    if (
      session.state === 'answered' ||
      session.state === 'timeout' ||
      session.state === 'give_up'
    ) {
      // 已终结的会话不再处理
      return {
        clarification: null,
        sessionId,
        state: session.state,
        turns: session.turns,
        fallbackIntent: session.state === 'answered' ? undefined : 'general_qa',
      };
    }

    // 轮数 +1
    session.turns += 1;
    session.updatedAt = new Date();

    // 解析用户回复，填充 currentSlot
    const filled = this.parseReply(reply, session.intent, session.currentSlot);
    if (filled !== null && filled !== undefined) {
      session.filledSlots[session.currentSlot!] = filled;
    } else if (ctx?.lastTurnEntities?.length) {
      // 用户回复中无明确答案，但本轮实体抽取补全了该槽位
      const fromEntities = this.mapEntitiesToSlots(ctx.lastTurnEntities, session.intent);
      if (fromEntities[session.currentSlot!] !== undefined) {
        session.filledSlots[session.currentSlot!] = fromEntities[session.currentSlot!];
      } else {
        session.offTopicCount += 1;
      }
    } else {
      session.offTopicCount += 1;
    }

    // 判定终态
    // 1. give_up：答非所问次数超限
    if (session.offTopicCount >= OFF_TOPIC_MAX_COUNT) {
      session.state = 'give_up';
      await this.persist(session);
      this.logger?.warn('澄清会话 give_up（答非所问超限）', {
        sessionId,
        offTopicCount: session.offTopicCount,
      });
      return {
        clarification: null,
        sessionId,
        state: 'give_up',
        turns: session.turns,
        fallbackIntent: 'general_qa',
      };
    }

    // 2. answered：所有必填槽位已填满（优先于 timeout，用户成功回答应判定为成功）
    const missingSlots = this.findMissingSlots(session.requiredSlots, session.filledSlots);
    if (missingSlots.length === 0) {
      session.state = 'answered';
      await this.persist(session);
      this.logger?.debug('澄清完成', { sessionId, turns: session.turns });
      return {
        clarification: null,
        sessionId,
        state: 'answered',
        turns: session.turns,
      };
    }

    // 3. timeout：轮数超限且仍有缺失槽位
    if (session.turns >= CLARIFY_TURNS_MAX) {
      session.state = 'timeout';
      await this.persist(session);
      this.logger?.warn('澄清会话 timeout（轮数超限）', {
        sessionId,
        turns: session.turns,
      });
      return {
        clarification: null,
        sessionId,
        state: 'timeout',
        turns: session.turns,
        fallbackIntent: 'general_qa',
        errorCode: NLU_ERROR_CODES.CLARIFY_TIMEOUT,
        errorMessage: `澄清轮数超限（${CLARIFY_TURNS_MAX}）`,
      };
    }

    // 4. 还有缺失槽位，继续追问
    session.currentSlot = missingSlots[0];
    session.state = 'asking';
    await this.persist(session);

    const clarification = this.buildClarificationCard(session.intent, session.currentSlot);
    return {
      clarification,
      sessionId,
      state: 'asking',
      turns: session.turns,
    };
  }

  /** 查询某用户当前活跃的澄清会话（便于编排器决定是否先续接会话） */
  async findActiveSession(userId: string): Promise<InMemorySession | null> {
    // 优先从内存查
    const ids = this.userActiveIndex.get(userId);
    if (ids && ids.size > 0) {
      for (const id of ids) {
        const s = this.sessions.get(id);
        if (s && s.state === 'asking' && s.expireAt > new Date()) {
          return s;
        }
      }
    }
    // DB 查询
    if (this.sessionModel) {
      try {
        const doc = await this.sessionModel
          .findOne({ userId, state: 'asking', expireAt: { $gt: new Date() } })
          .sort({ updatedAt: -1 })
          .lean()
          .exec();
        if (doc) {
          return {
            sessionId: doc.sessionId,
            userId: doc.userId,
            msgId: doc.msgId,
            intent: doc.intent as IntentType,
            requiredSlots: doc.requiredSlots ?? [],
            filledSlots: doc.filledSlots ?? {},
            state: doc.state as ClarificationState,
            turns: doc.turns ?? 0,
            offTopicCount: doc.offTopicCount ?? 0,
            expireAt: doc.expireAt,
            createdAt: doc.createdAt ?? new Date(),
            updatedAt: doc.updatedAt ?? new Date(),
            currentSlot: doc.requiredSlots?.find(
              (slot) => (doc.filledSlots ?? {})[slot] === undefined,
            ),
          };
        }
      } catch (err) {
        this.logger?.warn('查询活跃澄清会话失败', {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return null;
  }

  /** 获取会话已填充的槽位（编排器在 answered 后取用） */
  getFilledSlots(sessionId: string): Record<string, unknown> | null {
    const s = this.sessions.get(sessionId);
    return s ? { ...s.filledSlots } : null;
  }

  // ===== 内部辅助 =====

  /** 实体 → 槽位映射（07 §8.2 第 1 步 mapEntitiesToSlots） */
  private mapEntitiesToSlots(entities: Entity[], _intent: IntentType): Record<string, unknown> {
    const slots: Record<string, unknown> = {};
    for (const e of entities) {
      const slotName = ENTITY_TO_SLOT_MAP[e.type];
      if (slotName && slots[slotName] === undefined) {
        slots[slotName] = e.value;
      }
    }
    // case_analysis 的 caseDescription：使用整个文本（由调用方在 ctx 中提供，此处略）
    return slots;
  }

  /** 找出未填充的必填槽位 */
  private findMissingSlots(required: string[], filled: Record<string, unknown>): string[] {
    return required.filter(
      (slot) => filled[slot] === undefined || filled[slot] === null || filled[slot] === '',
    );
  }

  /** 构造澄清卡片 */
  private buildClarificationCard(intent: IntentType, slot: string): ClarificationCard {
    const templates = INTENT_CLARIFICATION_TEMPLATES[intent] ?? {};
    const tpl = templates[slot];
    if (!tpl) {
      // 兜底：通用追问
      return {
        question: `请提供${slot}信息`,
        options: [],
        allowFreeText: true,
        missingSlot: slot,
      };
    }

    const options: ClarifyOption[] = (tpl.presetOptions ?? []).map((o) => ({
      label: o.label,
      value: o.value,
      fill: { slot, value: o.value },
    }));

    return {
      question: tpl.question,
      options,
      allowFreeText: tpl.allowFreeText,
      missingSlot: slot,
    };
  }

  /**
   * 解析用户回复：优先匹配预设选项，否则作为 free text 填入。
   * @returns 填充值；null 表示答非所问
   */
  private parseReply(reply: string, intent: IntentType, slot: string | undefined): unknown {
    if (!slot) return null;
    const replyTrim = reply.trim();
    if (!replyTrim) return null;

    const templates = INTENT_CLARIFICATION_TEMPLATES[intent] ?? {};
    const tpl = templates[slot];

    // 优先精确匹配预设选项 value
    if (tpl?.presetOptions) {
      for (const opt of tpl.presetOptions) {
        if (replyTrim === opt.value || replyTrim === opt.label) {
          return opt.value;
        }
      }
      // 部分包含匹配（如用户输入"租赁"匹配"租赁合同纠纷"）
      for (const opt of tpl.presetOptions) {
        if (opt.value.includes(replyTrim) || replyTrim.includes(opt.value)) {
          return opt.value;
        }
      }
    }

    // free text：若模板允许，直接作为值
    if (tpl?.allowFreeText) {
      return replyTrim;
    }

    // 模板不允许 free text 且未匹配预设：视为答非所问
    return null;
  }

  /** 生成 sessionId */
  private generateSessionId(): string {
    return `clr-${randomUUID()}`;
  }

  /** 写入内存索引 */
  private putSession(session: InMemorySession): void {
    this.sessions.set(session.sessionId, session);
    if (!this.userActiveIndex.has(session.userId)) {
      this.userActiveIndex.set(session.userId, new Set());
    }
    this.userActiveIndex.get(session.userId)!.add(session.sessionId);
  }

  /** 加载会话：内存优先，DB 兜底 */
  private async loadSession(sessionId: string): Promise<InMemorySession | null> {
    const inMem = this.sessions.get(sessionId);
    if (inMem) {
      if (inMem.expireAt <= new Date()) {
        // 已过期
        this.sessions.delete(sessionId);
        return null;
      }
      return inMem;
    }

    if (this.sessionModel) {
      try {
        const doc = await this.sessionModel.findOne({ sessionId }).lean().exec();
        if (!doc) return null;
        if (doc.expireAt <= new Date()) return null;
        const session: InMemorySession = {
          sessionId: doc.sessionId,
          userId: doc.userId,
          msgId: doc.msgId,
          intent: doc.intent as IntentType,
          requiredSlots: doc.requiredSlots ?? [],
          filledSlots: doc.filledSlots ?? {},
          state: doc.state as ClarificationState,
          turns: doc.turns ?? 0,
          offTopicCount: doc.offTopicCount ?? 0,
          expireAt: doc.expireAt,
          createdAt: doc.createdAt ?? new Date(),
          updatedAt: doc.updatedAt ?? new Date(),
          currentSlot: (doc.requiredSlots ?? []).find(
            (slot) => (doc.filledSlots ?? {})[slot] === undefined,
          ),
        };
        this.putSession(session);
        return session;
      } catch (err) {
        this.logger?.warn('加载澄清会话失败', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    }

    return null;
  }

  /** 关闭用户的所有活跃会话（启动新澄清前清理） */
  private async closeActiveSessions(userId: string): Promise<void> {
    const ids = this.userActiveIndex.get(userId);
    if (ids) {
      for (const id of ids) {
        const s = this.sessions.get(id);
        if (s && s.state === 'asking') {
          s.state = 'give_up';
          await this.persist(s);
        }
      }
    }
    // DB 中也清理（批量更新）
    if (this.sessionModel) {
      try {
        await this.sessionModel.updateMany(
          { userId, state: 'asking' },
          { $set: { state: 'give_up' } },
        );
      } catch (err) {
        this.logger?.warn('关闭活跃澄清会话失败', {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /** 持久化会话到 DB */
  private async persist(session: InMemorySession): Promise<void> {
    if (!this.sessionModel) return;
    try {
      await this.sessionModel.updateOne(
        { sessionId: session.sessionId },
        {
          $set: {
            sessionId: session.sessionId,
            userId: session.userId,
            msgId: session.msgId,
            intent: session.intent,
            requiredSlots: session.requiredSlots,
            filledSlots: session.filledSlots,
            state: session.state,
            turns: session.turns,
            offTopicCount: session.offTopicCount,
            expireAt: session.expireAt,
          },
        },
        { upsert: true },
      );
    } catch (err) {
      this.logger?.warn('澄清会话持久化失败', {
        sessionId: session.sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
