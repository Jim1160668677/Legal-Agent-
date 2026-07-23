/**
 * LLM 共享类型契约。
 *
 * 对齐设计文档 docs/design/06-api-spec.md 第八节 LlmService 接口契约：
 * - 将 complete 重命名为 generate（语义更明确，支持 messages[] 多轮）
 * - 保留 complete 作为兼容别名
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** LLM 调用选项（对齐设计文档 06 LlmOpts，扩展 timeoutMs/maxRetries/signal） */
export interface LlmOpts {
  /** 模型名（不传用 provider 默认） */
  model?: string;
  /** 采样温度 0..2，默认由 provider 决定 */
  temperature?: number;
  /** 最大生成 token 数（对应 OpenAI max_tokens） */
  maxTokens?: number;
  /** nucleus sampling，0..1 */
  topP?: number;
  /** 停止序列 */
  stop?: string | string[];
  /** Prompt 模板版本（设计文档 05 3.13 llm_cache 字段，MVP 暂不实现） */
  promptVersion?: number;
  /** 是否启用缓存（MVP 暂不实现） */
  enableCache?: boolean;
  /** 单次调用超时覆盖（毫秒） */
  timeoutMs?: number;
  /** 单次调用重试次数覆盖 */
  maxRetries?: number;
  /** 调用方传入的取消信号 */
  signal?: AbortSignal;
}

/** 流式分片 */
export interface LlmChunk {
  delta: string;
  done: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/** 法条引用 */
export interface LawRef {
  ref: string;
  title?: string;
  verified?: boolean;
}

/** 法条引用校验结果 */
export interface LawRefCheckResult {
  verified: LawRef[];
  unverified: LawRef[];
  sanitizedText: string;
}

/** LLM 非流式响应 */
export interface LlmResponse {
  content: string;
  model: string;
  finishReason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** 原始 API 响应（调试用） */
  raw: unknown;
}

/** LlmService 主接口（对齐 06 第八节） */
export interface LlmService {
  generate(input: string | ChatMessage[], opts?: LlmOpts): Promise<LlmResponse>;
  stream(input: string | ChatMessage[], opts?: LlmOpts): AsyncIterable<LlmChunk>;
  validateLawRefs(text: string): Promise<LawRefCheckResult>;
}

/**
 * LlmService 兼容别名：complete(prompt) 返回纯字符串内容。
 * 等价于 generate(prompt).then(r => r.content)。
 */
export type LlmServiceWithAlias = LlmService & {
  complete(prompt: string, opts?: LlmOpts): Promise<string>;
};
