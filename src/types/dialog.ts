/**
 * 会话上下文共享类型契约（A1-W3）。
 *
 * 权威源：docs/design/06-api-spec.md §八 DialogContext/DialogTurn。
 * 设计依据：07 §1.5 IntentRouter.classify 输入 ctx；MemoryManager 读写 recentTurns。
 */
import type { IntentType } from './intent';

/** 单轮对话 */
export interface DialogTurn {
  role: 'user' | 'assistant';
  content: string;
  /** 该轮命中的意图（assistant 轮可空） */
  intent?: IntentType;
  /** 时间戳 ISO 字符串 */
  ts: string;
}

/** 会话上下文（IntentRouter 与 MemoryManager 共享） */
export interface DialogContext {
  sessionId: string;
  userId?: string;
  /** 上一轮意图（用于 contextBonus 多轮延续判定） */
  lastIntent?: IntentType;
  /** 待生成文书占位（document_generate 多轮填充） */
  pendingDocument?: string | null;
  /** 关联案件 ID（case_reasoning 复用） */
  relatedCaseId?: string | null;
  /** 未解决澄清次数 */
  unresolvedCount: number;
  /** 最近 12 轮对话（07 §1.5 withinRecentTurns 用） */
  recentTurns: DialogTurn[];
}
