/**
 * CaseAnalysisAgent —— 案件分析 Agent（A4-W2，A4 §五 5.1 #6）。
 *
 * capability: case.analyze
 * 包装：RagService（案例召回）+ LlmService（案件分析生成）
 * exposure: L-Write-Limited（对外受限写）
 * async: true（LLM 生成耗时较长）
 * fallback: 无
 *
 * 职责：
 *   1. 接收案件描述，RagService 召回相关案例与法条
 *   2. 构造 LLM prompt（案件描述 + 召回上下文 + 系统提示）
 *   3. 调用 LlmService.generate 生成分析结论
 *   4. validateLawRefs 校验法条引用
 *
 * 编排计划（A4 §6.2）：
 *   - case_analysis 意图：并行召回（case-search // law-lookup）→ 串行分析（case-analysis）
 *   - 异步任务：返回 jobId
 *
 * 设计依据：A4 §五 5.1；A2 §4.2 RagService；A3 LlmService；07 §五 Prompt 工程。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { BaseAgent } from './base.agent';
import type { AgentCard, AgentContext, AgentInvokeInput, AgentInvokeOutput } from './types';
import type { PiiService } from '../../platform/pii/pii.service';
import type { AuditLogService } from '../../platform/audit/audit-log.service';
import type { AppLoggerService } from '../../platform/logger/logger.service';
import type { RagService } from '../retrieval/rag.service';
import type { LlmService, ChatMessage, LawRef } from '../../../types/llm';
import { LLM_SERVICE_TOKEN } from '../intent/intent-router.service';
import { DISCLAIMER_TEXT } from '../chat/sse-frames';

const CARD: AgentCard = {
  agentId: 'case-analysis',
  name: '案件分析',
  description: '案件分析（RAG 召回 + LLM 生成 + 法条校验）',
  version: '1.0.0',
  capabilities: ['case.analyze'],
  inputSchema: {
    type: 'object',
    properties: {
      caseDescription: { type: 'string', description: '案件描述' },
      question: { type: 'string', description: '分析问题（如 能否胜诉/判多重）' },
      retrievedContext: { type: 'string', description: '编排器并行召回的上下文（可选）' },
    },
    required: ['caseDescription'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      analysis: { type: 'string', description: '分析结论' },
      retrievedCases: { type: 'array' },
      disclaimer: { type: 'string' },
      lawRefs: { type: 'array' },
      traceId: { type: 'string' },
    },
    required: ['disclaimer', 'lawRefs', 'traceId'],
  },
  piiLevel: 'L3', // 案件描述可能含当事人信息
  exposure: 'L-Write-Limited',
  async: true,
  timeout: 60_000, // LLM 生成可能较慢
};

/** 案件分析系统提示（07 §五 Prompt 工程） */
const CASE_ANALYSIS_SYSTEM_PROMPT =
  '你是法律案件分析助手，基于案件事实和相关法条进行客观分析。' +
  '回答需引用具体法条，标注法律名称与条号。' +
  '分析应包含：法律关系认定、争议焦点、法律适用、可能结论。';

@Injectable()
export class CaseAnalysisAgent extends BaseAgent {
  readonly card = CARD;

  constructor(
    @Optional() private readonly rag?: RagService,
    @Optional() @Inject(LLM_SERVICE_TOKEN) private readonly llm?: LlmService,
    @Optional() pii?: PiiService,
    @Optional() audit?: AuditLogService,
    @Optional() logger?: AppLoggerService,
  ) {
    super(pii, audit, logger);
  }

  protected async execute(input: AgentInvokeInput, ctx: AgentContext): Promise<AgentInvokeOutput> {
    const caseDescription = String(input.params.caseDescription ?? '').trim();
    if (!caseDescription) {
      return this.fail(1001, 'caseDescription 不能为空', ctx);
    }

    if (!this.llm) {
      return this.fail(5001, 'LlmService 未注入', ctx);
    }

    const question = String(input.params.question ?? '请分析本案的法律关系和可能结论');

    // 1. RAG 召回（若编排器未提供上下文）
    let retrievedContext = String(input.params.retrievedContext ?? '').trim();
    let retrievedCases: { title: string; content: string; score: number }[] = [];
    if (!retrievedContext && this.rag) {
      try {
        const results = await this.rag.retrieve({
          text: caseDescription,
          finalTopK: 5,
        });
        retrievedCases = results.map((r) => ({
          title: r.title,
          content: r.content.slice(0, 300),
          score: r.rrfScore ?? r.pathScore,
        }));
        retrievedContext = results
          .map((r) => `【${r.title}】${r.content.slice(0, 500)}`)
          .join('\n\n');
      } catch (err) {
        // RAG 失败不阻塞：降级到无上下文 LLM 生成
        this.logger?.warn('CaseAnalysis: RAG 召回失败，降级到无上下文生成', {
          traceId: ctx.traceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2. 构造 LLM prompt
    const userPrompt = this.buildPrompt(caseDescription, question, retrievedContext);

    // 3. LLM 生成
    const messages: ChatMessage[] = [
      { role: 'system', content: CASE_ANALYSIS_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    const llmResult = await this.llm.generate(messages, {
      temperature: 0.3, // 案件分析需要较低温度保证稳定性
      maxTokens: 2000,
    });

    // 4. 法条引用校验
    let lawRefs: LawRef[] = [];
    let verified = false;
    try {
      const checkResult = await this.llm.validateLawRefs(llmResult.content);
      lawRefs = [...checkResult.verified, ...checkResult.unverified];
      verified = checkResult.unverified.length === 0;
    } catch {
      // 法条校验失败：降级为未核实
      lawRefs = [];
      verified = false;
    }

    return {
      ok: true,
      data: {
        analysis: llmResult.content,
        retrievedCases,
        model: llmResult.model,
        finishReason: llmResult.finishReason,
      },
      lawRefs,
      disclaimer: DISCLAIMER_TEXT,
      verified,
      usage: {
        durationMs: 0,
        tokensIn: llmResult.usage.promptTokens,
        tokensOut: llmResult.usage.completionTokens,
      },
    };
  }

  /** 构造案件分析 prompt */
  private buildPrompt(caseDescription: string, question: string, context: string): string {
    const parts = ['案件描述：', caseDescription, ''];
    if (context) {
      parts.push('相关法条与案例：', context, '');
    }
    parts.push('分析问题：', question);
    return parts.join('\n');
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
