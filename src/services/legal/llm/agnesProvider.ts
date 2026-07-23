/**
 * AgnesProvider — Agnes 大模型核心实现。
 *
 * Agnes API 为 OpenAI 兼容协议：
 * - Base URL: https://apihub.agnes-ai.com/v1
 * - 端点: POST /chat/completions
 * - 默认模型: agnes-2.0-flash
 * - 请求体: { model, messages, temperature, max_tokens, top_p, stop, stream }
 * - 响应体: { id, model, object, created, choices:[{message, finish_reason}], usage }
 *
 * 复用 http.ts（超时 + 错误映射）、retry.ts（指数退避）、sse.ts（流解析）。
 * 不引入 openai SDK，保持协议透明，便于多供应商切换与错误精细映射。
 *
 * 设计依据：docs/design/06-api-spec.md 第八节 LlmService 契约。
 */

import type { LlmProvider } from './provider';
import type { ChatMessage, LlmOpts, LlmResponse, LlmChunk } from '../../../types/llm';
import type { ProviderConfig, LlmRuntimeConfig } from '../../../config/types';
import { httpJson, httpStream } from './http';
import { parseSse } from './sse';
import { withRetry } from './retry';
import { ParseError } from './errors';

/** Agnes OpenAI 兼容响应体 */
interface AgnesChatResponse {
  id?: string;
  model?: string;
  object?: string;
  created?: number;
  choices?: Array<{
    message?: { role?: string; content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** Agnes 流式分片（OpenAI 兼容 stream chunk） */
interface AgnesStreamChunk {
  choices?: Array<{
    delta?: { role?: string; content?: string };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class AgnesProvider implements LlmProvider {
  readonly name = 'agnes';
  readonly defaultModel: string;
  private readonly cfg: ProviderConfig;
  private readonly runtime: LlmRuntimeConfig;

  constructor(cfg: ProviderConfig, runtime: LlmRuntimeConfig) {
    this.cfg = cfg;
    this.runtime = runtime;
    this.defaultModel = cfg.defaultModel;
  }

  /** 组装 OpenAI 兼容请求体 */
  private buildBody(
    messages: ChatMessage[],
    opts: LlmOpts | undefined,
    stream: boolean,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: opts?.model ?? this.cfg.defaultModel,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (opts?.temperature !== undefined) body.temperature = opts.temperature;
    if (opts?.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
    if (opts?.topP !== undefined) body.top_p = opts.topP;
    if (opts?.stop !== undefined) body.stop = opts.stop;
    if (stream) body.stream = true;
    return body;
  }

  /** OpenAI finish_reason → LlmResponse.finishReason（透传，未知值原样返回） */
  private mapFinishReason(r: string | undefined): LlmResponse['finishReason'] {
    switch (r) {
      case 'stop':
      case 'length':
      case 'content_filter':
      case 'tool_calls':
        return r;
      default:
        return r ?? 'stop';
    }
  }

  /** 从 AgnesChatResponse 提取 LlmResponse，结构缺失抛 ParseError */
  private parseResponse(data: AgnesChatResponse): LlmResponse {
    const choice = data.choices?.[0];
    const content = choice?.message?.content;
    if (content === undefined || content === null) {
      throw new ParseError(
        `Agnes response missing choices[0].message.content: ${JSON.stringify(data).slice(0, 200)}`,
      );
    }
    const u = data.usage ?? {};
    return {
      content,
      model: data.model ?? this.cfg.defaultModel,
      finishReason: this.mapFinishReason(choice?.finish_reason),
      usage: {
        promptTokens: u.prompt_tokens ?? 0,
        completionTokens: u.completion_tokens ?? 0,
        totalTokens: u.total_tokens ?? 0,
      },
      raw: data,
    };
  }

  async generate(messages: ChatMessage[], opts?: LlmOpts): Promise<LlmResponse> {
    const body = this.buildBody(messages, opts, false);
    const timeoutMs = opts?.timeoutMs ?? this.runtime.timeoutMs;
    const maxRetries = opts?.maxRetries ?? this.runtime.maxRetries;

    const res = await withRetry(
      () =>
        httpJson<AgnesChatResponse>(
          { path: '/chat/completions', method: 'POST', body },
          {
            baseURL: this.cfg.baseURL,
            apiKey: this.cfg.apiKey,
            timeoutMs,
            signal: opts?.signal,
          },
        ),
      {
        maxRetries,
        baseDelayMs: this.runtime.baseRetryDelayMs,
        signal: opts?.signal,
      },
    );

    return this.parseResponse(res.body);
  }

  async *stream(messages: ChatMessage[], opts?: LlmOpts): AsyncIterable<LlmChunk> {
    const body = this.buildBody(messages, opts, true);
    const timeoutMs = opts?.timeoutMs ?? this.runtime.timeoutMs;
    const maxRetries = opts?.maxRetries ?? this.runtime.maxRetries;

    // 建连阶段带重试；建连成功后流式传输的取消由 opts.signal 控制
    const res = await withRetry(
      () =>
        httpStream(
          { path: '/chat/completions', method: 'POST', body },
          {
            baseURL: this.cfg.baseURL,
            apiKey: this.cfg.apiKey,
            timeoutMs,
            signal: opts?.signal,
          },
        ),
      {
        maxRetries,
        baseDelayMs: this.runtime.baseRetryDelayMs,
        signal: opts?.signal,
      },
    );

    if (!res.body) {
      throw new ParseError('Agnes stream response has no body');
    }

    let lastUsage:
      { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

    for await (const ev of parseSse(res.body)) {
      // [DONE] 标记流结束
      if (ev.data === '[DONE]') {
        yield { delta: '', done: true, usage: lastUsage };
        return;
      }

      // 解析 JSON 分片，失败抛 ParseError
      let json: AgnesStreamChunk;
      try {
        json = JSON.parse(ev.data) as AgnesStreamChunk;
      } catch (e) {
        throw new ParseError(`Failed to parse SSE data: ${ev.data.slice(0, 120)}`, { cause: e });
      }

      const delta = json.choices?.[0]?.delta?.content ?? '';
      const finishReason = json.choices?.[0]?.finish_reason;
      const u = json.usage;
      if (u) {
        lastUsage = {
          promptTokens: u.prompt_tokens ?? 0,
          completionTokens: u.completion_tokens ?? 0,
          totalTokens: u.total_tokens ?? 0,
        };
      }

      const done = finishReason !== undefined && finishReason !== null;
      yield { delta, done, usage: done ? lastUsage : undefined };
    }

    // 流自然结束（未收到 [DONE]）
    yield { delta: '', done: true, usage: lastUsage };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.generate([{ role: 'user', content: 'Reply with exactly pong.' }], {
        maxTokens: 8,
        maxRetries: 0,
        timeoutMs: 10_000,
      });
      return true;
    } catch {
      return false;
    }
  }
}
