/**
 * MemoryManager —— 会话历史读写 + 相关记忆召回（A1-W3）。
 *
 * 职责（06 §八 MemoryManager + development-plan.md A1-W3）：
 *   1. appendDialog / getDialog / getRecentTurns：dialog_record 读写（TTL 90 天）
 *   2. getRelevantMemories(intent)：召回最近 3 轮 + 用户偏好，注入 LLM prompt 上下文
 *   3. saveMemory：保存偏好到 user_profile.legalPreferences
 *   4. updateCase / getCaseTimeline / cleanupOldest：延后 A2（case_record 集合未建），暂抛 NotImplemented
 *
 * 设计依据：06 §八 MemoryManager/MemoryEntry；05 dialog_record/user_profile schema；
 *           07 §五 Prompt 工程规范（用户记忆注入）。
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { IntentType } from '../../../types/intent';
import type { DialogTurn } from '../../../types/dialog';
import {
  DialogRecord,
  type DialogRecordDocument,
} from '../../../infra/database/schemas/dialog.schema';
import { UserProfile, type UserProfileDocument } from '../../../infra/database/schemas/user.schema';
import { requestContext } from '../../../common/context/request-context';
import type { AppLoggerService } from '../../platform/logger/logger.service';

/** dialog_record lean 投影类型（仅取 getRecentTurns 所需字段） */
interface DialogLean {
  messages?: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    ts: Date | string;
    traceId?: string;
  }>;
}

/** 记忆条目（06 §八 MemoryEntry） */
export interface MemoryEntry {
  type: 'preference' | 'case' | 'dialog' | 'usage';
  key: string;
  value: unknown;
  ts: string;
}

/** 会话消息写入入参 */
export interface AppendMessageInput {
  role: 'user' | 'assistant' | 'system';
  content: string;
  intent?: string;
}

/** TTL 90 天（秒），对齐 dialog_record.expireAt */
const DIALOG_TTL_MS = 90 * 24 * 3600 * 1000;
/** getRelevantMemories 召回最近 N 轮 */
const RECENT_TURNS_FOR_MEMORY = 3;

@Injectable()
export class MemoryManagerService {
  constructor(
    @InjectModel(DialogRecord.name) private readonly dialogModel: Model<DialogRecordDocument>,
    @InjectModel(UserProfile.name) private readonly userModel: Model<UserProfileDocument>,
    private readonly logger?: AppLoggerService,
  ) {}

  // ===== 会话历史读写 =====

  /** 追加一轮会话消息（不存在则创建会话，TTL 90 天） */
  async appendDialog(sessionId: string, userId: string, msg: AppendMessageInput): Promise<void> {
    if (!sessionId || !userId) {
      this.logger?.warn('appendDialog 参数缺失', { sessionId, userId });
      return;
    }
    const now = new Date();
    const ctx = requestContext.get();
    const expireAt = new Date(now.getTime() + DIALOG_TTL_MS);

    try {
      await this.dialogModel
        .updateOne(
          { sessionId },
          {
            $setOnInsert: { sessionId, userId, expireAt },
            $set: { userId, expireAt },
            $push: {
              messages: {
                role: msg.role,
                content: msg.content,
                ts: now,
                traceId: ctx?.traceId,
              },
            },
          },
          { upsert: true },
        )
        .exec();
    } catch (err) {
      // 写入失败不阻塞主流程，仅记日志（对话历史非关键路径）
      this.logger?.error('appendDialog 写入失败', {
        sessionId,
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 读取整段会话 */
  async getDialog(sessionId: string): Promise<DialogLean | null> {
    if (!sessionId) return null;
    return this.dialogModel.findOne({ sessionId }).lean<DialogLean>().exec();
  }

  /** 取最近 N 轮（默认 3 轮），转换为 DialogTurn */
  async getRecentTurns(sessionId: string, n = RECENT_TURNS_FOR_MEMORY): Promise<DialogTurn[]> {
    const doc = await this.getDialog(sessionId);
    if (!doc || !doc.messages || doc.messages.length === 0) return [];
    const recent = doc.messages.slice(-n);
    return recent.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      ts: m.ts instanceof Date ? m.ts.toISOString() : String(m.ts),
    }));
  }

  // ===== 相关记忆召回 =====

  /**
   * 召回与当前意图相关的记忆（最近 3 轮 + 用户偏好）。
   * 用于 LLM prompt 注入（07 §五 用户记忆段）。
   */
  async getRelevantMemories(intent: IntentType): Promise<MemoryEntry[]> {
    const ctx = requestContext.get();
    const sessionId = ctx?.traceId; // 降级：A1-W3 无显式 sessionId 时用 traceId
    const userId = ctx?.userId;
    const memories: MemoryEntry[] = [];
    const now = new Date().toISOString();

    // 1. 最近 3 轮会话
    if (sessionId) {
      try {
        const turns = await this.getRecentTurns(sessionId);
        for (const t of turns) {
          memories.push({
            type: 'dialog',
            key: `${sessionId}#${t.ts}`,
            value: { role: t.role, content: t.content },
            ts: t.ts,
          });
        }
      } catch (err) {
        this.logger?.warn('getRelevantMemories 读取会话失败，降级跳过', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2. 用户偏好
    if (userId) {
      try {
        const user = await this.userModel
          .findOne({ userId })
          .select({ legalPreferences: 1 })
          .lean<{ legalPreferences?: Record<string, unknown> }>()
          .exec();
        const prefs = user?.legalPreferences;
        if (prefs && Object.keys(prefs).length > 0) {
          memories.push({
            type: 'preference',
            key: `user_pref_${userId}`,
            value: prefs,
            ts: now,
          });
        }
      } catch (err) {
        this.logger?.warn('getRelevantMemories 读取偏好失败，降级跳过', {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 3. 当前意图作为 usage 记忆（供 prompt 标注当前请求上下文）
    memories.push({ type: 'usage', key: 'current_intent', value: intent, ts: now });

    this.logger?.debug('getRelevantMemories 召回完成', {
      intent,
      count: memories.length,
      dialogTurns: memories.filter((m) => m.type === 'dialog').length,
    });
    return memories;
  }

  // ===== 偏好保存 =====

  /** 保存记忆：偏好写 user_profile.legalPreferences，会话上下文写 dialog_record.context */
  async saveMemory(entry: MemoryEntry): Promise<void> {
    const ctx = requestContext.get();
    const userId = ctx?.userId;

    try {
      if (entry.type === 'preference') {
        if (!userId) {
          this.logger?.warn('saveMemory preference 无 userId，跳过', { key: entry.key });
          return;
        }
        // 偏好合并写入 legalPreferences.<key>
        await this.userModel
          .updateOne(
            { userId },
            { $set: { [`legalPreferences.${entry.key}`]: entry.value } },
            { upsert: true },
          )
          .exec();
      } else if (entry.type === 'dialog' || entry.type === 'usage') {
        // 会话级上下文写 dialog_record.context
        const sessionId = ctx?.traceId;
        if (!sessionId) return;
        await this.dialogModel
          .updateOne(
            { sessionId },
            { $set: { [`context.${entry.key}`]: entry.value } },
            { upsert: true },
          )
          .exec();
      } else if (entry.type === 'case') {
        // case 记忆依赖 A2 case_record 集合，暂记日志
        this.logger?.warn('saveMemory case 类型延后 A2 实现', { key: entry.key });
      }
    } catch (err) {
      this.logger?.error('saveMemory 写入失败', {
        type: entry.type,
        key: entry.key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ===== A2 延后方法 =====

  /** 更新案件（A2 case_record 集合就绪后实现） */
  async updateCase(_caseData: unknown): Promise<void> {
    this.logger?.warn('updateCase 延后 A2 实现（case_record 集合未建）');
  }

  /** 取案件时间线（A2 实现） */
  async getCaseTimeline(_caseId: string): Promise<never[]> {
    this.logger?.warn('getCaseTimeline 延后 A2 实现（case_record 集合未建）', { caseId: _caseId });
    return [];
  }

  /** 清理最旧记忆（A2 实现） */
  async cleanupOldest(_n: number): Promise<void> {
    this.logger?.warn('cleanupOldest 延后 A2 实现', { n: _n });
  }
}
