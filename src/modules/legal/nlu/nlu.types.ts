/**
 * NLU 域共享类型（v2.3-W4，07 §八）。
 *
 * 定义实体抽取、多轮澄清、复合意图拆分的运行时类型契约。
 * Schema 持久化类型见 src/infra/database/schemas/{entity-extraction,clarification-session}.schema.ts。
 *
 * 设计依据：07 §8.1 EntityExtractor I/O；07 §8.2 ClarificationManager I/O；07 §8.3 CompoundIntentSplitter I/O。
 */
import type { IntentType, RouteTarget } from '../../../types/intent';
import type {
  EntityType,
  EntitySource,
} from '../../../infra/database/schemas/entity-extraction.schema';
import type { ClarificationState } from '../../../infra/database/schemas/clarification-session.schema';

/** 实体（运行时类型，与 schema EntityEntry 对齐） */
export interface Entity {
  type: EntityType;
  value: string;
  span: [number, number];
  confidence: number;
  source: EntitySource;
}

/** 实体抽取结果 */
export interface EntityExtractResult {
  entities: Entity[];
  warnings: string[];
  /** 8010 = L3 LLM 降级，仅 L1+L2 */
  degradedCode?: number;
  modelVersion?: string;
  /** Prompt 模板版本号（数字，便于版本比较） */
  promptVersion?: number;
  tokensIn?: number;
  tokensOut?: number;
}

/** 澄清选项 */
export interface ClarifyOption {
  label: string;
  value: string;
  /** 选中后填充到哪个槽位、什么值 */
  fill: { slot: string; value: unknown };
}

/** 澄清卡片（07 §8.2 选项卡格式） */
export interface ClarificationCard {
  question: string;
  options: ClarifyOption[];
  allowFreeText: boolean;
  /** 缺失槽位名 */
  missingSlot: string;
}

/** 澄清管理器返回 */
export interface ClarifyResult {
  clarification: ClarificationCard | null;
  sessionId: string;
  /** 状态机当前态 */
  state: ClarificationState;
  /** give_up 时降级到的兜底意图 */
  fallbackIntent?: 'general_qa';
  turns: number;
  /** 8011 = 澄清会话超时 */
  errorCode?: number;
  errorMessage?: string;
}

/** 复合意图子句 */
export interface SubIntent {
  index: number;
  subIntent: IntentType;
  subText: string;
  confidence: number;
  route: RouteTarget;
  entities: Entity[];
  /** 依赖的前置子句 index 列表 */
  dependsOn: number[];
}

/** 复合意图拆分结果 */
export interface CompoundSplitResult {
  subIntents: SubIntent[];
  /** 拓扑序排列后的子句 index */
  executionOrder: number[];
  isCompound: boolean;
  warnings: string[];
}

/** 对话轮次（供 splitter 指代判断） */
export interface DialogTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** NLU 上下文（精简版 DialogContext，供跨轮消解） */
export interface NluContext {
  sessionId?: string;
  userId?: string;
  msgId?: string;
  /** 上一轮抽取的实体（用于 L4 指代消解） */
  lastTurnEntities?: Entity[];
  /** 最近若干轮对话（供 splitter 指代判断） */
  recentTurns?: DialogTurn[];
}

/** NLU 错误码（07 §8.1/8.2 降级） */
export const NLU_ERROR_CODES = {
  /** L3 LLM NER 降级（仅 L1+L2 结果） */
  LLM_DEGRADED: 8010,
  /** 澄清会话超时（3 轮上限） */
  CLARIFY_TIMEOUT: 8011,
} as const;
