/**
 * ToolAgent —— 法律工具 Agent（v2.3-W1，14-tool-design.md §一 1.3）。
 *
 * 包装 8 个 LegalTool 为统一 LegalAgent 接口，纳入 AgentRegistry。
 *
 * 调用流程：
 *   1. OrchestratorAgent / 外部调用方按 capability（tool.<toolId>）调用
 *   2. ToolAgent 从 capability 剥离 'tool.' 前缀得到 toolId
 *   3. 构造 ToolContext（从 AgentContext + AgentInvokeInput 派生）
 *   4. 调用 ToolRegistry.dispatch(toolId, params, ctx)
 *   5. 将 ToolResult 转 AgentInvokeOutput
 *
 * capability ↔ toolId 映射（与 14-tool-design.md §2.1 ToolId 对齐）：
 *   - tool.period_calculator → PeriodCalculatorTool
 *   - tool.document_review → DocumentReviewerTool
 *   - tool.compensation_query → CompensationQueryTool
 *   - tool.license_ocr → LicenseOcrTool
 *   - tool.law_validity → LawValidityTool
 *   - tool.cause_classification → CauseClassifierTool
 *   - tool.sentencing_guide → SentencingGuideTool
 *   - tool.clause_recommender → ClauseRecommenderTool
 *
 * 降级策略：
 *   - ToolRegistry 未注入（@Optional）→ 返回 NOT_IMPLEMENTED 7005（保持桩行为）
 *   - toolId 未注册（8002）→ 返回 7005 + errorMessage
 *   - 工具调用失败（8001/8004/8005/8006/8007/8009）→ 返回 ok=false + errorCode 映射
 *   - 工具超时（8003）→ 抛错触发 BaseAgent 超时降级
 *
 * 设计依据：14-tool-design.md §一 1.3 与 v2.1 Agent 的关系；§二统一接口。
 */
import { Injectable, Optional } from '@nestjs/common';
import { BaseAgent } from './base.agent';
import type { AgentCard, AgentContext, AgentInvokeInput, AgentInvokeOutput } from './types';
import { AGENT_ERROR_CODES } from './types';
import { PiiService } from '../../platform/pii/pii.service';
import { AuditLogService } from '../../platform/audit/audit-log.service';
import { AppLoggerService } from '../../platform/logger/logger.service';
import { DISCLAIMER_TEXT } from '../chat/sse-frames';
import {
  LegalToolError,
  TOOL_ERROR_CODES,
  type ToolContext,
  type ToolId,
  type ToolResult,
} from '../../../services/legal/tools/types';
import { ToolRegistry } from '../../../services/legal/tools/registry';
import { OcrServiceImpl } from '../vision/ocr-service.impl';

/** ToolAgent 的 8 个 capability（与 14-tool-design.md §2.1 ToolId 对齐） */
export const TOOL_CAPABILITIES = [
  'tool.period_calculator',
  'tool.document_review',
  'tool.compensation_query',
  'tool.license_ocr',
  'tool.law_validity',
  'tool.cause_classification',
  'tool.sentencing_guide',
  'tool.clause_recommender',
] as const;

/** capability → toolId 映射（剥离 'tool.' 前缀） */
function capabilityToToolId(capability: string): ToolId | null {
  if (!capability.startsWith('tool.')) return null;
  const id = capability.slice(5);
  const valid: ToolId[] = [
    'period_calculator',
    'document_review',
    'compensation_query',
    'license_ocr',
    'law_validity',
    'cause_classification',
    'sentencing_guide',
    'clause_recommender',
  ];
  return valid.includes(id as ToolId) ? (id as ToolId) : null;
}

const TOOL_CARD: AgentCard = {
  agentId: 'tool',
  name: '法律工具',
  description:
    '法律工具调用（法条效力查询/期间计算/赔偿标准/案由分类/量刑指导/条款推荐/证照OCR/文书审核 8 项）',
  version: '1.0.0',
  capabilities: [...TOOL_CAPABILITIES],
  inputSchema: {
    type: 'object',
    properties: {
      toolId: { type: 'string', description: '工具 ID（如 period_calculator）' },
      args: { type: 'object', description: '工具入参' },
    },
    required: ['toolId'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      result: { type: 'object', description: '工具计算结果' },
      disclaimer: { type: 'string' },
      lawRefs: { type: 'array' },
      traceId: { type: 'string' },
    },
    required: ['disclaimer', 'lawRefs', 'traceId'],
  },
  piiLevel: 'L2',
  exposure: 'L-Read',
  async: false,
  timeout: 10_000,
};

@Injectable()
export class ToolAgent extends BaseAgent {
  readonly card = TOOL_CARD;

  constructor(
    @Optional() private readonly toolRegistry?: ToolRegistry,
    @Optional() pii?: PiiService,
    @Optional() audit?: AuditLogService,
    @Optional() logger?: AppLoggerService,
    @Optional() private readonly ocrService?: OcrServiceImpl,
  ) {
    super(pii, audit, logger);
  }

  protected async execute(input: AgentInvokeInput, ctx: AgentContext): Promise<AgentInvokeOutput> {
    // 1. 降级：ToolRegistry 未注入 → 返回 NOT_IMPLEMENTED（保持桩行为）
    if (!this.toolRegistry) {
      this.logger?.warn('ToolRegistry 未注入，ToolAgent 降级为桩', {
        agentId: this.card.agentId,
        capability: input.capability,
        traceId: ctx.traceId,
      });
      return {
        ok: false,
        data: {},
        lawRefs: [],
        disclaimer: DISCLAIMER_TEXT,
        verified: false,
        usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
        errorCode: AGENT_ERROR_CODES.NOT_IMPLEMENTED,
        errorMessage: `ToolAgent 未注入 ToolRegistry（v2.3 阶段未启用工具域）`,
      };
    }

    // 2. 解析 capability → toolId
    const capability = input.capability || this.card.capabilities[0];
    const toolId = capabilityToToolId(capability);
    if (!toolId) {
      return {
        ok: false,
        data: {},
        lawRefs: [],
        disclaimer: DISCLAIMER_TEXT,
        verified: false,
        usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
        errorCode: AGENT_ERROR_CODES.NOT_IMPLEMENTED,
        errorMessage: `ToolAgent 无法解析 capability: ${capability}`,
      };
    }

    // 3. 提取工具入参：params.args 或 params 本身
    const args = (input.params.args as Record<string, unknown>) ?? input.params;

    // 4. 构造 ToolContext
    const toolCtx: ToolContext = {
      userId: ctx.callerUserId,
      traceId: ctx.traceId,
      requestId: `${ctx.traceId}-${toolId}`,
      // v2.4：注入视觉 OCR 服务（LicenseOcrTool 通过 ctx.ocrService 调用）
      ...(this.ocrService ? { ocrService: this.ocrService } : {}),
    };

    // 5. 调用 ToolRegistry.dispatch
    try {
      const result: ToolResult = await this.toolRegistry.dispatch(toolId, args, toolCtx);
      return {
        ok: true,
        data: {
          toolId,
          result: result.data ?? {},
          ...(result.warnings ? { warnings: result.warnings } : {}),
          ...(result.degraded ? { degraded: result.degraded } : {}),
          traceId: ctx.traceId,
        },
        lawRefs: result.lawRefs ?? [],
        disclaimer: result.disclaimer,
        verified: true,
        usage: {
          durationMs: result.duration ?? 0,
          tokensIn: 0,
          tokensOut: 0,
          ...(result.fromCache ? { cacheHit: 'tool:cache' } : {}),
        },
      };
    } catch (err) {
      // LegalToolError → 映射为 AgentInvokeOutput.ok=false
      if (err instanceof LegalToolError) {
        // 8003 超时 → 重新抛出，由 BaseAgent 触发 fallbackAgentId
        if (err.code === TOOL_ERROR_CODES.TIMEOUT) {
          throw err;
        }
        return {
          ok: false,
          data: { toolId, errorCode: err.code, errorMessage: err.message },
          lawRefs: [],
          disclaimer: DISCLAIMER_TEXT,
          verified: false,
          usage: { durationMs: 0, tokensIn: 0, tokensOut: 0 },
          errorCode: AGENT_ERROR_CODES.NOT_IMPLEMENTED,
          errorMessage: `[${err.code}] ${err.message}`,
        };
      }
      // 未知错误 → 重新抛出，由 BaseAgent 捕获并审计 failed
      throw err;
    }
  }
}
