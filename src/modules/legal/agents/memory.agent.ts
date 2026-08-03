/**
 * MemoryAgent —— 会话/长期记忆读写 Agent（A4-W2，A4 §五 5.1 #7）。
 *
 * capabilities: memory.read / memory.write
 * 包装：MemoryManagerService（dialog_record 读写 + user_profile 偏好）
 * exposure: L-Internal（仅编排器可调，不对外暴露）
 * async: false
 * fallback: 无
 *
 * 职责：
 *   1. memory.read：召回相关记忆（最近 3 轮 + 用户偏好），注入 LLM prompt
 *   2. memory.write：保存偏好/会话上下文
 *   3. capability 路由：根据 input.capability 决定读还是写
 *
 * 编排计划：
 *   - 不直接出现在 PLAN_BY_INTENT（记忆读写由 OrchestratorAgent 编排器内部调用）
 *   - L-Internal 暴露层级：listCards 默认不对外暴露
 *
 * 设计依据：A4 §五 5.1；06 §八 MemoryManager；07 §五 Prompt 工程（记忆注入）。
 */
import { Injectable, Optional } from '@nestjs/common';
import { BaseAgent } from './base.agent';
import type { AgentCard, AgentContext, AgentInvokeInput, AgentInvokeOutput } from './types';
import { PiiService } from '../../platform/pii/pii.service';
import { AuditLogService } from '../../platform/audit/audit-log.service';
import { AppLoggerService } from '../../platform/logger/logger.service';
import { MemoryManagerService } from '../memory/memory-manager.service';
import type { MemoryEntry } from '../memory/memory-manager.service';
import type { IntentType } from '../../../types/intent';
import { DISCLAIMER_TEXT } from '../chat/sse-frames';

const CARD: AgentCard = {
  agentId: 'memory',
  name: '记忆管理',
  description: '会话历史读写 + 用户偏好记忆（编排器内部调用，不对外暴露）',
  version: '1.0.0',
  capabilities: ['memory.read', 'memory.write'],
  inputSchema: {
    type: 'object',
    properties: {
      intent: { type: 'string', description: '当前意图（memory.read）' },
      entry: { type: 'object', description: '记忆条目（memory.write）' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      memories: { type: 'array', description: '召回的记忆列表' },
      disclaimer: { type: 'string' },
      lawRefs: { type: 'array' },
      traceId: { type: 'string' },
    },
    required: ['disclaimer', 'lawRefs', 'traceId'],
  },
  piiLevel: 'L2',
  exposure: 'L-Internal',
  async: false,
  timeout: 3_000,
};

@Injectable()
export class MemoryAgent extends BaseAgent {
  readonly card = CARD;

  constructor(
    @Optional() private readonly memoryManager?: MemoryManagerService,
    @Optional() pii?: PiiService,
    @Optional() audit?: AuditLogService,
    @Optional() logger?: AppLoggerService,
  ) {
    super(pii, audit, logger);
  }

  protected async execute(input: AgentInvokeInput, ctx: AgentContext): Promise<AgentInvokeOutput> {
    if (input.capability === 'memory.write') {
      return this.executeWrite(input, ctx);
    }
    return this.executeRead(input, ctx);
  }

  /** 召回相关记忆 */
  private async executeRead(
    input: AgentInvokeInput,
    ctx: AgentContext,
  ): Promise<AgentInvokeOutput> {
    if (!this.memoryManager) {
      return this.fail(5001, 'MemoryManagerService 未注入', ctx);
    }

    const intent = String(input.params.intent ?? 'general_qa') as IntentType;
    const memories = await this.memoryManager.getRelevantMemories(intent);

    return {
      ok: true,
      data: {
        memories: memories.map((m) => ({
          type: m.type,
          key: m.key,
          value: m.value,
          ts: m.ts,
        })),
        total: memories.length,
      },
      lawRefs: [],
      disclaimer: DISCLAIMER_TEXT,
      verified: false,
      usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
    };
  }

  /** 保存记忆 */
  private async executeWrite(
    input: AgentInvokeInput,
    ctx: AgentContext,
  ): Promise<AgentInvokeOutput> {
    if (!this.memoryManager) {
      return this.fail(5001, 'MemoryManagerService 未注入', ctx);
    }

    const entry = input.params.entry as MemoryEntry | undefined;
    if (!entry || !entry.type || !entry.key) {
      return this.fail(1001, 'entry 缺少 type 或 key', ctx);
    }

    await this.memoryManager.saveMemory(entry);

    return {
      ok: true,
      data: { saved: true, key: entry.key, type: entry.type },
      lawRefs: [],
      disclaimer: DISCLAIMER_TEXT,
      verified: false,
      usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
    };
  }

  private fail(code: number, message: string, _ctx: AgentContext): AgentInvokeOutput {
    return {
      ok: false,
      data: {},
      lawRefs: [],
      disclaimer: DISCLAIMER_TEXT,
      verified: false,
      usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
      errorCode: code,
      errorMessage: message,
    };
  }
}
