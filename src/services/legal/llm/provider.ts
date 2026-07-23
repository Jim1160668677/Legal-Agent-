/**
 * LlmProvider 抽象接口。
 *
 * 多供应商切换的统一契约，与 src/types/llm.ts 的 LlmService 契约对齐。
 * 每个 provider（agnes / qwen / 未来扩展）实现本接口，LlmService 通过
 * ProviderRegistry 选 active provider 委托调用。
 *
 * 设计依据：docs/design/04-module-design.md（多厂商切换要求）。
 */

import type { ChatMessage, LlmOpts, LlmResponse, LlmChunk } from '../../../types/llm';

export interface LlmProvider {
  /** 供应商标识：'agnes' | 'qwen' | ... */
  readonly name: string;
  /** 默认模型名（如 'agnes-2.0-flash'） */
  readonly defaultModel: string;
  /** 非流式生成 */
  generate(messages: ChatMessage[], opts?: LlmOpts): Promise<LlmResponse>;
  /** 流式生成（异步迭代器） */
  stream(messages: ChatMessage[], opts?: LlmOpts): AsyncIterable<LlmChunk>;
  /** 可选：健康检查（轻量 generate 验证连通性） */
  healthCheck?(): Promise<boolean>;
}

/**
 * 未实现错误。供桩 provider（如 QwenProvider）使用。
 *
 * 与 LlmError 体系区分：本错误表示"功能未实现"而非"调用失败"，
 * 用于验证多 provider 切换机制——切换到桩 provider 后调用应抛此错误。
 */
export class NotImplementedError extends Error {
  readonly kind = 'not_implemented' as const;
  readonly provider: string;
  readonly method: string;

  constructor(provider: string, method: string) {
    super(`${provider}.${method}() is a stub (not implemented)`);
    this.name = 'NotImplementedError';
    this.provider = provider;
    this.method = method;
  }
}
